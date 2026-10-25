import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { ARENA_SIZE, DEPTH } from '../constants';
import type { EnemyDef } from '../data/types';
import { nextNetId } from '../net/ids';
import type { WeaponInstance } from '../systems/Weapons';

let nextUid = 1;

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

/** A random frame of animation `key` to start on, so a crowd does not move in lockstep. */
export function randomStartFrame(scene: Phaser.Scene, key: string): number {
  return Math.floor(Math.random() * (scene.anims.get(key)?.frames.length ?? 1));
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
  /** Tint shown right now: 0 none, 1 hit flash, 2 chilled (slowed or carrying a tinted effect). */
  tintState = 0;
  /** Stands still until this scene time (a boss winding up an attack). */
  rootedUntil = 0;
  /** Bosses and shooters: seconds until each skill (or the next shot) is ready, by skill index. */
  readonly skillTimers: number[] = [];
  shadow: Phaser.GameObjects.Bob | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, ATLAS, 'bat_0');
  }

  spawn(def: EnemyDef, x: number, y: number, hpScale: number): this {
    this.def = def;
    this.netId = nextNetId();
    this.enableBody(true, x, y, true, true);
    this.setTexture(ATLAS, def.firstFrame);
    this.play({ key: def.anim, startFrame: randomStartFrame(this.scene, def.anim) }, true);
    this.hp = this.maxHp = Math.round(def.hp * hpScale);
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
    this.skillTimers.length = 0;
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

  /** The colour of a tinted effect on this enemy, or of a slow, or null. */
  chillTint(now: number, slowTint: number): number | null {
    for (const st of this.effects) {
      const t = st.weapon.def.effect?.tint;
      if (t !== undefined) return t;
    }
    return now < this.slowUntil ? slowTint : null;
  }
}
