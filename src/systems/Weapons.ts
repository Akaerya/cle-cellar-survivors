import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH, INNER, MAX_EFFECT_STACKS, MAX_PROJECTILES, MAX_SHIELD_REDUCTION, STAB_LEAD } from '../constants';
import { applyLevelBonuses, hasTag, hasteFactor, modsForWeapon, splashModsFor, weaponLevelAt, type WeaponLevelStats } from '../core/progression';
import {
  CHAIN_RANGE,
  CHAIN_SPEED,
  ECHO_GAP,
  ECHO_RADIUS,
  IMPACT_RADIUS,
  MULTISTRIKE_GAP,
  RUTHLESS_EVERY,
  SPLIT_ARC,
  STUN_SECONDS,
  weaponDef,
} from '../data';
import { PLAYER_RADIUS } from '../data/player';
import type { ModEffect, WeaponDef, WeaponStats } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { CHARGE_KINDS, type Player } from '../entities/Player';
import { Projectile } from '../entities/Projectile';
import { nextNetId } from '../net/ids';
import type { GameScene } from '../scenes/GameScene';

let nextUid = 1;

interface Slash {
  angle: number;
  reach: number;
  /** Radians for sweeps and breaths, px (blade width) for stabs, px (cut length) for flicker strikes. */
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
  /** Totals of the owner's modifications for this weapon's Impact splash (all 0 without Impact, or for non-melee weapons). */
  splashMod: Required<ModEffect>;
  /** Repeats of the last attack still to come, and seconds until the next one. */
  repeatsLeft: number;
  repeatTimer: number;
  /** Seconds of crit refund this weapon can still take before it is next used (see `refundFloor`). */
  refundable: number;
  /** Weapons with `burst`: projectiles of the last attack still to come, seconds until the next, and the gap between them. */
  burstLeft: number;
  burstTimer: number;
  burstGap: number;
  /**
   * Attacks made so far, repeats included; also the number of the current attack, which its hits and projectiles
   * carry. Ruthless makes every RUTHLESS_EVERY-th one hit harder.
   */
  serial: number;
  /** The last attack (serial) Unstable Infusion rolled for: it rolls once per attack, on its first hit. */
  infused: number;
  /** Flicker Strike: seconds until the next check for a Shadow Charge to spend. */
  checkTimer: number;
  /** Flicker Strike: strikes waiting their turn (highest priority first), and seconds until the current one is done. */
  strikeQueue: StrikeSource[];
  strikeBusy: number;
  /** `seeker`: the blade's flight (null until it is first drawn, and after the owner fell). */
  seek: Seek | null;
}

/** A `seeker` blade (Carrot Sword): floats by its owner, dashes through an enemy, flies back. */
interface Seek {
  /** Identifies it to network clients (drawn in the snapshot's summon layer). */
  netId: number;
  x: number;
  y: number;
  /** Radians the art is turned (it is drawn pointing right). */
  angle: number;
  mode: 'wait' | 'out' | 'back';
  target: Enemy | null;
  targetId: number;
  /** Enemies cut on this dash (there and back): each once. */
  readonly hit: Set<Enemy>;
  /** Seconds since the dash started. */
  t: number;
  /** Stats of this dash (a Ruthless dash keeps its bonus there and back). */
  e: Effective | null;
}

/** Bonuses the owner's `petbuff` weapons give their pets. */
export interface PetBonus {
  damage: number;
  haste: number;
  speed: number;
}

/** One summon to draw on joiners' screens (pets and seeker blades), see GameScene.sendSnapshots. */
export interface SummonView {
  id: number;
  /** Atlas animation. */
  anim: string;
  x: number;
  y: number;
  /** Radians the art is turned. */
  angle: number;
  flip: boolean;
  giant: boolean;
}

/** What set off a Flicker Strike, in order of priority: the cooldown, a Multistrike repeat, a Shadow Charge. */
type StrikeSource = 'cooldown' | 'repeat' | 'shadow';
const STRIKE_PRIORITY: readonly StrikeSource[] = ['cooldown', 'repeat', 'shadow'];

/** Stats after the owner's multipliers (damage, cooldown, area) and modifications. */
export interface Effective extends WeaponStats {
  /** What the weapon's base damage is multiplied by in `damage` (Momentum's bonus is scaled the same way). */
  damageScale: number;
  /** Base damage before any bonus, and the multiplier of a Ruthless attack (used instead of `damageScale`). */
  baseDamage: number;
  ruthlessScale: number;
  ruthless: number;
  /** Projectiles: how many one splits into on hit (below 2: no split), how much less its splits deal, and their chance to split again. */
  split: number;
  splitLess: number;
  splitAgain: number;
  /** Projectiles: bounces once pierce is used up, how much less each bounce deals, and how much faster it flies. */
  chain: number;
  chainLess: number;
  chainSpeed: number;
  /** Echo Strike: fraction of an area hit dealt again (0 = none), its radius in px and how many times it goes off. */
  echo: number;
  echoRadius: number;
  echoRepeats: number;
  /** Duration effect: damage per tick and seconds a stack lasts (0 without an effect). */
  effectDamage: number;
  effectDuration: number;
  /** Duration effect (or buff): chance it copies itself when applied or when it deals damage. */
  reiterate: number;
  /** Fields: fraction of speed enemies inside lose. */
  slow: number;
  /** Multistrike: sure repeats of every attack, and the chance of one more after any attack. */
  multistrike: number;
  repeatChance: number;
  /** Stun: chance per hit, and how much more damage stunned enemies take. */
  stunChance: number;
  stunBonus: number;
  /** Momentum: share of the owner's current speed added to each hit's base damage. */
  momentum: number;
  /** Impact: share of a hit dealt as splash (0 = none), its radius, and Echo Strike on the splash. */
  impact: number;
  splashRadius: number;
  splashEcho: number;
  splashEchoRadius: number;
  splashEchoRepeats: number;
}

/** A freezing field (`field` weapons): stays where it was cast, slows enemies on it and applies the weapon's effect. */
interface Field {
  weapon: WeaponInstance;
  x: number;
  y: number;
  radius: number;
  /** Seconds left, and seconds until the next check for enemies on the field. */
  left: number;
  next: number;
}

/** A lingering beam (dome ultimate): hits every enemy that touches it once. */
interface Beam {
  weapon: WeaponInstance;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  halfWidth: number;
  left: number;
  readonly hit: Set<Enemy>;
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
  /** The attack it came from (WeaponInstance.serial). */
  serial: number;
}

const DEG = Math.PI / 180;
/** px a projectile that ricochets off a dome edge is put back inside the dome. */
const DOME_INSET = 1;
/** Seconds of slack for field timers, so a check due at the very end of a field's time does not run. */
const FIELD_EPSILON = 1e-6;
/** Seconds of slack for Flicker Strike's strike time, so float drift does not push the next strike a frame late. */
const STRIKE_EPSILON = 1e-6;
/** Targeting types drawn with the slash graphics (redrawn every frame while effects play). */
const SLASHERS = new Set(['facing', 'stab', 'breath', 'spin', 'flicker']);
/** Flicker Strike lands this many px past the edge of the enemy it cuts. */
const FLICKER_GAP = 3;
/** Impact: splash rings drawn per weapon per frame at most (the damage still lands everywhere). */
const MAX_SPLASH_RINGS = 6;
/**
 * Seeker blades: radians per second they circle their owner while waiting, how fast they ease to that spot, and how
 * close (px) to it counts as back. A dash gives up after this many times its longest flight there and back.
 */
const SEEK_CIRCLE = 1.6;
const SEEK_EASE = 10;
const SEEK_HOME = 6;
const SEEK_GIVE_UP = 2.5;

/**
 * Runs every weapon one character has equipped. Behaviour comes from the weapon's `targeting` and stats, so a new
 * weapon is a data entry: `nearest` / `random` / `facing` fire projectiles (or sweep if speed is 0),
 * `orbit` keeps objects circling the owner, `aura` damages everything in a radius on a tick,
 * `stab` thrusts a blade at the nearest enemy, `breath` sprays a cone at it, `strike` calls bolts down
 * around the owner, `shield` puts Aegis on its owner every cooldown (it blocks a hit), absorbs part of the rest and
 * reflects damage, `bomb` throws a projectile that explodes on reaching its target, `field` conjures freezing fields
 * under enemies, `wave` sends a sword wave that cuts through everything until it reaches its target, `spin` swings
 * all around the owner, `flicker` teleports the owner onto a random enemy, `seeker` floats a blade by the owner that
 * dashes through the nearest enemy within `range` and flies back, and `passive` / `infusion` weapons only change how
 * the others work (critical strikes, charges). `petbuff` and `armory` weapons do nothing here: the owner's pets
 * (systems/Pets.ts) read them. `beam` is for ultimate attacks: lingering beams across a dome.
 * The owner's modifications (data/modifications.ts) are folded into `eff()` by weapon tag; this class also
 * runs what they add: projectile splits and chains, Echo Strike echoes, duration effects on enemies, and for melee
 * weapons Multistrike repeats, Ruthless attacks, Stun, Momentum and Impact splashes.
 */
export class Weapons {
  readonly list: WeaponInstance[] = [];
  private query: Enemy[] = [];
  /** Separate from `query`: splashes are queued from inside loops over `query`. */
  private splashQuery: Enemy[] = [];
  private echoes: Echo[] = [];
  /** Echo damage summed per weapon and enemy, so one frame of echoes is one hit (and one number) per enemy. */
  private echoSums = new Map<WeaponInstance, Map<Enemy, number>>();
  /** Impact splash damage summed per weapon and enemy the same way, dealt at the end of the frame. */
  private splashSums = new Map<WeaponInstance, Map<Enemy, number>>();
  private splashRings = 0;
  private fields: Field[] = [];
  private beams: Beam[] = [];
  /** A reflected hit can set off Thorns, which hurts the owner again: no reflecting from inside a reflect. */
  private reflecting = false;

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
      splashMod: splashModsFor(def, this.owner.mods),
      repeatsLeft: 0,
      repeatTimer: 0,
      burstLeft: 0,
      burstTimer: 0,
      burstGap: 0,
      refundable: 0,
      serial: 0,
      infused: -1,
      checkTimer: 0,
      strikeQueue: [],
      strikeBusy: 0,
      seek: null,
    };
  }

  levelUp(id: string): void {
    const w = this.get(id);
    if (!w) return;
    this.setLevel(w, w.level + 1);
  }

  /** Sets the level of `w` (equipped or not: pets keep their gear at the armory's level). */
  setLevel(w: WeaponInstance, level: number): void {
    w.level = level;
    w.levelStats = weaponLevelAt(w.def, level);
    w.stats = applyLevelBonuses(w.levelStats);
  }

  /** The owner's modifications changed: recompute what they add to every weapon and to the ultimate's attack. */
  refreshMods(): void {
    const mods = this.owner.mods;
    for (const w of this.list) {
      w.mod = modsForWeapon(w.def, mods);
      w.splashMod = splashModsFor(w.def, mods);
    }
    const ult = this.owner.ultimate?.attack;
    if (ult) {
      ult.mod = modsForWeapon(ult.def, mods);
      ult.splashMod = splashModsFor(ult.def, mods);
    }
  }

  eff(w: WeaponInstance): Effective {
    const p = this.owner;
    const st = p.stats;
    const s = w.stats;
    const { base, pct } = w.levelStats;
    const m = w.mod;
    const sm = w.splashMod;
    // Percent bonuses add up into one sum per stat. Area: the weapon's own size levels, the AREA stat and area
    // modifications (only AoE weapons get those). Damage: the weapon's own damage levels and modification
    // bonuses; only DAMAGE (the Damage powerup, Mistwalker) multiplies the result.
    const area = Math.max(0.1, st.areaMult + (pct.size ?? 0) + m.area);
    const damageSum = 1 + (pct.damage ?? 0) + m.damage;
    const damageScale = damageSum * p.damageMult;
    const durationMult = Math.max(0.1, 1 + m.duration);
    const effect = w.def.effect;
    let cooldown = Math.max(0.05, s.cooldown * st.cooldownMult * hasteFactor(st.abilityHaste));
    // Aegis is an effect on the owner: duration modifications make it come back sooner or later.
    if (w.def.targeting === 'shield') cooldown /= durationMult;
    // The splash of a weapon that is not AoE itself gets the AoE modifications' damage bonus on top of the hit.
    const splashDamage = hasTag(w.def, 'aoe') ? 1 : 1 + sm.damage;
    return {
      ...s,
      damage: base.damage * damageScale,
      damageScale,
      baseDamage: base.damage,
      ruthlessScale: (damageSum + m.ruthless) * p.damageMult,
      ruthless: m.ruthless,
      cooldown,
      size: base.size * area,
      range: w.def.targeting === 'orbit' ? s.range * st.areaMult : s.range,
      pierce: s.pierce + m.pierce,
      projectileCount: s.projectileCount + m.projectiles,
      split: m.split,
      splitLess: m.splitLess,
      splitAgain: m.splitAgain,
      chain: m.chain,
      chainLess: m.chainLess,
      chainSpeed: m.chainSpeed,
      echo: m.echo,
      // Echoes grow with AREA and area modifications, not with the weapon's own size levels.
      echoRadius: ECHO_RADIUS * Math.max(0.1, st.areaMult + m.area + m.echoArea),
      echoRepeats: m.echo > 0 ? Math.max(1, Math.round(m.echoRepeats)) : 0,
      // Duration modifications stretch how long the weapon's fields, beams and effects last.
      lifetime: s.lifetime * durationMult,
      effectDamage: effect ? effect.damage * damageScale : 0,
      effectDuration: effect ? effect.duration * durationMult : 0,
      reiterate: m.reiterate,
      slow: s.slow ?? 0,
      multistrike: m.multistrike,
      repeatChance: m.repeatChance,
      stunChance: m.stunChance,
      stunBonus: m.stunBonus,
      momentum: m.momentum,
      impact: sm.impact * splashDamage,
      splashRadius: IMPACT_RADIUS * Math.max(0.1, st.areaMult + sm.area),
      splashEcho: sm.echo,
      splashEchoRadius: ECHO_RADIUS * Math.max(0.1, st.areaMult + sm.area + sm.echoArea),
      splashEchoRepeats: sm.echo > 0 ? Math.max(1, Math.round(sm.echoRepeats)) : 0,
    };
  }

  /** `e` for a Ruthless attack: the Ruthless bonus joins the damage sum. */
  private ruthlessOf(e: Effective): Effective {
    return { ...e, damage: e.baseDamage * e.ruthlessScale, damageScale: e.ruthlessScale };
  }

  /**
   * `firing` false only animates (joiners draw remote weapons this way; the host does the hitting). While the owner
   * is mist (Mistwalker) nothing attacks, but cooldowns keep counting.
   */
  update(dt: number, firing: boolean): void {
    const locked = this.owner.misted;
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
        case 'field':
        case 'wave':
        case 'spin':
          if (firing) this.tickShooter(w, e, dt, locked);
          break;
        case 'flicker':
          if (firing) this.updateFlicker(w, e, dt, locked);
          break;
        case 'shield':
          this.updateShield(w, e, dt, firing);
          break;
        case 'orbit':
          this.updateOrbit(w, e, dt, firing && !locked);
          break;
        case 'aura':
          this.updateAura(w, e, dt, firing && !locked);
          break;
        case 'seeker':
          // Joiners draw the blade from the snapshot's summon layer.
          if (firing) this.updateSeeker(w, e, dt, locked);
          break;
      }
      if (w.gfx && SLASHERS.has(w.def.targeting)) this.drawSlashes(w, dt);
    }
    if (firing) {
      this.updateFields(dt);
      this.updateBeams(dt);
      this.processSplashes();
      this.processEchoes();
    }
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
        continue;
      }
      if (!alive || hitWall) {
        Weapons.release(pr);
        continue;
      }
      const dome = o.ultimate?.dome();
      if (dome) o.weapons.domeEdge(pr, dome);
      pr.prevX = pr.x;
      pr.prevY = pr.y;
    }
  }

  private tickShooter(w: WeaponInstance, e: Effective, dt: number, locked: boolean): void {
    const burst = w.def.burst;
    if (w.burstLeft > 0 && burst) {
      w.burstTimer -= dt;
      while (w.burstLeft > 0 && w.burstTimer <= 0) {
        w.burstLeft--;
        w.burstTimer += w.burstGap;
        const p = this.owner;
        const nearest = this.game.enemies.nearest(p.x, p.y, e.range);
        const target = burst.target === 'random' ? (this.randomOnScreen() ?? nearest) : nearest;
        // With nothing to aim at, that projectile is skipped (the rest of the burst carries on).
        if (target && !locked) {
          this.fireAt(w, e, target);
          this.game.playSfx('throw', p.x, p.y);
        }
      }
    }
    if (w.repeatsLeft > 0) {
      w.repeatTimer -= dt;
      if (w.repeatTimer <= 0) {
        w.repeatsLeft--;
        w.repeatTimer += this.repeatGap(w, e);
        if (!locked) this.perform(w, e);
      }
    }
    w.timer -= dt;
    if (w.timer > 0) return;
    const fired = !locked && this.perform(w, e, true);
    // Hold fire with no target (or while locked): stay ready and attack the moment it can.
    w.timer = fired ? Math.max(w.timer + e.cooldown, e.cooldown * 0.5) : 0;
    if (fired) w.refundable = this.refundShare() * e.cooldown;
  }

  /**
   * One attack of a shooter weapon. It is counted (Ruthless makes every RUTHLESS_EVERY-th one hit harder), and
   * `first` (the attack that used the cooldown) brings the weapon's own repeats and Multistrike's sure ones. Any
   * attack, a repeat included, may add one more with Multistrike's chance. Returns false when it held fire.
   */
  private perform(w: WeaponInstance, e: Effective, first = false): boolean {
    w.serial++;
    const ruthless = e.ruthless > 0 && w.serial % RUTHLESS_EVERY === 0;
    if (!this.attack(w, ruthless ? this.ruthlessOf(e) : e)) {
      w.serial--;
      return false;
    }
    let more = first ? Math.round(e.repeat ?? 0) + Math.round(e.multistrike) : 0;
    if (e.repeatChance > 0 && this.game.rng.float() < e.repeatChance) more++;
    if (more > 0) {
      if (w.repeatsLeft <= 0) w.repeatTimer = this.repeatGap(w, e);
      w.repeatsLeft += more;
    }
    return true;
  }

  /** Seconds between repeats: the weapon's delay (or Multistrike's), shortened so the sure repeats land before the next attack. */
  private repeatGap(w: WeaponInstance, e: Effective): number {
    const n = Math.max(1, Math.round(e.repeat ?? 0) + Math.round(e.multistrike));
    return Math.min(w.def.repeatDelay ?? MULTISTRIKE_GAP, e.cooldown / (n + 1));
  }

  /** One attack of a shooter weapon. Returns false when it held fire (no target). */
  private attack(w: WeaponInstance, e: Effective): boolean {
    let fired = false;
    const p = this.owner;
    const t = w.def.targeting;
    if (t === 'nearest') {
      const target = this.game.enemies.nearest(p.x, p.y, e.range);
      if (target) {
        if (w.def.burst) this.startBurst(w, e, target);
        else this.volley(w, e, Math.atan2(target.y - p.y, target.x - p.x));
        fired = true;
      }
    } else if (t === 'random') {
      this.volley(w, e, this.game.rng.angle());
      fired = true;
    } else if (t === 'stab' || t === 'breath') {
      const reach = e.size + (t === 'stab' ? STAB_LEAD : 0);
      const target = this.game.enemies.nearest(p.x, p.y, reach);
      if (target) {
        const angle = Math.atan2(target.y - p.y, target.x - p.x);
        if (t === 'stab') this.stab(w, e, angle);
        else this.sweep(w, e, angle);
        fired = true;
      }
    } else if (t === 'spin') {
      // Swings once something is within reach (its body touching the circle).
      if (this.game.enemies.nearest(p.x, p.y, e.size + STAB_LEAD)) {
        this.sweep(w, e, Math.atan2(p.facing.y, p.facing.x));
        fired = true;
      }
    } else if (t === 'strike') {
      this.strike(w, e);
      fired = true;
    } else if (t === 'bomb') {
      const target = this.game.enemies.nearest(p.x, p.y, e.range);
      if (target) {
        this.startBurst(w, e, target);
        fired = true;
      }
    } else if (t === 'field') {
      fired = this.castFields(w, e);
    } else if (t === 'wave') {
      fired = this.waves(w, e);
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
    const shot = this.shot(w, e);
    for (let i = 0; i < n; i++) {
      const angle = base + (i - (n - 1) / 2) * e.spread * DEG;
      const pr = this.projectiles.get(p.x, p.y) as Projectile | null;
      if (!pr) break;
      pr.fire(w, p.x, p.y - 2, angle, shot);
    }
    this.game.playSfx('throw', p.x, p.y);
  }

  /**
   * Stats a projectile of `w` is fired with. Weapons whose `size` is a blast radius (bombs, blast-on-hit) fly at the
   * size of their art; bombs never split or chain since they touch nothing on the way. Sword waves live just long
   * enough to travel RANGE.
   */
  private shot(w: WeaponInstance, e: Effective): Effective {
    if (w.def.targeting === 'bomb') return { ...e, size: w.def.artRadius ?? 5, split: 0, chain: 0 };
    if (w.def.blastOnHit) return { ...e, size: w.def.artRadius ?? 5 };
    if (w.def.targeting === 'wave') return { ...e, lifetime: e.range / Math.max(1, e.speed) };
    return e;
  }

  /**
   * The first projectile goes at `first` (the closest enemy). With `burst`, the others follow one at a time over part
   * of the cooldown (see BurstDef); without it, bombs throw them all now at random enemies on screen.
   */
  private startBurst(w: WeaponInstance, e: Effective, first: Enemy): void {
    const p = this.owner;
    this.fireAt(w, e, first);
    const n = Math.max(1, Math.round(e.projectileCount));
    const burst = w.def.burst;
    if (n > 1 && burst) {
      w.burstLeft = n - 1;
      w.burstGap = (burst.window * e.cooldown) / (burst.spacing === 'end' ? n - 1 : n);
      w.burstTimer = w.burstGap;
    } else {
      for (let i = 1; i < n; i++) this.fireAt(w, e, this.randomOnScreen() ?? first);
    }
    this.game.playSfx('throw', p.x, p.y);
  }

  /** One projectile of `w` at `target`: a bomb that homes in on it, or a straight shot toward where it is now. */
  private fireAt(w: WeaponInstance, e: Effective, target: Enemy): void {
    if (w.def.targeting === 'bomb') {
      this.throwBomb(w, e, target);
      return;
    }
    const p = this.owner;
    const pr = this.projectiles.get(p.x, p.y) as Projectile | null;
    if (!pr) return;
    pr.fire(w, p.x, p.y - 2, Math.atan2(target.y - p.y, target.x - p.x), this.shot(w, e));
  }

  /** One bomb at `target`. It flies at art size, touches nothing on the way, and explodes on reaching the target. */
  private throwBomb(w: WeaponInstance, e: Effective, target: Enemy): void {
    const p = this.owner;
    const pr = this.projectiles.get(p.x, p.y) as Projectile | null;
    if (!pr) return;
    const angle = Math.atan2(target.y - p.y, target.x - p.x);
    pr.fire(w, p.x, p.y - 2, angle, this.shot(w, e));
    pr.aim(target);
  }

  /** A random living enemy on the owner's screen, or null when there is none. */
  private randomOnScreen(): Enemy | null {
    const list: Enemy[] = [];
    for (const en of this.game.enemies.active) if (en.active && this.game.onScreen(this.owner, en.x, en.y)) list.push(en);
    return list.length > 0 ? this.game.rng.pick(list) : null;
  }

  /** Living enemies within `range` px of (x, y). */
  private inRange(x: number, y: number, range: number): Enemy[] {
    const near: Enemy[] = [];
    this.game.enemies.grid.query(x, y, range, near);
    return near.filter((en) => en.active && (en.x - x) ** 2 + (en.y - y) ** 2 <= range * range);
  }

  /** A bomb explodes where it is. */
  explode(pr: Projectile): void {
    const x = pr.x;
    const y = pr.y;
    Weapons.release(pr);
    this.blast(pr.weapon, x, y);
  }

  /** A blast of `w` at (x, y): everything within the weapon's area is hit (an area hit, so AoE modifications apply). */
  private blast(w: WeaponInstance, x: number, y: number): void {
    const e = this.eff(w);
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
    if (w.def.blastStyle === 'frost') {
      this.game.fx.frost(x, y, e.size, w.def.color ?? 0xc8ecff);
      this.game.playSfx('shatter', x, y);
    } else {
      this.game.fx.blast(x, y, e.size, w.def.color ?? 0xffffff);
      this.game.playSfx('boom', x, y);
    }
  }

  // ---------------------------------------------------------------- sword waves and flicker strikes (Zorus)

  /** `wave`: a sword wave at the closest enemy within RANGE; extra waves go at random enemies in range. */
  private waves(w: WeaponInstance, e: Effective): boolean {
    const p = this.owner;
    const first = this.game.enemies.nearest(p.x, p.y, e.range);
    if (!first) return false;
    const n = Math.max(1, Math.round(e.projectileCount));
    const near = n > 1 ? this.inRange(p.x, p.y, e.range) : [];
    const shot = this.shot(w, e);
    for (let i = 0; i < n; i++) {
      const t = i === 0 || near.length === 0 ? first : this.game.rng.pick(near);
      const pr = this.projectiles.get(p.x, p.y) as Projectile | null;
      if (!pr) break;
      pr.fire(w, p.x, p.y - 2, Math.atan2(t.y - p.y, t.x - p.x), shot);
      pr.seek(t);
    }
    this.game.playSfx('slash', p.x, p.y);
    return true;
  }

  /**
   * `flicker`: the owner teleports just past a random enemy on their screen and cuts it. The move is instant, so it
   * counts as standing still (no Momentum). False when no enemy is on screen.
   */
  private flicker(w: WeaponInstance, e: Effective): boolean {
    const p = this.owner;
    const target = this.randomOnScreen();
    if (!target) return false;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const off = target.radius + PLAYER_RADIUS + FLICKER_GAP;
    const margin = PLAYER_RADIUS + 2;
    const x = Phaser.Math.Clamp(target.x + ux * off, INNER.left + margin, INNER.right - margin);
    const y = Phaser.Math.Clamp(target.y + uy * off, INNER.top + margin, INNER.bottom - margin);
    const color = w.def.color ?? 0xb48cff;
    this.game.fx.beam(p.x, p.y, x, y, 2, 0.18, color);
    this.game.fx.puff(p.x, p.y, color, 6);
    this.game.teleport(p, x, y);
    this.directHit(w, e, target, e.damage, e.damageScale, ux, uy, e.knockback, false);
    const angle = Math.atan2(uy, ux);
    const dur = Math.max(0.15, e.lifetime);
    // The cut is drawn across the enemy, `off` px behind where the owner lands.
    w.slashes.push({ angle, reach: off, arc: e.size, t: 0, dur });
    this.game.relay(['w', p.slot, this.list.indexOf(w), angle, off, e.size, dur]);
    this.game.playSfx('blink', x, y);
    return true;
  }

  /**
   * Flicker Strike. Strikes come from three sources, in this order of priority: the cooldown running out (it starts
   * again right away), Multistrike repeats, and Shadow Charges (every `shadow.check` seconds one is spent, unless a
   * Shadow Charge strike is already waiting). One strike happens at a time and takes `strikeTime`; strikes that come up
   * meanwhile wait their turn, highest priority first. While the owner is mist, the cooldown counts but nothing else
   * happens.
   */
  private updateFlicker(w: WeaponInstance, e: Effective, dt: number, locked: boolean): void {
    const p = this.owner;
    const shadow = w.def.shadow;
    w.timer = Math.max(0, w.timer - dt);
    w.strikeBusy = Math.max(0, w.strikeBusy - dt);
    w.checkTimer -= dt;
    if (locked) return;
    // With nothing on screen to strike, the cooldown stays ready and charges are kept.
    const target = this.anyOnScreen();
    if (w.timer <= 0 && target) {
      w.timer = e.cooldown;
      w.refundable = this.refundShare() * e.cooldown;
      this.queueStrike(w, 'cooldown');
    }
    if (shadow && w.checkTimer <= 0) {
      w.checkTimer = shadow.check;
      if (p.shadow > 0 && target && !w.strikeQueue.includes('shadow')) {
        p.shadow--;
        this.queueStrike(w, 'shadow');
      }
    }
    if (w.strikeBusy > STRIKE_EPSILON || w.strikeQueue.length === 0) return;
    const source = w.strikeQueue.shift()!;
    w.strikeBusy = w.def.strikeTime ?? 0;
    this.flickerStrike(w, e, source);
  }

  /** Puts a Flicker Strike from `source` in the queue, behind those of the same or a higher priority. */
  private queueStrike(w: WeaponInstance, source: StrikeSource): void {
    const rank = STRIKE_PRIORITY.indexOf(source);
    const q = w.strikeQueue;
    let i = q.length;
    while (i > 0 && STRIKE_PRIORITY.indexOf(q[i - 1]) > rank) i--;
    q.splice(i, 0, source);
  }

  /**
   * One Flicker Strike, counted as an attack (Ruthless). The cooldown's strike brings Multistrike's sure repeats, and
   * any strike may bring one more by chance; repeats never spend a Shadow Charge. With nothing left on screen, the
   * cooldown is ready again, a Shadow Charge is given back and a repeat is lost.
   */
  private flickerStrike(w: WeaponInstance, e: Effective, source: StrikeSource): void {
    const p = this.owner;
    w.serial++;
    const ruthless = e.ruthless > 0 && w.serial % RUTHLESS_EVERY === 0;
    if (!this.flicker(w, ruthless ? this.ruthlessOf(e) : e)) {
      w.serial--;
      if (source === 'cooldown') w.timer = 0;
      else if (source === 'shadow') p.shadow++;
      return;
    }
    let more = source === 'cooldown' ? Math.round(e.multistrike) : 0;
    if (e.repeatChance > 0 && this.game.rng.float() < e.repeatChance) more++;
    for (let i = 0; i < more; i++) this.queueStrike(w, 'repeat');
  }

  /** True when a living enemy is on the owner's screen. */
  private anyOnScreen(): boolean {
    for (const en of this.game.enemies.active) if (en.active && this.game.onScreen(this.owner, en.x, en.y)) return true;
    return false;
  }

  // ---------------------------------------------------------------- freezing fields

  /** `field`: one field under the closest enemy in range, the others under random enemies in range. */
  private castFields(w: WeaponInstance, e: Effective): boolean {
    const p = this.owner;
    const first = this.game.enemies.nearest(p.x, p.y, e.range);
    if (!first) return false;
    const n = Math.max(1, Math.round(e.projectileCount));
    const inRange = this.inRange(p.x, p.y, e.range);
    const fresh = inRange.filter((en) => en !== first);
    const targets = [first];
    // Different enemies while there are enough; after that, any enemy in range again.
    for (let i = 1; i < n; i++) {
      if (fresh.length > 0) targets.push(fresh.splice(this.game.rng.int(0, fresh.length - 1), 1)[0]);
      else targets.push(inRange.length > 0 ? this.game.rng.pick(inRange) : first);
    }
    for (const t of targets) {
      this.fields.push({ weapon: w, x: t.x, y: t.y, radius: e.size, left: e.lifetime, next: 0 });
      this.game.fx.vortex(t.x, t.y, e.size, e.lifetime, w.def.color ?? 0x9fe4ff);
    }
    this.game.playSfx('freeze', p.x, p.y);
    return true;
  }

  /**
   * Fields slow every enemy on them, and on every check (when they appear, then every `fieldInterval` seconds) each
   * field applies the weapon's effect to every enemy on it: two fields on one enemy give it two stacks.
   */
  private updateFields(dt: number): void {
    if (this.fields.length === 0) return;
    const now = this.game.time.now;
    let keep = 0;
    for (const f of this.fields) {
      // Done once its time is up (the small margin stops float drift from adding a check at exactly the end).
      if (f.left <= FIELD_EPSILON) continue;
      const w = f.weapon;
      const e = this.eff(w);
      const check = f.next <= FIELD_EPSILON;
      if (check) f.next += w.def.fieldInterval ?? 1;
      this.query.length = 0;
      this.game.enemies.grid.query(f.x, f.y, f.radius + 16, this.query);
      for (const en of this.query) {
        if (!en.active) continue;
        const rr = f.radius + en.radius * 0.5;
        if ((en.x - f.x) ** 2 + (en.y - f.y) ** 2 > rr * rr) continue;
        if (e.slow > 0) this.game.enemies.slow(en, e.slow, now);
        if (check) this.applyEffect(w, e, en);
      }
      f.left -= dt;
      f.next -= dt;
      if (f.left > 0) this.fields[keep++] = f;
    }
    this.fields.length = keep;
  }

  // ---------------------------------------------------------------- beams (dome ultimate)

  /** A beam of `w` from (x1, y1) to (x2, y2) that lingers for the weapon's lifetime, hitting each enemy once. */
  beam(w: WeaponInstance, x1: number, y1: number, x2: number, y2: number): void {
    const e = this.eff(w);
    w.serial++;
    this.beams.push({ weapon: w, x1, y1, x2, y2, halfWidth: e.size, left: e.lifetime, hit: new Set() });
    this.game.fx.beam(x1, y1, x2, y2, e.size * 2, e.lifetime, w.def.color ?? 0xffb8e6);
    this.game.playSfx('laser', (x1 + x2) / 2, (y1 + y2) / 2);
  }

  private updateBeams(dt: number): void {
    if (this.beams.length === 0) return;
    let keep = 0;
    for (const b of this.beams) {
      const e = this.eff(b.weapon);
      const dx = b.x2 - b.x1;
      const dy = b.y2 - b.y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      this.query.length = 0;
      this.game.enemies.grid.query((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, len / 2 + b.halfWidth + 16, this.query);
      for (const en of this.query) {
        if (!en.active || b.hit.has(en)) continue;
        const rx = en.x - b.x1;
        const ry = en.y - b.y1;
        const along = rx * ux + ry * uy;
        if (along < -en.radius || along > len + en.radius) continue;
        const side = rx * -uy + ry * ux;
        if (Math.abs(side) > b.halfWidth + en.radius) continue;
        b.hit.add(en);
        const s = side >= 0 ? 1 : -1;
        this.areaHit(b.weapon, e, en, -uy * s, ux * s);
      }
      b.left -= dt;
      if (b.left > 0) this.beams[keep++] = b;
    }
    this.beams.length = keep;
  }

  // ---------------------------------------------------------------- dome edge (dome ultimate)

  /**
   * The owner's dome is up: a projectile inside it that reaches the edge treats the edge like an enemy it can split
   * on, but it uses up no pierce or bounces, deals no damage, and ricochets toward the closest enemy inside the dome
   * that it has not hit (straight back off the edge when there is none).
   */
  domeEdge(pr: Projectile, dome: { x: number; y: number; r: number }): void {
    const px = pr.prevX - dome.x;
    const py = pr.prevY - dome.y;
    const cx = pr.x - dome.x;
    const cy = pr.y - dome.y;
    const r2 = dome.r * dome.r;
    if (px * px + py * py >= r2 || cx * cx + cy * cy < r2) return;
    // Where the step from inside to outside crosses the edge.
    const dx = cx - px;
    const dy = cy - py;
    const a = dx * dx + dy * dy || 1;
    const b = 2 * (px * dx + py * dy);
    const c = px * px + py * py - r2;
    const t = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
    const nx0 = px + dx * t;
    const ny0 = py + dy * t;
    const nl = Math.hypot(nx0, ny0) || 1;
    const nx = nx0 / nl;
    const ny = ny0 / nl;
    const ex = dome.x + nx * (dome.r - DOME_INSET);
    const ey = dome.y + ny * (dome.r - DOME_INSET);
    let target: Enemy | null = null;
    let best = Infinity;
    for (const en of this.game.enemies.active) {
      if (!en.active || pr.hit.has(en)) continue;
      const d2 = (en.x - dome.x) ** 2 + (en.y - dome.y) ** 2;
      if (d2 >= r2) continue;
      const e2 = (en.x - ex) ** 2 + (en.y - ey) ** 2;
      if (e2 < best) {
        best = e2;
        target = en;
      }
    }
    let angle: number;
    if (target) angle = Math.atan2(target.y - ey, target.x - ex);
    else {
      const dot = pr.dirX * nx + pr.dirY * ny;
      angle = Math.atan2(pr.dirY - 2 * dot * ny, pr.dirX - 2 * dot * nx);
    }
    if (pr.splitsLeft > 0) {
      (pr.body as Phaser.Physics.Arcade.Body).reset(ex, ey);
      this.split(pr, angle);
      Weapons.release(pr);
      return;
    }
    pr.ricochet(ex, ey, angle);
  }

  /**
   * Fires one projectile of `w` from anywhere (ultimates, pets); each one is an attack of its own. `boost` multiplies
   * its damage (pet bonuses). False when the pool is empty.
   */
  shoot(w: WeaponInstance, x: number, y: number, angle: number, boost = 1): boolean {
    const pr = this.projectiles.get(x, y) as Projectile | null;
    if (!pr) return false;
    w.serial++;
    const e = this.eff(w);
    pr.fire(w, x, y, angle, boost === 1 ? e : { ...e, damage: e.damage * boost, damageScale: e.damageScale * boost });
    return true;
  }

  /**
   * A pet's hit with `w` on `en` (headbutts, stomps, gear swords): `boost` multiplies the damage (pet bonuses) and
   * (dirX, dirY) is the knockback direction. Call `startAttack` first for each attack (a stomp hitting many is one).
   * Returns whether it landed.
   */
  petHit(w: WeaponInstance, en: Enemy, boost: number, dirX: number, dirY: number): boolean {
    const e = this.eff(w);
    return this.directHit(w, e, en, e.damage * boost, e.damageScale * boost, dirX, dirY, e.knockback, true);
  }

  /** Counts a new attack of `w` (its hits carry it), for weapons fired from outside this class. */
  startAttack(w: WeaponInstance): void {
    w.serial++;
  }

  /** What the owner's `petbuff` weapons add to their pets, summed. */
  petBonus(): PetBonus {
    const b = { damage: 0, haste: 0, speed: 0 };
    for (const w of this.list) {
      if (w.def.targeting !== 'petbuff') continue;
      b.damage += w.stats.petDamage ?? 0;
      b.haste += w.stats.petHaste ?? 0;
      b.speed += w.stats.petSpeed ?? 0;
    }
    return b;
  }

  /** The owner's `armory` weapon (pet gear), or null. */
  armory(): WeaponInstance | null {
    for (const w of this.list) if (w.def.gear?.length) return w;
    return null;
  }

  // ---------------------------------------------------------------- seeker blades (Carrot Sword)

  /**
   * `seeker`: the blade circles its owner `hover` px away. Once its cooldown is up it dashes at the closest enemy
   * within RANGE of the owner, cutting every enemy it touches on the way there and back (each once per dash); the
   * cooldown counts from the start of the dash. Multistrike repeats are more dashes right after it is back. While the
   * owner is mist it waits.
   */
  private updateSeeker(w: WeaponInstance, e: Effective, dt: number, locked: boolean): void {
    const p = this.owner;
    const hover = w.def.hover ?? 0;
    if (!w.seek) {
      w.seek = { netId: nextNetId(), x: p.x, y: p.y - hover, angle: -Math.PI / 2, mode: 'wait', target: null, targetId: 0, hit: new Set(), t: 0, e: null };
    }
    const k = w.seek;
    let sprite = w.orbiters[0];
    if (!sprite) {
      sprite = this.game.add.sprite(k.x, k.y, ATLAS, 'px').setDepth(DEPTH.projectiles);
      if (w.def.projectileAnim) sprite.play(w.def.projectileAnim);
      w.orbiters.push(sprite);
    }
    w.orbitAngle = (w.orbitAngle + SEEK_CIRCLE * dt) % (Math.PI * 2);
    const hx = p.x + Math.cos(w.orbitAngle) * hover;
    const hy = p.y - 4 + Math.sin(w.orbitAngle) * hover * 0.6;
    w.timer = Math.max(0, w.timer - dt);
    if (k.mode === 'wait') {
      const ease = 1 - Math.exp(-dt * SEEK_EASE);
      k.x += (hx - k.x) * ease;
      k.y += (hy - k.y) * ease;
      // Blade up, swaying a little.
      k.angle = -Math.PI / 2 + Math.sin(w.orbitAngle * 2) * 0.25;
      if (!locked && (w.timer <= 0 || w.repeatsLeft > 0)) {
        const first = w.timer <= 0;
        if (this.dash(w, e, first)) {
          if (first) {
            w.timer = e.cooldown;
            w.refundable = this.refundShare() * e.cooldown;
          } else w.repeatsLeft--;
        }
      }
    } else {
      const de = k.e ?? e;
      const speed = Math.max(1, de.speed);
      k.t += dt;
      let tx = hx;
      let ty = hy;
      if (k.mode === 'out') {
        const t = k.target;
        if (!t || !t.active || t.netId !== k.targetId) k.mode = 'back';
        else {
          tx = t.x;
          ty = t.y;
        }
      }
      const dx = tx - k.x;
      const dy = ty - k.y;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, speed * dt);
      k.x += (dx / d) * step;
      k.y += (dy / d) * step;
      if (d > 0.5) k.angle = Math.atan2(dy, dx);
      this.seekerCuts(w, de, dx / d, dy / d);
      const reached = d - step <= (k.mode === 'out' ? (k.target?.radius ?? 0) * 0.5 : SEEK_HOME);
      const lost = k.t > ((e.range * 2) / speed) * SEEK_GIVE_UP + 0.5;
      if (k.mode === 'out' && (reached || lost)) k.mode = 'back';
      else if (k.mode === 'back' && (reached || lost)) {
        k.mode = 'wait';
        k.e = null;
      }
    }
    sprite
      .setVisible(true)
      .setPosition(Math.round(k.x), Math.round(k.y))
      .setRotation(k.angle)
      .setScale(e.size / (w.def.artRadius ?? 5));
  }

  /** Starts a dash at the closest enemy within range of the owner. `first`: the cooldown's dash (brings Multistrike's sure repeats). */
  private dash(w: WeaponInstance, e: Effective, first: boolean): boolean {
    const p = this.owner;
    const k = w.seek!;
    const target = this.game.enemies.nearest(p.x, p.y, e.range);
    if (!target) return false;
    w.serial++;
    const ruthless = e.ruthless > 0 && w.serial % RUTHLESS_EVERY === 0;
    k.e = ruthless ? this.ruthlessOf(e) : e;
    k.mode = 'out';
    k.target = target;
    k.targetId = target.netId;
    k.hit.clear();
    k.t = 0;
    let more = first ? Math.round(e.multistrike) : 0;
    if (e.repeatChance > 0 && this.game.rng.float() < e.repeatChance) more++;
    w.repeatsLeft += more;
    this.game.playSfx('slash', k.x, k.y);
    return true;
  }

  /** The dashing blade cuts every enemy it touches that it has not cut on this dash. */
  private seekerCuts(w: WeaponInstance, e: Effective, dirX: number, dirY: number): void {
    const k = w.seek!;
    this.query.length = 0;
    this.game.enemies.grid.query(k.x, k.y, e.size + 16, this.query);
    for (const en of this.query) {
      if (!en.active || k.hit.has(en)) continue;
      const rr = e.size + en.radius;
      if ((en.x - k.x) ** 2 + (en.y - k.y) ** 2 > rr * rr) continue;
      k.hit.add(en);
      this.directHit(w, e, en, e.damage, e.damageScale, dirX, dirY, e.knockback, true);
    }
  }

  /** Host: the seeker blades to draw on joiners' screens. */
  summonViews(out: SummonView[]): void {
    for (const w of this.list) {
      const k = w.seek;
      const anim = w.def.projectileAnim;
      if (!k || !anim || !w.orbiters[0]?.visible) continue;
      out.push({ id: k.netId, anim, x: k.x, y: k.y, angle: k.angle, flip: false, giant: false });
    }
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
    const near = this.inRange(p.x, p.y, e.range);
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

  // ---------------------------------------------------------------- shields (Aegis)

  /**
   * Shield bubble: bright while the owner has Aegis (an extra ring per extra stack), a filling ring while it comes
   * back. The recharge only runs while there is no Aegis; on the host, Aegis is put on the owner once it is done.
   */
  private updateShield(w: WeaponInstance, e: Effective, dt: number, firing: boolean): void {
    const p = this.owner;
    if (p.aegis <= 0 && w.timer > 0) w.timer = Math.max(0, w.timer - dt);
    if (firing && p.aegis <= 0 && w.timer <= 0) this.applyAegis(w, e);
    w.pulse = Math.max(0, w.pulse - dt * 2.5);
    w.phase = (w.phase + dt * 1.5) % 1;
    const g = w.gfx!;
    const color = w.def.color ?? 0x5ab0ff;
    const R = e.size;
    g.clear();
    if (p.aegis > 0) {
      const shimmer = 0.5 + 0.5 * Math.sin(w.phase * Math.PI * 2);
      g.fillStyle(color, 0.08 + 0.05 * shimmer);
      g.fillCircle(p.x, p.y, R);
      g.lineStyle(1, color, 0.55 + 0.3 * shimmer);
      g.strokeCircle(p.x, p.y, R);
      for (let i = 1; i < Math.min(p.aegis, 4); i++) {
        g.lineStyle(1, 0xffffff, 0.35 + 0.2 * shimmer);
        g.strokeCircle(p.x, p.y, R + 2 * i);
      }
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

  /** Host: Aegis goes on the owner. It is an applied effect, so Reiterate may add a copy. */
  private applyAegis(w: WeaponInstance, e: Effective): void {
    const p = this.owner;
    p.aegis = 1;
    if (e.reiterate > 0 && this.game.rng.float() < e.reiterate) p.aegis++;
    w.pulse = 1;
    this.game.fx.ring(p.x, p.y, w.def.color ?? 0x5ab0ff, e.size + 6, 250);
  }

  /** Host: an Aegis stack eats the hit. Once the last one is gone the shield starts bringing it back. */
  tryBlock(): boolean {
    const p = this.owner;
    const w = this.list.find((x) => x.def.targeting === 'shield');
    if (!w || p.aegis <= 0) return false;
    p.aegis--;
    const e = this.eff(w);
    if (p.aegis <= 0) {
      w.timer = e.cooldown;
      w.refundable = this.refundShare() * e.cooldown;
    }
    w.pulse = 1;
    this.game.fx.ring(p.x, p.y, w.def.color ?? 0x5ab0ff, e.size + 12, 320);
    this.game.playSfx('block', p.x, p.y);
    return true;
  }

  /**
   * Host: `source` just hit the owner for `raw` (before armor, shields or blocks). Shields with `reflect` deal that
   * share back to it as one of their melee hits (an attack for Ruthless).
   */
  reflect(source: Enemy, raw: number): void {
    if (this.reflecting) return;
    this.reflecting = true;
    const p = this.owner;
    for (const w of this.list) {
      const share = w.stats.reflect ?? 0;
      if (share <= 0 || !source.active) continue;
      let e = this.eff(w);
      w.serial++;
      if (e.ruthless > 0 && w.serial % RUTHLESS_EVERY === 0) e = this.ruthlessOf(e);
      const dx = source.x - p.x;
      const dy = source.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      this.game.fx.beam(p.x, p.y, source.x, source.y, 1, 0.15, w.def.color ?? 0x5ab0ff);
      this.directHit(w, e, source, raw * share * e.damageScale, e.damageScale, dx / d, dy / d, e.knockback, false);
    }
    this.reflecting = false;
  }

  /** Fraction of every hit the owner's shields absorb. */
  reduction(): number {
    let r = 0;
    for (const w of this.list) if (w.def.targeting === 'shield') r += w.stats.reduction ?? 0;
    return Math.min(MAX_SHIELD_REDUCTION, r);
  }

  // ---------------------------------------------------------------- passives (critical strikes, Unstable Infusion)

  /** Critical strike chance the owner's passive weapons add. */
  critChance(): number {
    let c = 0;
    for (const w of this.list) c += w.stats.crit ?? 0;
    return c;
  }

  /** The owner's Unstable Infusion (the weapon with `charges`), or null. */
  infusion(): WeaponInstance | null {
    for (const w of this.list) if (w.def.charges) return w;
    return null;
  }

  /** Share of a cooldown crit refunds may take off: 1 minus the passive weapons' highest `refundFloor`. */
  refundShare(): number {
    let floor = 0;
    for (const w of this.list) floor = Math.max(floor, w.stats.refundFloor ?? 0);
    return Math.max(0, 1 - floor);
  }

  /**
   * One of the owner's hits was a critical strike: passive weapons with `critCooldown` take that many seconds off
   * every cooldown the owner has, the ultimate included. A cooldown never goes below ready, and refunds stop once
   * they have taken `refundShare()` of it since the ability was last used.
   */
  onCrit(): void {
    let s = 0;
    for (const w of this.list) s += w.stats.critCooldown ?? 0;
    if (s <= 0) return;
    for (const w of this.list) {
      if (w.def.targeting === 'passive' || w.def.targeting === 'infusion') continue;
      const r = Math.max(0, Math.min(s, w.refundable, w.timer));
      w.timer -= r;
      w.refundable -= r;
    }
    const u = this.owner.ultimate;
    if (u) {
      const r = Math.max(0, Math.min(s, u.refundable, u.cooldownLeft));
      u.cooldownLeft -= r;
      u.refundable -= r;
    }
  }

  /** Melee arc toward `base` (Tail Whip, breaths, Blade Flurry's full circle). Extra projectiles add sweeps around the owner. */
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
      this.game.playSfx(w.def.targeting === 'spin' ? 'slash' : 'whip', p.x, p.y);
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
      if (w.def.targeting === 'flicker') {
        this.drawFlicker(g, s, k, color);
        continue;
      }
      const sweepK = Math.min(1, k * 1.8);
      const alpha = k < 0.55 ? 0.85 : 0.85 * (1 - (k - 0.55) / 0.45);
      const a0 = s.angle - s.arc / 2;
      const a1 = a0 + s.arc * sweepK;
      const outer = s.reach;
      const inner = s.reach * 0.5;
      const steps = s.arc > Math.PI ? 28 : 14;
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

  /** Flicker Strike: two crossing cuts over the enemy, `reach` px behind the owner, that open up and fade. */
  private drawFlicker(g: Phaser.GameObjects.Graphics, s: Slash, k: number, color: number): void {
    const p = this.owner;
    const cx = p.x - Math.cos(s.angle) * s.reach;
    const cy = p.y - Math.sin(s.angle) * s.reach;
    const open = Math.min(1, k * 4);
    const alpha = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6;
    const len = s.arc * open;
    for (const turn of [0.8, -0.8]) {
      const a = s.angle + turn;
      const dx = Math.cos(a) * len;
      const dy = Math.sin(a) * len;
      g.lineStyle(4, color, alpha * 0.5);
      g.lineBetween(cx - dx, cy - dy, cx + dx, cy + dy);
      g.lineStyle(1, 0xffffff, alpha);
      g.lineBetween(cx - dx, cy - dy, cx + dx, cy + dy);
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
        w.serial++;
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
        w.refundable = this.refundShare() * e.cooldown;
        w.pulse = 1;
        w.serial++;
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
   * A sword wave first cuts through everything until it touches the enemy it was aimed at.
   */
  onProjectileHit(pr: Projectile, en: Enemy): void {
    // Bombs touch nothing on the way; they explode on reaching their target (see updateProjectiles).
    if (pr.bomb || !pr.active || !en.active || pr.hit.has(en)) return;
    pr.hit.add(en);
    const body = pr.body as Phaser.Physics.Arcade.Body;
    const v = Math.hypot(body.velocity.x, body.velocity.y);
    const dx = v > 1 ? body.velocity.x / v : pr.dirX;
    const dy = v > 1 ? body.velocity.y / v : pr.dirY;
    const w = pr.weapon;
    // Blast-on-hit projectiles deal nothing themselves: every enemy they touch sets off the weapon's blast.
    if (w.def.blastOnHit) this.blast(w, en.x, en.y);
    else this.directHit(w, this.eff(w), en, pr.damage, pr.damageScale, dx, dy, pr.knockback, false, pr.serial);
    if (pr.passThrough) {
      if (!pr.isTarget(en)) return;
      pr.passThrough = false;
    }
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

  /**
   * Splits: identical projectiles fan out from the hit, skipping enemies the parent already hit, each dealing
   * `splitLess` less than the parent. They never split again, except that the parent's first split may give each
   * one a `splitAgain` chance to split once more.
   */
  private split(pr: Projectile, angle: number): void {
    const w = pr.weapon;
    const e = this.shot(w, this.eff(w));
    const n = pr.splitCount;
    const step = (SPLIT_ARC * DEG) / (n - 1);
    const keep = 1 - e.splitLess;
    const rng = this.game.rng;
    for (let i = 0; i < n; i++) {
      const child = this.projectiles.get(pr.x, pr.y) as Projectile | null;
      if (!child) break;
      child.fire(w, pr.x, pr.y, angle + (i - (n - 1) / 2) * step, e);
      child.damage = pr.damage * keep;
      child.damageScale = pr.damageScale * keep;
      child.serial = pr.serial;
      child.generation = pr.generation + 1;
      child.splitCount = pr.splitCount;
      const again = pr.generation === 0 && e.splitAgain > 0 && rng.float() < e.splitAgain;
      child.splitsLeft = pr.splitsLeft - 1 + (again ? 1 : 0);
      for (const h of pr.hit) child.hit.add(h);
    }
  }

  /**
   * Chain: bounce to the closest enemy this projectile has not hit, or a random direction when none is near. It flies
   * faster from then on and deals `chainLess` less with every bounce.
   */
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
    const e = this.eff(pr.weapon);
    const keep = 1 - e.chainLess;
    pr.damage *= keep;
    pr.damageScale *= keep;
    pr.speed = e.speed * CHAIN_SPEED * (1 + e.chainSpeed);
    pr.bounce(angle, CHAIN_RANGE / Math.max(1, pr.speed) + 0.1);
  }

  /** A hit from an area weapon (sweeps, auras, stabs, breaths, strikes, blasts, beams, orbiting objects). */
  private areaHit(w: WeaponInstance, e: Effective, en: Enemy, dirX: number, dirY: number): void {
    this.directHit(w, e, en, e.damage, e.damageScale, dirX, dirY, e.knockback, true);
  }

  /**
   * One of the weapon's own hits on `en` (not a splash, echo or effect tick). Momentum first adds its share of the
   * owner's current speed, scaled like the weapon's base damage (`scale`). When the hit lands it applies the weapon's
   * duration effect, queues Echo Strike echoes (`area` hits of AoE weapons only), and for melee weapons may stun and
   * splashes (Impact). A hit a rare enemy ignores (blocked, shielded) does none of that. Returns whether it landed.
   */
  private directHit(
    w: WeaponInstance,
    e: Effective,
    en: Enemy,
    amount: number,
    scale: number,
    dirX: number,
    dirY: number,
    knockback: number,
    area: boolean,
    serial = w.serial,
  ): boolean {
    const p = this.owner;
    if (e.momentum > 0) amount += e.momentum * p.speedNow * scale;
    const x = en.x;
    const y = en.y;
    const enemies = this.game.enemies;
    if (!enemies.hit(en, amount, dirX, dirY, knockback, w)) return false;
    const dealt = enemies.lastDealt;
    const killed = enemies.lastKilled;
    this.applyEffect(w, e, en);
    if (area) this.queueEchoes(w, en, x, y, amount * e.echo, e.echoRadius, e.echoRepeats, serial);
    if (e.stunChance > 0 && this.game.rng.float() < e.stunChance) {
      // The stun lasts longer the larger the share of the enemy's max HP the hit took.
      enemies.stun(en, STUN_SECONDS * (1 + dealt / Math.max(1, en.maxHp)), e.stunBonus, this.game.time.now);
    }
    if (e.impact > 0) this.splash(w, e, en, x, y, amount * e.impact);
    this.afterHit(w, serial, killed);
    return true;
  }

  /** Echo Strike: `repeats` echoes of `amount` around (x, y), ECHO_GAP seconds apart. */
  private queueEchoes(w: WeaponInstance, en: Enemy, x: number, y: number, amount: number, radius: number, repeats: number, serial: number): void {
    if (amount <= 0) return;
    for (let i = 0; i < repeats; i++) {
      this.echoes.push({ weapon: w, x, y, radius, amount, at: this.game.runTime + i * ECHO_GAP, source: en, sourceId: en.netId, serial });
    }
  }

  /** Impact: every other enemy within the splash radius of (x, y) takes `amount`, summed per frame (see processSplashes). */
  private splash(w: WeaponInstance, e: Effective, hit: Enemy, x: number, y: number, amount: number): void {
    if (amount <= 0) return;
    let sums = this.splashSums.get(w);
    if (!sums) {
      sums = new Map();
      this.splashSums.set(w, sums);
    }
    const q = this.splashQuery;
    q.length = 0;
    this.game.enemies.grid.query(x, y, e.splashRadius + 16, q);
    for (const en of q) {
      if (en === hit || !en.active) continue;
      const rr = e.splashRadius + en.radius;
      if ((en.x - x) ** 2 + (en.y - y) ** 2 > rr * rr) continue;
      sums.set(en, (sums.get(en) ?? 0) + amount);
    }
    if (this.splashRings++ < MAX_SPLASH_RINGS) this.game.fx.ring(x, y, w.def.color ?? 0xffffff, e.splashRadius, 200);
  }

  /** Splash damage queued this frame lands: one hit per weapon and enemy. Splashes can echo but never splash again. */
  private processSplashes(): void {
    this.splashRings = 0;
    if (this.splashSums.size === 0) return;
    for (const [w, sums] of this.splashSums) {
      if (sums.size === 0) continue;
      const e = this.eff(w);
      for (const [en, amount] of sums) {
        const x = en.x;
        const y = en.y;
        if (!this.game.enemies.hit(en, amount, 0, 0, 0, w)) continue;
        const killed = this.game.enemies.lastKilled;
        this.queueEchoes(w, en, x, y, amount * e.splashEcho, e.splashEchoRadius, e.splashEchoRepeats, w.serial);
        this.afterHit(w, w.serial, killed);
      }
      sums.clear();
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
    const serials = new Map<WeaponInstance, number>();
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
      serials.set(ec.weapon, ec.serial);
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
      const serial = serials.get(w) ?? w.serial;
      for (const [en, amount] of sums) if (this.game.enemies.hit(en, amount, 0, 0, 0, w)) this.afterHit(w, serial, this.game.enemies.lastKilled);
      sums.clear();
    }
  }

  /**
   * Something of `w` landed on an enemy (a hit, splash or echo of attack `serial`; not an effect tick), and `killed`
   * it or not. Flicker Strike may give a Shadow Charge for every enemy reached, and has another chance for every
   * enemy killed; Unstable Infusion rolls once per attack, on its first hit.
   */
  private afterHit(w: WeaponInstance, serial: number, killed: boolean): void {
    const p = this.owner;
    const rng = this.game.rng;
    const shadow = w.def.shadow;
    if (shadow) {
      const chance = w.stats.chargeChance ?? 0;
      if (p.shadow < shadow.max && chance > 0 && rng.float() < chance) p.shadow++;
      if (killed && p.shadow < shadow.max && rng.float() < shadow.onKill) p.shadow++;
    }
    const inf = this.infusion();
    if (!inf || w.infused === serial) return;
    w.infused = serial;
    const charges = inf.def.charges!;
    if (rng.float() < (inf.stats.chargeChance ?? 0)) p.gainCharge(rng.pick(CHARGE_KINDS), charges);
  }

  /**
   * Duration weapons: a hit applies the weapon's effect (refreshing the stack it applied before) and may reiterate.
   * Hexproof enemies take none.
   */
  private applyEffect(w: WeaponInstance, e: Effective, en: Enemy): void {
    const def = w.def.effect;
    if (!def || e.effectDuration <= 0 || !en.active || !this.game.enemyMods.debuffable(en)) return;
    let stack = def.stacks ? undefined : en.effects.find((st) => st.weapon === w && !st.copy);
    if (stack) stack.left = e.effectDuration;
    else {
      let count = 0;
      for (const st of en.effects) if (st.weapon === w) count++;
      if (count >= MAX_EFFECT_STACKS) return;
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
    if (w.def.targeting === 'facing' || w.def.targeting === 'spin') this.owner.spin();
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
    this.splashSums.clear();
    this.fields.length = 0;
    this.beams.length = 0;
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
      w.strikeQueue.length = 0;
      w.strikeBusy = 0;
      // A blade comes back out next to its owner.
      w.seek = null;
    }
    this.echoes.length = 0;
    this.splashSums.clear();
    this.fields.length = 0;
    this.beams.length = 0;
  }
}
