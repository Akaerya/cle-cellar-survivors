import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH, INNER, MAX_SHIELD_REDUCTION, STAB_LEAD } from '../constants';
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
  /** Radians for sweeps and breaths, px (blade width) for stabs. */
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
  /** Enemies this weapon finished off. */
  kills: number;
  /** Run time when the weapon was picked up (for its DPS). */
  acquiredAt: number;
  orbiters: Phaser.GameObjects.Sprite[];
  orbitAngle: number;
  gfx: Phaser.GameObjects.Graphics | null;
  pulse: number;
  phase: number;
  slashes: Slash[];
}

/** Stats after the owner's multipliers (damage, cooldown, area). */
export interface Effective extends WeaponStats {}

const DEG = Math.PI / 180;
/** Targeting types drawn with the slash graphics (redrawn every frame while effects play). */
const SLASHERS = new Set(['facing', 'stab', 'breath']);

/**
 * Runs every weapon one character has equipped. Behaviour comes from the weapon's `targeting` and stats, so a new
 * weapon is a data entry: `nearest` / `random` / `facing` fire projectiles (or sweep if speed is 0),
 * `orbit` keeps objects circling the owner, `aura` damages everything in a radius on a tick,
 * `stab` thrusts a blade at the nearest enemy, `breath` sprays a cone at it, `strike` calls bolts down
 * around the owner, and `shield` blocks a hit every cooldown and absorbs part of the rest.
 */
export class Weapons {
  readonly list: WeaponInstance[] = [];
  private query: Enemy[] = [];

  /** `projectiles` is shared by every player's weapons. */
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
    const w = this.instance(def);
    if (def.targeting === 'aura' || def.targeting === 'shield') w.gfx = this.game.add.graphics().setDepth(DEPTH.aura);
    if (SLASHERS.has(def.targeting) && def.stats.speed === 0) w.gfx = this.game.add.graphics().setDepth(DEPTH.slash);
    this.list.push(w);
    return w;
  }

  /** A weapon instance that is not equipped (ultimates use one to fire projectiles and count damage). */
  instance(def: WeaponDef): WeaponInstance {
    return {
      uid: nextUid++,
      owner: this.owner,
      def,
      level: 1,
      stats: weaponStatsAt(def, 1),
      timer: 0.25,
      damage: 0,
      kills: 0,
      acquiredAt: this.game.runTime,
      orbiters: [],
      orbitAngle: 0,
      gfx: null,
      pulse: 0,
      phase: 0,
      slashes: [],
    };
  }

  levelUp(id: string): void {
    const w = this.get(id);
    if (!w) return;
    w.level++;
    w.stats = weaponStatsAt(w.def, w.level);
  }

  eff(w: WeaponInstance): Effective {
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
        case 'stab':
        case 'breath':
        case 'strike':
          if (firing) this.tickShooter(w, e, dt);
          break;
        case 'shield':
          this.updateShield(w, e, dt);
          break;
        case 'orbit':
          this.updateOrbit(w, e, dt, firing);
          break;
        case 'aura':
          this.updateAura(w, e, dt, firing);
          break;
      }
      if (w.gfx && SLASHERS.has(w.def.targeting)) this.drawSlashes(w, dt);
    }
  }

  /** Projectiles of every player: lifetime, boomerang steering, and the arena wall. */
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
    } else if (w.def.targeting === 'stab' || w.def.targeting === 'breath') {
      const reach = e.size + (w.def.targeting === 'stab' ? STAB_LEAD : 0);
      const target = this.game.enemies.nearest(p.x, p.y, reach);
      if (target) {
        const angle = Math.atan2(target.y - p.y, target.x - p.x);
        if (w.def.targeting === 'stab') this.stab(w, e, angle);
        else this.sweep(w, e, angle);
        fired = true;
      }
    } else if (w.def.targeting === 'strike') {
      this.strike(w, e);
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

  /** Fires one projectile of `w` from anywhere (ultimates). Returns false when the pool is empty. */
  shoot(w: WeaponInstance, x: number, y: number, angle: number): boolean {
    const pr = this.projectiles.get(x, y) as Projectile | null;
    if (!pr) return false;
    pr.fire(w, x, y, angle, this.eff(w));
    return true;
  }

  /** Straight thrust: hits everything along a blade `size` px long and `arc` px wide. */
  private stab(w: WeaponInstance, e: Effective, base: number): void {
    const p = this.owner;
    const n = Math.max(1, Math.round(e.projectileCount));
    const half = e.arc / 2;
    const dur = Math.max(0.12, e.lifetime);
    for (let i = 0; i < n; i++) {
      const angle = base + (i * Math.PI * 2) / n;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      this.query.length = 0;
      this.game.enemies.grid.query(p.x + (cos * e.size) / 2, p.y + (sin * e.size) / 2, e.size / 2 + 16, this.query);
      for (const en of this.query) {
        if (!en.active) continue;
        const dx = en.x - p.x;
        const dy = en.y - p.y;
        const along = dx * cos + dy * sin;
        if (along < -en.radius || along > e.size + en.radius) continue;
        if (Math.abs(dy * cos - dx * sin) > half + en.radius) continue;
        this.game.enemies.hit(en, e.damage, cos, sin, e.knockback, w);
      }
      w.slashes.push({ angle, reach: e.size, arc: e.arc, t: 0, dur });
      this.game.relay(['w', p.slot, this.list.indexOf(w), angle, e.size, e.arc, dur]);
    }
    this.game.playSfx('stab', p.x, p.y);
  }

  /** Lightning bolts on random spots within `range`: a random enemy in range when there is one. */
  private strike(w: WeaponInstance, e: Effective): void {
    const p = this.owner;
    const rng = this.game.rng;
    const n = Math.max(1, Math.round(e.projectileCount));
    const near: Enemy[] = [];
    this.game.enemies.grid.query(p.x, p.y, e.range, near);
    for (let i = near.length - 1; i >= 0; i--) {
      const en = near[i];
      if (!en.active || (en.x - p.x) ** 2 + (en.y - p.y) ** 2 > e.range * e.range) near.splice(i, 1);
    }
    for (let i = 0; i < n; i++) {
      let x: number;
      let y: number;
      if (near.length > 0) {
        const en = near.splice(rng.int(0, near.length - 1), 1)[0];
        x = en.x;
        y = en.y;
      } else {
        const a = rng.angle();
        const r = Math.sqrt(rng.float()) * e.range;
        x = p.x + Math.cos(a) * r;
        y = p.y + Math.sin(a) * r;
      }
      this.query.length = 0;
      this.game.enemies.grid.query(x, y, e.size + 16, this.query);
      for (const en of this.query) {
        if (!en.active) continue;
        const dx = en.x - x;
        const dy = en.y - y;
        const d = Math.hypot(dx, dy);
        if (d > e.size + en.radius) continue;
        this.game.enemies.hit(en, e.damage, dx / (d || 1), dy / (d || 1), e.knockback, w);
      }
      this.game.fx.lightning(x, y, e.size, w.def.color ?? 0xc8ecff);
    }
    this.game.playSfx('thunder', p.x, p.y);
  }

  /** Shield bubble: bright while the block is charged, a filling ring while it recharges. */
  private updateShield(w: WeaponInstance, e: Effective, dt: number): void {
    const p = this.owner;
    if (w.timer > 0) w.timer = Math.max(0, w.timer - dt);
    w.pulse = Math.max(0, w.pulse - dt * 2.5);
    w.phase = (w.phase + dt * 1.5) % 1;
    const g = w.gfx!;
    const color = w.def.color ?? 0x5ab0ff;
    const R = e.size;
    g.clear();
    if (w.timer <= 0) {
      const shimmer = 0.5 + 0.5 * Math.sin(w.phase * Math.PI * 2);
      g.fillStyle(color, 0.08 + 0.05 * shimmer);
      g.fillCircle(p.x, p.y, R);
      g.lineStyle(1, color, 0.55 + 0.3 * shimmer);
      g.strokeCircle(p.x, p.y, R);
    } else {
      const k = 1 - w.timer / e.cooldown;
      g.lineStyle(1, color, 0.3);
      g.beginPath();
      g.arc(p.x, p.y, R, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      g.strokePath();
    }
    if (w.pulse > 0) {
      g.fillStyle(0xffffff, 0.35 * w.pulse);
      g.fillCircle(p.x, p.y, R + 4 * (1 - w.pulse));
    }
  }

  /** Host: a charged shield eats the hit and starts recharging. */
  tryBlock(): boolean {
    for (const w of this.list) {
      if (w.def.targeting !== 'shield' || w.timer > 0) continue;
      const e = this.eff(w);
      w.timer = e.cooldown;
      w.pulse = 1;
      const p = this.owner;
      this.game.fx.ring(p.x, p.y, w.def.color ?? 0x5ab0ff, e.size + 12, 320);
      this.game.playSfx('block', p.x, p.y);
      return true;
    }
    return false;
  }

  /** Fraction of every hit the owner's shields absorb. */
  reduction(): number {
    let r = 0;
    for (const w of this.list) if (w.def.targeting === 'shield') r += w.stats.reduction ?? 0;
    return Math.min(MAX_SHIELD_REDUCTION, r);
  }

  /** Melee arc toward `base` (Tail Whip, breaths). Extra projectiles add sweeps around the owner. */
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
    if (w.def.targeting === 'breath') {
      this.game.playSfx('zap', p.x, p.y);
    } else {
      p.spin();
      this.game.playSfx('whip', p.x, p.y);
    }
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
      if (w.def.targeting === 'stab') {
        this.drawStab(g, s, k, color);
        continue;
      }
      if (w.def.targeting === 'breath') {
        this.drawBreath(g, s, k, color);
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

  /** A blade that shoots out to full reach, then fades. */
  private drawStab(g: Phaser.GameObjects.Graphics, s: Slash, k: number, color: number): void {
    const p = this.owner;
    const ext = Math.min(1, k * 3);
    const alpha = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
    const cos = Math.cos(s.angle);
    const sin = Math.sin(s.angle);
    const half = Math.max(1.5, s.arc / 2);
    const x0 = p.x + cos * 5;
    const y0 = p.y + sin * 5;
    const tipD = 5 + (s.reach - 5) * ext;
    const tx = p.x + cos * tipD;
    const ty = p.y + sin * tipD;
    const bx = tx - cos * Math.min(8, tipD);
    const by = ty - sin * Math.min(8, tipD);
    // Glow, then the blade itself: a long quad that narrows to a point.
    g.fillStyle(color, alpha * 0.35);
    g.fillTriangle(x0 - sin * half * 1.8, y0 + cos * half * 1.8, x0 + sin * half * 1.8, y0 - cos * half * 1.8, tx + cos * 3, ty + sin * 3);
    g.fillStyle(0xffffff, alpha * 0.9);
    g.fillPoints(
      [
        new Phaser.Math.Vector2(x0 - sin * half * 0.5, y0 + cos * half * 0.5),
        new Phaser.Math.Vector2(bx - sin * half * 0.5, by + cos * half * 0.5),
        new Phaser.Math.Vector2(tx, ty),
        new Phaser.Math.Vector2(bx + sin * half * 0.5, by - cos * half * 0.5),
        new Phaser.Math.Vector2(x0 + sin * half * 0.5, y0 - cos * half * 0.5),
      ],
      true,
    );
    // Cross-guard at the hilt.
    g.lineStyle(2, 0xf7d84a, alpha);
    g.lineBetween(x0 - sin * 4, y0 + cos * 4, x0 + sin * 4, y0 - cos * 4);
  }

  /** A cone of flickering lightning toward `angle`. */
  private drawBreath(g: Phaser.GameObjects.Graphics, s: Slash, k: number, color: number): void {
    const p = this.owner;
    const alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    const reach = s.reach * Math.min(1, k * 4);
    const a0 = s.angle - s.arc / 2;
    const steps = 10;
    const pts: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(p.x, p.y)];
    for (let j = 0; j <= steps; j++) {
      const a = a0 + (s.arc * j) / steps;
      pts.push(new Phaser.Math.Vector2(p.x + Math.cos(a) * reach, p.y + Math.sin(a) * reach));
    }
    g.fillStyle(color, alpha * 0.22);
    g.fillPoints(pts, true);
    // Jagged bolts, re-rolled every frame so they flicker (purely visual, so Math.random is fine).
    for (let b = 0; b < 4; b++) {
      const a = s.angle + (Math.random() - 0.5) * s.arc * 0.9;
      const len = reach * (0.55 + Math.random() * 0.45);
      const segs = 6;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      g.lineStyle(2, color, alpha * 0.8);
      g.beginPath();
      g.moveTo(p.x, p.y);
      for (let j = 1; j <= segs; j++) {
        const d = (len * j) / segs;
        const off = j === segs ? 0 : (Math.random() - 0.5) * 8;
        g.lineTo(p.x + Math.cos(a) * d + nx * off, p.y + Math.sin(a) * d + ny * off);
      }
      g.strokePath();
    }
    g.lineStyle(1, 0xffffff, alpha * 0.6);
    g.beginPath();
    g.arc(p.x, p.y, reach, a0, a0 + s.arc);
    g.strokePath();
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
    if (w.def.targeting === 'facing') this.owner.spin();
  }

  pulse(index: number): void {
    const w = this.list[index];
    if (w) w.pulse = 1;
  }

  /**
   * Per-weapon state from the host: orbit angles (so coconuts are drawn where they actually hit) and
   * shield charge (the fraction of the recharge left, sent in the same angle-shaped slot).
   */
  setPhases(phases: number[]): void {
    phases.forEach((a, i) => {
      const w = this.list[i];
      if (!w) return;
      if (w.def.targeting === 'shield') {
        w.timer = (a / (Math.PI * 2)) * this.eff(w).cooldown;
        return;
      }
      if (w.def.targeting !== 'orbit') return;
      // Nudge rather than snap: the local spin keeps it smooth between snapshots.
      const diff = Phaser.Math.Angle.Wrap(a - w.orbitAngle);
      w.orbitAngle += Math.abs(diff) > 0.6 ? diff : diff * 0.2;
    });
  }

  phases(): number[] {
    return this.list.map((w) => {
      if (w.def.targeting === 'orbit') return w.orbitAngle;
      // Kept below a full turn: the encoding wraps 2 pi to 0.
      if (w.def.targeting === 'shield') return Math.min(0.999, w.timer / this.eff(w).cooldown) * Math.PI * 2;
      return 0;
    });
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

  /** Removes everything this player drew (player left). The list stays for the party screen. */
  destroy(): void {
    for (const w of this.list) {
      for (const s of w.orbiters) s.destroy();
      w.orbiters.length = 0;
      w.gfx?.destroy();
      w.gfx = null;
      w.slashes.length = 0;
    }
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
