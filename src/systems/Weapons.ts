import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH, INNER, MAX_PROJECTILES, MAX_SHIELD_REDUCTION, STAB_LEAD } from '../constants';
import { applyLevelBonuses, hasteFactor, modsForWeapon, weaponLevelAt, type WeaponLevelStats } from '../core/progression';
import { CHAIN_RANGE, ECHO_GAP, ECHO_RADIUS, SPLIT_ARC, weaponDef } from '../data';
import type { ModEffect, WeaponDef, WeaponStats } from '../data/types';
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
  /** This level's base stats and its percent bonuses, kept apart so they add up with the owner's bonuses. */
  levelStats: WeaponLevelStats;
  /** This level's stats with its own bonuses applied (before the owner's stats and modifications). */
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
  /** Totals of the owner's modifications that share a tag with this weapon. */
  mod: Required<ModEffect>;
  /** Repeats of the last attack still to come, and seconds until the next one. */
  repeatsLeft: number;
  repeatTimer: number;
  /** Bombs with `burst`: projectiles of the last throw still to come, seconds until the next, and the gap between them. */
  burstLeft: number;
  burstTimer: number;
  burstGap: number;
}

/** Stats after the owner's multipliers (damage, cooldown, area) and modifications. */
export interface Effective extends WeaponStats {
  /** Projectiles: how many one splits into on hit (below 2: no split), and how many times a line can split. */
  split: number;
  splitDepth: number;
  /** Projectiles: bounces once pierce is used up. */
  chain: number;
  /** Echo Strike: fraction of an area hit dealt again (0 = none), its radius in px and how many times it goes off. */
  echo: number;
  echoRadius: number;
  echoRepeats: number;
  /** Duration effect: damage per tick and seconds a stack lasts (0 without an effect). */
  effectDamage: number;
  effectDuration: number;
  /** Duration effect: chance a stack copies itself when applied or when it deals damage. */
  reiterate: number;
}

/** An Echo Strike waiting to go off. */
interface Echo {
  weapon: WeaponInstance;
  x: number;
  y: number;
  radius: number;
  amount: number;
  /** Run time it goes off. */
  at: number;
  /** The enemy that was hit (it always takes the echo), and its spawn id so a recycled enemy is not mistaken for it. */
  source: Enemy;
  sourceId: number;
}

const DEG = Math.PI / 180;
/** Targeting types drawn with the slash graphics (redrawn every frame while effects play). */
const SLASHERS = new Set(['facing', 'stab', 'breath']);

/**
 * Runs every weapon one character has equipped. Behaviour comes from the weapon's `targeting` and stats, so a new
 * weapon is a data entry: `nearest` / `random` / `facing` fire projectiles (or sweep if speed is 0),
 * `orbit` keeps objects circling the owner, `aura` damages everything in a radius on a tick,
 * `stab` thrusts a blade at the nearest enemy, `breath` sprays a cone at it, `strike` calls bolts down
 * around the owner, and `shield` blocks a hit every cooldown and absorbs part of the rest.
 * The owner's modifications (data/modifications.ts) are folded into `eff()` by weapon tag; this class also
 * runs what they add: projectile splits and chains, Echo Strike echoes and duration effects on enemies.
 */
export class Weapons {
  readonly list: WeaponInstance[] = [];
  private query: Enemy[] = [];
  private echoes: Echo[] = [];
  /** Echo damage summed per weapon and enemy, so one frame of echoes is one hit (and one number) per enemy. */
  private echoSums = new Map<WeaponInstance, Map<Enemy, number>>();

  /** `projectiles` is shared by every player's weapons. */
  constructor(
    private game: GameScene,
    readonly owner: Player,
    readonly projectiles: Phaser.Physics.Arcade.Group,
  ) {}

  static createProjectileGroup(game: GameScene): Phaser.Physics.Arcade.Group {
    return game.physics.add.group({ classType: Projectile, maxSize: MAX_PROJECTILES, runChildUpdate: false });
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
    const levelStats = weaponLevelAt(def, 1);
    return {
      uid: nextUid++,
      owner: this.owner,
      def,
      level: 1,
      levelStats,
      stats: applyLevelBonuses(levelStats),
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
      mod: modsForWeapon(def, this.owner.mods),
      repeatsLeft: 0,
      repeatTimer: 0,
      burstLeft: 0,
      burstTimer: 0,
      burstGap: 0,
    };
  }

  levelUp(id: string): void {
    const w = this.get(id);
    if (!w) return;
    this.setLevel(w, w.level + 1);
  }

  private setLevel(w: WeaponInstance, level: number): void {
    w.level = level;
    w.levelStats = weaponLevelAt(w.def, level);
    w.stats = applyLevelBonuses(w.levelStats);
  }

  /** The owner's modifications changed: recompute what they add to every weapon. */
  refreshMods(): void {
    for (const w of this.list) w.mod = modsForWeapon(w.def, this.owner.mods);
  }

  eff(w: WeaponInstance): Effective {
    const p = this.owner.stats;
    const s = w.stats;
    const { base, pct } = w.levelStats;
    const m = w.mod;
    // Percent bonuses add up into one sum per stat. Area: the weapon's own size levels, the AREA stat and area
    // modifications (only AoE weapons get those). Damage: the weapon's own damage levels and modification
    // bonuses; only DAMAGE (the Damage powerup) multiplies the result.
    const area = Math.max(0.1, p.areaMult + (pct.size ?? 0) + m.area);
    const damageMult = (1 + (pct.damage ?? 0) + m.damage) * p.damageMult;
    const effect = w.def.effect;
    return {
      ...s,
      damage: base.damage * damageMult,
      cooldown: Math.max(0.05, s.cooldown * p.cooldownMult * hasteFactor(p.abilityHaste)),
      size: base.size * area,
      range: w.def.targeting === 'orbit' ? s.range * p.areaMult : s.range,
      pierce: s.pierce + m.pierce,
      projectileCount: s.projectileCount + m.projectiles,
      split: m.split,
      splitDepth: m.splitDepth,
      chain: m.chain,
      echo: m.echo,
      // Echoes grow with AREA and area modifications, not with the weapon's own size levels.
      echoRadius: ECHO_RADIUS * Math.max(0.1, p.areaMult + m.area + m.echoArea),
      echoRepeats: m.echo > 0 ? Math.max(1, Math.round(m.echoRepeats)) : 0,
      effectDamage: effect ? effect.damage * damageMult : 0,
      effectDuration: effect ? effect.duration * Math.max(0.1, 1 + m.duration) : 0,
      reiterate: m.reiterate,
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
        case 'bomb':
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
    if (firing) this.processEchoes();
  }

  /** Projectiles of every player: lifetime, boomerang and bomb steering, and the arena wall. Bombs explode instead of vanishing. */
  static updateProjectiles(group: Phaser.Physics.Arcade.Group, dt: number): void {
    const children = group.getChildren() as Projectile[];
    for (let i = 0; i < children.length; i++) {
      const pr = children[i];
      if (!pr.active) continue;
      const o = pr.weapon.owner;
      const alive = pr.step(dt, o.x, o.y);
      const hitWall = pr.x < INNER.left || pr.x > INNER.right || pr.y < INNER.top || pr.y > INNER.bottom;
      if (pr.bomb) {
        if (pr.arrived || !alive || hitWall) o.weapons.explode(pr);
      } else if (!alive || hitWall) Weapons.release(pr);
    }
  }

  private tickShooter(w: WeaponInstance, e: Effective, dt: number): void {
    if (w.burstLeft > 0) {
      w.burstTimer -= dt;
      while (w.burstLeft > 0 && w.burstTimer <= 0) {
        w.burstLeft--;
        w.burstTimer += w.burstGap;
        const p = this.owner;
        const target = this.randomOnScreen() ?? this.game.enemies.nearest(p.x, p.y, e.range);
        if (target) {
          this.throwBomb(w, e, target);
          this.game.playSfx('throw', p.x, p.y);
        }
      }
    }
    if (w.repeatsLeft > 0) {
      w.repeatTimer -= dt;
      if (w.repeatTimer <= 0) {
        w.repeatsLeft--;
        w.repeatTimer += this.repeatGap(w, e);
        this.attack(w, e);
      }
    }
    w.timer -= dt;
    if (w.timer > 0) return;
    const fired = this.attack(w, e);
    const repeats = Math.round(e.repeat ?? 0);
    if (fired && repeats > 0) {
      w.repeatsLeft = repeats;
      w.repeatTimer = this.repeatGap(w, e);
    }
    // Hold fire with no target: stay ready and shoot the moment one appears.
    w.timer = fired ? Math.max(w.timer + e.cooldown, e.cooldown * 0.5) : 0;
  }

  /** Seconds between repeats: the weapon's delay, shortened so every repeat lands before the next attack. */
  private repeatGap(w: WeaponInstance, e: Effective): number {
    const n = Math.max(1, Math.round(e.repeat ?? 0));
    return Math.min(w.def.repeatDelay ?? 0, e.cooldown / (n + 1));
  }

  /** One attack of a shooter weapon. Returns false when it held fire (no target). */
  private attack(w: WeaponInstance, e: Effective): boolean {
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
    } else if (w.def.targeting === 'bomb') {
      const target = this.game.enemies.nearest(p.x, p.y, e.range);
      if (target) {
        this.throwBombs(w, e, target);
        fired = true;
      }
    } else {
      const base = Math.atan2(p.facing.y, p.facing.x);
      if (e.speed > 0) this.volley(w, e, base);
      else this.sweep(w, e, base);
      fired = true;
    }
    return fired;
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

  /**
   * Bomb weapons: the first projectile goes at `first` (the closest enemy). With `burst`, the others follow one at a
   * time, spread evenly over that fraction of the cooldown, each at a random enemy on screen; without it they all go now.
   */
  private throwBombs(w: WeaponInstance, e: Effective, first: Enemy): void {
    const p = this.owner;
    this.throwBomb(w, e, first);
    const n = Math.max(1, Math.round(e.projectileCount));
    if (n > 1 && w.def.burst) {
      w.burstLeft = n - 1;
      w.burstGap = (w.def.burst * e.cooldown) / n;
      w.burstTimer = w.burstGap;
    } else {
      for (let i = 1; i < n; i++) this.throwBomb(w, e, this.randomOnScreen() ?? first);
    }
    this.game.playSfx('throw', p.x, p.y);
  }

  /** One bomb at `target`. It flies at art size, touches nothing on the way, and explodes on reaching the target. */
  private throwBomb(w: WeaponInstance, e: Effective, target: Enemy): void {
    const p = this.owner;
    const pr = this.projectiles.get(p.x, p.y) as Projectile | null;
    if (!pr) return;
    const angle = Math.atan2(target.y - p.y, target.x - p.x);
    pr.fire(w, p.x, p.y - 2, angle, { ...e, size: w.def.artRadius ?? 5, split: 0, chain: 0 });
    pr.aim(target);
  }

  /** A random living enemy on the owner's screen, or null when there is none. */
  private randomOnScreen(): Enemy | null {
    const list: Enemy[] = [];
    for (const en of this.game.enemies.active) if (en.active && this.game.onScreen(this.owner, en.x, en.y)) list.push(en);
    return list.length > 0 ? this.game.rng.pick(list) : null;
  }

  /** A bomb explodes where it is: everything within the weapon's area is hit (an area hit, so AoE modifications apply). */
  explode(pr: Projectile): void {
    const w = pr.weapon;
    const e = this.eff(w);
    const x = pr.x;
    const y = pr.y;
    Weapons.release(pr);
    this.query.length = 0;
    this.game.enemies.grid.query(x, y, e.size + 16, this.query);
    for (const en of this.query) {
      if (!en.active) continue;
      const dx = en.x - x;
      const dy = en.y - y;
      const d = Math.hypot(dx, dy);
      if (d > e.size + en.radius) continue;
      this.areaHit(w, e, en, dx / (d || 1), dy / (d || 1));
    }
    this.game.fx.blast(x, y, e.size, w.def.color ?? 0xffffff);
    this.game.playSfx('boom', x, y);
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
        this.areaHit(w, e, en, cos, sin);
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
        this.areaHit(w, e, en, dx / (d || 1), dy / (d || 1));
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
        this.areaHit(w, e, en, dx / (d || 1), dy / (d || 1));
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
        this.areaHit(w, e, en, kx / kd, ky / kd);
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
          this.areaHit(w, e, en, dx / (d || 1), dy / (d || 1));
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

  /**
   * A projectile touched an enemy. Order: split if it still can (the projectile becomes its splits), otherwise
   * use up pierce; once pierce is gone a boomerang turns around, anything else chains while it has bounces.
   */
  onProjectileHit(pr: Projectile, en: Enemy): void {
    // Bombs touch nothing on the way; they explode on reaching their target (see updateProjectiles).
    if (pr.bomb || !pr.active || !en.active || pr.hit.has(en)) return;
    pr.hit.add(en);
    const body = pr.body as Phaser.Physics.Arcade.Body;
    const v = Math.hypot(body.velocity.x, body.velocity.y);
    const dx = v > 1 ? body.velocity.x / v : pr.dirX;
    const dy = v > 1 ? body.velocity.y / v : pr.dirY;
    this.game.enemies.hit(en, pr.damage, dx, dy, pr.knockback, pr.weapon);
    if (pr.weapon.def.effect) this.applyEffect(pr.weapon, this.eff(pr.weapon), en);
    if (pr.splitsLeft > 0) {
      this.split(pr, Math.atan2(dy, dx));
      Weapons.release(pr);
      return;
    }
    pr.pierceLeft--;
    if (pr.pierceLeft > 0) return;
    if (pr.boomerang) {
      if (pr.returning) Weapons.release(pr);
      else pr.turnAround();
      return;
    }
    if (pr.bouncesLeft > 0) this.chain(pr);
    else Weapons.release(pr);
  }

  /** Splits: identical projectiles fan out from the hit, skipping enemies the parent already hit. */
  private split(pr: Projectile, angle: number): void {
    const w = pr.weapon;
    const e = this.eff(w);
    const n = pr.splitCount;
    const step = (SPLIT_ARC * DEG) / (n - 1);
    for (let i = 0; i < n; i++) {
      const child = this.projectiles.get(pr.x, pr.y) as Projectile | null;
      if (!child) break;
      child.fire(w, pr.x, pr.y, angle + (i - (n - 1) / 2) * step, e);
      child.splitCount = pr.splitCount;
      child.splitsLeft = pr.splitsLeft - 1;
      for (const h of pr.hit) child.hit.add(h);
    }
  }

  /** Chain: bounce to the closest enemy this projectile has not hit, or a random direction when none is near. */
  private chain(pr: Projectile): void {
    pr.bouncesLeft--;
    let target: Enemy | null = null;
    let best = CHAIN_RANGE * CHAIN_RANGE;
    this.query.length = 0;
    this.game.enemies.grid.query(pr.x, pr.y, CHAIN_RANGE, this.query);
    for (const en of this.query) {
      if (!en.active || pr.hit.has(en)) continue;
      const d2 = (en.x - pr.x) ** 2 + (en.y - pr.y) ** 2;
      if (d2 < best) {
        best = d2;
        target = en;
      }
    }
    const angle = target ? Math.atan2(target.y - pr.y, target.x - pr.x) : this.game.rng.angle();
    pr.bounce(angle, CHAIN_RANGE / Math.max(1, pr.speed) + 0.1);
  }

  /**
   * A hit from an area weapon (sweeps, auras, stabs, breaths, strikes, orbiting objects). Applies duration effects
   * and queues Echo Strike echoes when the weapon has them (only AoE-tagged weapons do).
   */
  private areaHit(w: WeaponInstance, e: Effective, en: Enemy, dirX: number, dirY: number): void {
    const x = en.x;
    const y = en.y;
    this.game.enemies.hit(en, e.damage, dirX, dirY, e.knockback, w);
    this.applyEffect(w, e, en);
    for (let i = 0; i < e.echoRepeats; i++) {
      this.echoes.push({
        weapon: w,
        x,
        y,
        radius: e.echoRadius,
        amount: e.damage * e.echo,
        at: this.game.runTime + i * ECHO_GAP,
        source: en,
        sourceId: en.netId,
      });
    }
  }

  /**
   * Echoes that are due go off: each deals its share to every enemy within its radius, the enemy that was hit
   * included. Echo damage never echoes again.
   */
  private processEchoes(): void {
    if (this.echoes.length === 0) return;
    const now = this.game.runTime;
    let keep = 0;
    for (let i = 0; i < this.echoes.length; i++) {
      const ec = this.echoes[i];
      if (ec.at > now) {
        this.echoes[keep++] = ec;
        continue;
      }
      let sums = this.echoSums.get(ec.weapon);
      if (!sums) {
        sums = new Map();
        this.echoSums.set(ec.weapon, sums);
      }
      const src = ec.source.active && ec.source.netId === ec.sourceId ? ec.source : null;
      let srcHit = false;
      this.query.length = 0;
      this.game.enemies.grid.query(ec.x, ec.y, ec.radius + 16, this.query);
      for (const en of this.query) {
        if (!en.active) continue;
        const dx = en.x - ec.x;
        const dy = en.y - ec.y;
        const rr = ec.radius + en.radius;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (en === src) srcHit = true;
        sums.set(en, (sums.get(en) ?? 0) + ec.amount);
      }
      if (src && !srcHit) sums.set(src, (sums.get(src) ?? 0) + ec.amount);
      this.game.fx.echo(ec.x, ec.y, ec.radius, ec.weapon.def.color ?? 0xffffff);
    }
    this.echoes.length = keep;
    for (const [w, sums] of this.echoSums) {
      for (const [en, amount] of sums) this.game.enemies.hit(en, amount, 0, 0, 0, w);
      sums.clear();
    }
  }

  /** Duration weapons: a hit applies the weapon's effect (refreshing the stack it applied before) and may reiterate. */
  private applyEffect(w: WeaponInstance, e: Effective, en: Enemy): void {
    const def = w.def.effect;
    if (!def || e.effectDuration <= 0 || !en.active) return;
    let stack = en.effects.find((st) => st.weapon === w && !st.copy);
    if (stack) stack.left = e.effectDuration;
    else {
      stack = { weapon: w, left: e.effectDuration, next: def.interval, copy: false };
      en.effects.push(stack);
    }
    this.game.enemies.reiterate(en, stack, e.reiterate);
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
      if (w.level !== level) this.setLevel(w, level);
    }
  }

  /** Removes everything this player drew (player left). The list stays for the party screen. */
  destroy(): void {
    this.echoes.length = 0;
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

  /** Hides orbiters and effects, and drops repeats and echoes still to come (fallen, end of run). */
  clearVisuals(): void {
    for (const w of this.list) {
      for (const s of w.orbiters) s.setVisible(false);
      w.gfx?.clear();
      w.slashes.length = 0;
      w.repeatsLeft = 0;
      w.burstLeft = 0;
    }
    this.echoes.length = 0;
  }
}
