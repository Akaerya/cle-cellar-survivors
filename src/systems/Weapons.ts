import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH, INNER } from '../constants';
import { weaponStatsAt } from '../core/progression';
import { weaponDef } from '../data';
import type { WeaponDef, WeaponStats } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { Projectile } from '../entities/Projectile';
import type { GameScene } from '../scenes/GameScene';

let nextUid = 1;

interface Slash {
  angle: number;
  reach: number;
  arc: number;
  t: number;
  dur: number;
}

export interface WeaponInstance {
  uid: number;
  owner: Player;
  def: WeaponDef;
  level: number;
  stats: WeaponStats;
  timer: number;
  /** Total damage dealt this run, shown on the end screen. */
  damage: number;
  orbiters: Phaser.GameObjects.Sprite[];
  orbitAngle: number;
  gfx: Phaser.GameObjects.Graphics | null;
  pulse: number;
  phase: number;
  slashes: Slash[];
}

/** Stats after the monkey's multipliers (damage, cooldown, area). */
interface Effective extends WeaponStats {}

const DEG = Math.PI / 180;

/**
 * Runs every weapon one monkey has equipped. Behaviour comes from the weapon's `targeting` and stats, so a new
 * weapon is a data entry: `nearest` / `random` / `facing` fire projectiles (or sweep if speed is 0),
 * `orbit` keeps objects circling the monkey, `aura` damages everything in a radius on a tick.
 */
export class Weapons {
  readonly list: WeaponInstance[] = [];
  private query: Enemy[] = [];

  /** `projectiles` is shared by every monkey's weapons. */
  constructor(
    private game: GameScene,
    readonly owner: Player,
    readonly projectiles: Phaser.Physics.Arcade.Group,
  ) {}

  static createProjectileGroup(game: GameScene): Phaser.Physics.Arcade.Group {
    return game.physics.add.group({ classType: Projectile, maxSize: 300, runChildUpdate: false });
  }

  get(id: string): WeaponInstance | undefined {
    return this.list.find((w) => w.def.id === id);
  }

  add(id: string): WeaponInstance {
    const def = weaponDef(id);
    const w: WeaponInstance = {
      uid: nextUid++,
      owner: this.owner,
      def,
      level: 1,
      stats: weaponStatsAt(def, 1),
      timer: 0.25,
      damage: 0,
      orbiters: [],
      orbitAngle: 0,
      gfx: null,
      pulse: 0,
      phase: 0,
      slashes: [],
    };
    if (def.targeting === 'aura') w.gfx = this.game.add.graphics().setDepth(DEPTH.aura);
    if (def.targeting === 'facing' && def.stats.speed === 0) w.gfx = this.game.add.graphics().setDepth(DEPTH.slash);
    this.list.push(w);
    return w;
  }

  levelUp(id: string): void {
    const w = this.get(id);
    if (!w) return;
    w.level++;
    w.stats = weaponStatsAt(w.def, w.level);
  }

  private eff(w: WeaponInstance): Effective {
    const p = this.owner.stats;
    const s = w.stats;
    return {
      ...s,
      damage: s.damage * p.damageMult,
      cooldown: Math.max(0.05, s.cooldown * p.cooldownMult),
      size: s.size * p.areaMult,
      range: w.def.targeting === 'orbit' ? s.range * p.areaMult : s.range,
    };
  }

  /** `firing` false only animates (joiners draw remote weapons this way; the host does the hitting). */
  update(dt: number, firing: boolean): void {
    for (const w of this.list) {
      const e = this.eff(w);
      switch (w.def.targeting) {
        case 'nearest':
        case 'random':
        case 'facing':
          if (firing) this.tickShooter(w, e, dt);
          break;
        case 'orbit':
          this.updateOrbit(w, e, dt, firing);
          break;
        case 'aura':
          this.updateAura(w, e, dt, firing);
          break;
      }
      if (w.slashes.length > 0 || (w.gfx && w.def.targeting === 'facing')) this.drawSlashes(w, dt);
    }
  }

  /** Projectiles of every monkey: lifetime, boomerang steering, and the arena wall. */
  static updateProjectiles(group: Phaser.Physics.Arcade.Group, dt: number): void {
    const children = group.getChildren() as Projectile[];
    for (let i = 0; i < children.length; i++) {
      const pr = children[i];
      if (!pr.active) continue;
      const o = pr.weapon.owner;
      const alive = pr.step(dt, o.x, o.y);
      const hitWall = pr.x < INNER.left || pr.x > INNER.right || pr.y < INNER.top || pr.y > INNER.bottom;
      if (!alive || hitWall) Weapons.release(pr);
    }
  }

  private tickShooter(w: WeaponInstance, e: Effective, dt: number): void {
    w.timer -= dt;
    if (w.timer > 0) return;
    let fired = false;
    const p = this.owner;
    if (w.def.targeting === 'nearest') {
      const target = this.game.enemies.nearest(p.x, p.y, e.range);
      if (target) {
        this.volley(w, e, Math.atan2(target.y - p.y, target.x - p.x));
        fired = true;
      }
    } else if (w.def.targeting === 'random') {
      this.volley(w, e, this.game.rng.angle());
      fired = true;
    } else {
      const base = Math.atan2(p.facing.y, p.facing.x);
      if (e.speed > 0) this.volley(w, e, base);
      else this.sweep(w, e, base);
      fired = true;
    }
    // Hold fire with no target: stay ready and shoot the moment one appears.
    w.timer = fired ? Math.max(w.timer + e.cooldown, e.cooldown * 0.5) : 0;
  }

  private volley(w: WeaponInstance, e: Effective, base: number): void {
    const p = this.owner;
    const n = Math.max(1, Math.round(e.projectileCount));
    for (let i = 0; i < n; i++) {
      const angle = base + (i - (n - 1) / 2) * e.spread * DEG;
      const pr = this.projectiles.get(p.x, p.y) as Projectile | null;
      if (!pr) break;
      pr.fire(w, p.x, p.y - 2, angle, e);
    }
    this.game.playSfx('throw', p.x, p.y);
  }

  /** Melee arc in the facing direction (Tail Whip). Extra projectiles add sweeps around the monkey. */
  private sweep(w: WeaponInstance, e: Effective, base: number): void {
    const p = this.owner;
    const n = Math.max(1, Math.round(e.projectileCount));
    const half = (e.arc * DEG) / 2;
    for (let i = 0; i < n; i++) {
      const angle = base + (i * Math.PI * 2) / n;
      this.query.length = 0;
      this.game.enemies.grid.query(p.x, p.y, e.size + 16, this.query);
      for (const en of this.query) {
        if (!en.active) continue;
        const dx = en.x - p.x;
        const dy = en.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > e.size + en.radius) continue;
        const diff = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - angle));
        const tol = d > 0 ? Math.asin(Math.min(1, en.radius / d)) : Math.PI;
        if (diff > half + tol) continue;
        this.game.enemies.hit(en, e.damage, dx / (d || 1), dy / (d || 1), e.knockback, w);
      }
      const dur = Math.max(0.14, e.lifetime);
      w.slashes.push({ angle, reach: e.size, arc: e.arc * DEG, t: 0, dur });
      this.game.relay(['w', p.slot, this.list.indexOf(w), angle, e.size, e.arc * DEG, dur]);
    }
    p.spin();
    this.game.playSfx('whip', p.x, p.y);
  }

  private drawSlashes(w: WeaponInstance, dt: number): void {
    const g = w.gfx;
    if (!g) return;
    g.clear();
    const p = this.owner;
    const color = w.def.color ?? 0xffffff;
    for (let i = w.slashes.length - 1; i >= 0; i--) {
      const s = w.slashes[i];
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        w.slashes.splice(i, 1);
        continue;
      }
      const sweepK = Math.min(1, k * 1.8);
      const alpha = k < 0.55 ? 0.85 : 0.85 * (1 - (k - 0.55) / 0.45);
      const a0 = s.angle - s.arc / 2;
      const a1 = a0 + s.arc * sweepK;
      const outer = s.reach;
      const inner = s.reach * 0.5;
      const steps = 14;
      const pts: Phaser.Math.Vector2[] = [];
      for (let j = 0; j <= steps; j++) {
        const a = a0 + ((a1 - a0) * j) / steps;
        pts.push(new Phaser.Math.Vector2(p.x + Math.cos(a) * outer, p.y + Math.sin(a) * outer));
      }
      for (let j = steps; j >= 0; j--) {
        const a = a0 + ((a1 - a0) * j) / steps;
        const r = inner + (outer - inner) * 0.35 * (1 - j / steps);
        pts.push(new Phaser.Math.Vector2(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r));
      }
      g.fillStyle(color, alpha * 0.55);
      g.fillPoints(pts, true);
      g.lineStyle(2, 0xffffff, alpha);
      g.beginPath();
      for (let j = 0; j <= steps; j++) {
        const a = a0 + ((a1 - a0) * j) / steps;
        const x = p.x + Math.cos(a) * outer;
        const y = p.y + Math.sin(a) * outer;
        if (j === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
  }

  private updateOrbit(w: WeaponInstance, e: Effective, dt: number, firing: boolean): void {
    const p = this.owner;
    const n = Math.max(1, Math.round(e.projectileCount));
    while (w.orbiters.length < n) {
      const s = this.game.add.sprite(p.x, p.y, ATLAS, 'coconut_0').setDepth(DEPTH.projectiles);
      if (w.def.projectileAnim) s.play(w.def.projectileAnim);
      w.orbiters.push(s);
    }
    while (w.orbiters.length > n) w.orbiters.pop()!.destroy();
    const R = e.range;
    w.orbitAngle += (e.speed / R) * dt;
    const scale = e.size / (w.def.artRadius ?? 5);
    const now = this.game.time.now;
    const cdMs = e.cooldown * 1000;
    for (let i = 0; i < n; i++) {
      const a = w.orbitAngle + (i * Math.PI * 2) / n;
      const ox = p.x + Math.cos(a) * R;
      const oy = p.y + Math.sin(a) * R;
      const s = w.orbiters[i];
      s.setPosition(ox, oy).setScale(scale);
      if (!firing) continue;
      this.query.length = 0;
      this.game.enemies.grid.query(ox, oy, e.size + 16, this.query);
      for (const en of this.query) {
        if (!en.active) continue;
        const dx = en.x - ox;
        const dy = en.y - oy;
        const rr = e.size + en.radius;
        if (dx * dx + dy * dy > rr * rr) continue;
        const last = en.lastHit.get(w.uid);
        if (last !== undefined && now - last < cdMs) continue;
        en.lastHit.set(w.uid, now);
        const kx = en.x - p.x;
        const ky = en.y - p.y;
        const kd = Math.hypot(kx, ky) || 1;
        this.game.enemies.hit(en, e.damage, kx / kd, ky / kd, e.knockback, w);
      }
    }
  }

  private updateAura(w: WeaponInstance, e: Effective, dt: number, firing: boolean): void {
    const p = this.owner;
    const R = e.size;
    if (firing) {
      w.timer -= dt;
      if (w.timer <= 0) {
        w.timer += e.cooldown;
        w.pulse = 1;
        this.game.relay(['a', p.slot, this.list.indexOf(w)]);
        this.query.length = 0;
        this.game.enemies.grid.query(p.x, p.y, R + 16, this.query);
        for (const en of this.query) {
          if (!en.active) continue;
          const dx = en.x - p.x;
          const dy = en.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d > R + en.radius * 0.5) continue;
          this.game.enemies.hit(en, e.damage, dx / (d || 1), dy / (d || 1), e.knockback, w);
        }
      }
    }
    w.pulse = Math.max(0, w.pulse - dt * 3);
    w.phase = (w.phase + dt * 0.8) % 1;
    const g = w.gfx!;
    const color = w.def.color ?? 0x57c8d8;
    g.clear();
    g.fillStyle(color, 0.06 + 0.08 * w.pulse);
    g.fillCircle(p.x, p.y, R);
    for (let k = 0; k < 3; k++) {
      const ph = (w.phase + k / 3) % 1;
      const r = R * (0.3 + 0.7 * ph);
      g.lineStyle(1, color, (1 - ph) * (0.45 + 0.4 * w.pulse));
      g.strokeCircle(p.x, p.y, r);
    }
    g.lineStyle(1, 0xffffff, 0.12 + 0.35 * w.pulse);
    g.strokeCircle(p.x, p.y, R);
  }

  onProjectileHit(pr: Projectile, en: Enemy): void {
    if (!pr.active || !en.active || pr.hit.has(en)) return;
    pr.hit.add(en);
    const body = pr.body as Phaser.Physics.Arcade.Body;
    const v = Math.hypot(body.velocity.x, body.velocity.y);
    const dx = v > 1 ? body.velocity.x / v : pr.dirX;
    const dy = v > 1 ? body.velocity.y / v : pr.dirY;
    this.game.enemies.hit(en, pr.damage, dx, dy, pr.knockback, pr.weapon);
    pr.pierceLeft--;
    if (pr.pierceLeft <= 0) {
      if (pr.boomerang && !pr.returning) pr.turnAround();
      else Weapons.release(pr);
    }
  }

  private static release(pr: Projectile): void {
    pr.disableBody(true, true);
    pr.anims.stop();
  }

  // ---------------------------------------------------------------- joiners: effects the host relays

  addSlash(index: number, angle: number, reach: number, arc: number, dur: number): void {
    const w = this.list[index];
    if (!w) return;
    w.slashes.push({ angle, reach, arc, t: 0, dur });
    this.owner.spin();
  }

  pulse(index: number): void {
    const w = this.list[index];
    if (w) w.pulse = 1;
  }

  /** Orbit angles from the host, so coconuts are drawn where they actually hit. */
  setPhases(phases: number[]): void {
    phases.forEach((a, i) => {
      const w = this.list[i];
      if (!w || w.def.targeting !== 'orbit') return;
      // Nudge rather than snap: the local spin keeps it smooth between snapshots.
      const diff = Phaser.Math.Angle.Wrap(a - w.orbitAngle);
      w.orbitAngle += Math.abs(diff) > 0.6 ? diff : diff * 0.2;
    });
  }

  phases(): number[] {
    return this.list.map((w) => (w.def.targeting === 'orbit' ? w.orbitAngle : 0));
  }

  /** Brings the weapon list in line with the host's (joiners). */
  sync(pairs: [string, number][]): void {
    for (const [id, level] of pairs) {
      const w = this.get(id) ?? this.add(id);
      if (w.level !== level) {
        w.level = level;
        w.stats = weaponStatsAt(w.def, level);
      }
    }
  }

  /** Removes everything this monkey drew (player left). */
  destroy(): void {
    for (const w of this.list) {
      for (const s of w.orbiters) s.destroy();
      w.orbiters.length = 0;
      w.gfx?.destroy();
      w.gfx = null;
    }
    this.list.length = 0;
  }

  /** Shows orbiters again (revived). */
  showVisuals(): void {
    for (const w of this.list) for (const s of w.orbiters) s.setVisible(true);
  }

  /** Hides orbiters and effects (end of run). */
  clearVisuals(): void {
    for (const w of this.list) {
      for (const s of w.orbiters) s.setVisible(false);
      w.gfx?.clear();
      w.slashes.length = 0;
    }
  }
}
