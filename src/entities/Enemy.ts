import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { ARENA_SIZE, DEPTH } from '../constants';
import type { EnemyDef, EnemyModifierDef } from '../data/types';
import { nextNetId } from '../net/ids';
import type { WeaponInstance } from '../systems/Weapons';

let nextUid = 1;
const NO_MODS: readonly EnemyModifierDef[] = [];

/** One stack of a duration weapon's effect on an enemy. */
export interface EffectStack {
  weapon: WeaponInstance;
  /** Seconds left. */
  left: number;
  /** Seconds until the next tick. */
  next: number;
  /** Made by Reiterate: never refreshed by later hits, just runs out. */
  copy: boolean;
}

/** Seconds of slack so a tick due at the very end of a stack's time still counts. */
export const TICK_EPSILON = 1e-6;

/** Ticks `st` still has to deal, `interval` seconds apart (the next one is `st.next` away). */
export function remainingTicks(st: EffectStack, interval: number): number {
  if (st.next > st.left + TICK_EPSILON || interval <= 0) return 0;
  return Math.floor((st.left - st.next) / interval + TICK_EPSILON) + 1;
}

/** A random frame of animation `key` to start on, so a crowd does not move in lockstep. */
export function randomStartFrame(scene: Phaser.Scene, key: string): number {
  return Math.floor(Math.random() * (scene.anims.get(key)?.frames.length ?? 1));
}

/** `e` if it is still the same living enemy as spawn `id` (pooled enemies are reused), else null. */
export function stillAlive(e: Enemy | null, id: number): Enemy | null {
  return e && e.active && e.netId === id ? e : null;
}

/** Shadow sprite widths in px, by frame name. */
export const SHADOW_W: Record<string, number> = { shadow_s: 12, shadow_l: 24, shadow_xl: 48 };

/** Pooled enemy. `spawn` re-initialises a dead member for a new type. */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  readonly uid = nextUid++;
  /** Identifies this spawn to network clients (pooled objects are reused). */
  netId = 0;
  def!: EnemyDef;
  hp = 0;
  maxHp = 0;
  radius = 6;
  /** Knockback velocity, decays every frame. */
  kbx = 0;
  kby = 0;
  /** Push-apart velocity accumulated by the separation pass this frame. */
  sepX = 0;
  sepY = 0;
  flashUntil = 0;
  /** Weapon uid -> scene time of the last hit, for orbit and aura weapons. */
  readonly lastHit = new Map<number, number>();
  /** Duration effects ticking on this enemy (host only). */
  readonly effects: EffectStack[] = [];
  /** Slowed (e.g. standing on a freezing field) until this scene time, by this fraction of its speed. */
  slowUntil = 0;
  slowAmount = 0;
  /**
   * Tint shown right now: 0 none, 1 hit flash, 2 chilled (slowed, or carrying an effect tinted CHILL_TINT), 3 stunned,
   * 4 carrying an effect of another tint (Shock).
   */
  tintState = 0;
  /** Stands still until this scene time (a boss winding up an attack). */
  rootedUntil = 0;
  /** Stunned (Stun modification) until this scene time: stands still and takes `stunBonus` more damage. */
  stunUntil = 0;
  stunBonus = 0;
  /** Bosses and shooters: seconds until each skill (or the next shot) is ready, by skill index. */
  readonly skillTimers: number[] = [];
  shadow: Phaser.GameObjects.Bob | null = null;

  // Rare enemies (systems/EnemyModifiers.ts). The aura and revive fields apply to normal enemies too.
  /** Modifiers of a rare enemy; empty for a normal one. */
  mods: readonly EnemyModifierDef[] = NO_MODS;
  /** Bit i set: has ENEMY_MODIFIERS[i] (see modifierBit). Sent to joiners. */
  modMask = 0;
  /** Seconds until each timed modifier (void fields, teleports) acts again, by index in `mods`. */
  readonly modTimers: number[] = [];
  /** HP before rare bonuses: the type's HP scaled by time and players. */
  baseHp = 0;
  /** Fraction of `baseHp` its modifiers add to max HP (Empower Allies comes on top while it lasts). */
  hpBonus = 0;
  /** Multiplies move speed (Enrage, Empower Allies). */
  speedMult = 1;
  /** Enrage: 0..1, how far it has enraged from missing HP. */
  enrage = 0;
  /** Soul Absorption: souls gathered. */
  souls = 0;
  /** Inside an Invulnerability aura this frame (Intervention): cannot drop below 1 HP. */
  intervention = false;
  /** The Empower Allies aura it stands in, if any. */
  empower: Extract<EnemyModifierDef, { id: 'empower_allies' }> | null = null;
  /** Already came back once through Spirit Walker: it will not again (drawn see-through). */
  spirit = false;
  /** Temporal Shield: hits its bubble has taken since it last came back, and the scene time it is broken until. */
  shieldHits = 0;
  shieldDownUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, ATLAS, 'bat_0');
  }

  spawn(def: EnemyDef, x: number, y: number, hpScale: number): this {
    this.def = def;
    this.netId = nextNetId();
    this.enableBody(true, x, y, true, true);
    this.setTexture(ATLAS, def.firstFrame);
    this.play({ key: def.anim, startFrame: randomStartFrame(this.scene, def.anim) }, true);
    this.baseHp = def.hp * hpScale;
    this.hp = this.maxHp = Math.round(this.baseHp);
    this.radius = def.radius;
    // Arcade scales the circle with the sprite, so it is set in unscaled frame px.
    const scale = def.scale ?? 1;
    this.setScale(scale);
    const r = def.radius / scale;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(r, this.width / 2 - r, this.height / 2 - r);
    this.kbx = this.kby = 0;
    this.sepX = this.sepY = 0;
    this.flashUntil = 0;
    this.lastHit.clear();
    this.effects.length = 0;
    this.slowUntil = 0;
    this.slowAmount = 0;
    this.tintState = 0;
    this.rootedUntil = 0;
    this.stunUntil = 0;
    this.stunBonus = 0;
    this.skillTimers.length = 0;
    this.mods = NO_MODS;
    this.modMask = 0;
    this.modTimers.length = 0;
    this.hpBonus = 0;
    this.speedMult = 1;
    this.enrage = 0;
    this.souls = 0;
    this.intervention = false;
    this.empower = null;
    this.spirit = false;
    this.shieldHits = 0;
    this.shieldDownUntil = 0;
    this.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    this.setAlpha(1).setFlipX(false);
    this.setDepth(DEPTH.units + y / ARENA_SIZE);
    return this;
  }

  flash(now: number): void {
    this.flashUntil = now + 100;
    this.tintState = 1;
    this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
  }

  stunned(now: number): boolean {
    return now < this.stunUntil;
  }

  /** The colour of a tinted effect on this enemy, or of a slow, or null. */
  chillTint(now: number, slowTint: number): number | null {
    for (const st of this.effects) {
      const t = st.weapon.def.effect?.tint;
      if (t !== undefined) return t;
    }
    return now < this.slowUntil ? slowTint : null;
  }
}
