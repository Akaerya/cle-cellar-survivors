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
  shadow: Phaser.GameObjects.Bob | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, ATLAS, 'bat_0');
  }

  spawn(def: EnemyDef, x: number, y: number, hpScale: number): this {
    this.def = def;
    this.netId = nextNetId();
    this.enableBody(true, x, y, true, true);
    this.setTexture(ATLAS, def.firstFrame);
    this.play({ key: def.anim, startFrame: Math.floor(Math.random() * 4) }, true);
    this.hp = this.maxHp = Math.round(def.hp * hpScale);
    this.radius = def.radius;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(def.radius, this.width / 2 - def.radius, this.height / 2 - def.radius);
    this.kbx = this.kby = 0;
    this.sepX = this.sepY = 0;
    this.flashUntil = 0;
    this.lastHit.clear();
    this.effects.length = 0;
    this.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    this.setAlpha(1).setFlipX(false);
    this.setDepth(DEPTH.units + y / ARENA_SIZE);
    return this;
  }

  flash(now: number): void {
    this.flashUntil = now + 100;
    this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
  }
}
