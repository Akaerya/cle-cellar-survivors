import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH } from '../constants';
import { nextNetId } from '../net/ids';
import type { Enemy } from './Enemy';
import type { WeaponInstance } from '../systems/Weapons';

/** Boomerang bananas slow to a stop over this many seconds, then fly back. */
const BOOMERANG_OUT = 0.9;
const BOOMERANG_RETURN_ACCEL = 0.45; // seconds to reach full return speed
/** Bombs whose target died explode once they are this close (px) to where it was last seen. */
const BOMB_LOST_REACH = 4;

/** What one shot needs to know. Split, split depth and chain come from modifications (0 without them). */
export interface ShotStats {
  damage: number;
  speed: number;
  pierce: number;
  lifetime: number;
  size: number;
  knockback: number;
  boomerang: boolean;
  split?: number;
  splitDepth?: number;
  chain?: number;
}

/** Pooled straight-flying projectile (bananas, and any `nearest`/`random`/`facing` weapon with speed). */
export class Projectile extends Phaser.Physics.Arcade.Sprite {
  weapon!: WeaponInstance;
  damage = 0;
  knockback = 0;
  pierceMax = 1;
  pierceLeft = 1;
  life = 0;
  age = 0;
  speed = 0;
  dirX = 1;
  dirY = 0;
  boomerang = false;
  returning = false;
  returnAge = 0;
  /** Projectiles this one splits into on its next hit (Splits modification); below 2 it never splits. */
  splitCount = 0;
  /** Splits left in this line: the first hit splits while this is above 0, and each child gets one less. */
  splitsLeft = 0;
  /** Bounces left once pierce is used up (Chain modification). */
  bouncesLeft = 0;
  /**
   * Bomb weapons: the projectile homes in on `target` and touches nothing else on the way. It explodes on reaching
   * the target, or the spot where the target was last seen if it died (its spawn id changes when the pool reuses it).
   */
  bomb = false;
  target: Enemy | null = null;
  targetId = 0;
  targetX = 0;
  targetY = 0;
  /** Bomb: reached its target this frame and should explode. */
  arrived = false;
  /** Where the projectile was last frame (dome edges are found by the step from inside to outside). */
  prevX = 0;
  prevY = 0;
  /** Enemies hit on the current pass. Cleared when a boomerang turns around. */
  readonly hit = new Set<Enemy>();
  /** Identifies this shot to network clients (pooled objects are reused). */
  netId = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, ATLAS, 'banana_0');
  }

  fire(
    weapon: WeaponInstance,
    x: number,
    y: number,
    angle: number,
    o: ShotStats,
  ): void {
    this.weapon = weapon;
    this.netId = nextNetId();
    this.enableBody(true, x, y, true, true);
    const def = weapon.def;
    if (def.projectileAnim) this.play(def.projectileAnim, true);
    const artR = def.artRadius ?? 5;
    const scale = o.size / artR;
    this.setScale(scale);
    const body = this.body as Phaser.Physics.Arcade.Body;
    // Unscaled circle centred on the frame; Arcade scales it with the sprite.
    body.setCircle(artR, this.width / 2 - artR, this.height / 2 - artR);
    this.damage = o.damage;
    this.knockback = o.knockback;
    this.pierceMax = this.pierceLeft = o.pierce;
    this.speed = o.speed;
    this.dirX = Math.cos(angle);
    this.dirY = Math.sin(angle);
    this.boomerang = o.boomerang;
    this.returning = false;
    this.returnAge = 0;
    this.life = o.boomerang ? BOOMERANG_OUT + 3 : o.lifetime;
    this.age = 0;
    this.splitCount = Math.round(o.split ?? 0);
    this.splitsLeft = this.splitCount >= 2 ? Math.max(1, Math.round(o.splitDepth ?? 1)) : 0;
    this.bouncesLeft = Math.round(o.chain ?? 0);
    this.bomb = false;
    this.target = null;
    this.arrived = false;
    this.prevX = x;
    this.prevY = y;
    this.setRotation(def.orient ? angle : 0);
    this.hit.clear();
    this.setDepth(DEPTH.projectiles);
    body.setVelocity(this.dirX * this.speed, this.dirY * this.speed);
  }

  /** Bomb: home in on `target` from now on (call right after `fire`). */
  aim(target: Enemy): void {
    this.bomb = true;
    this.target = target;
    this.targetId = target.netId;
    this.targetX = target.x;
    this.targetY = target.y;
    this.arrived = false;
  }

  /** Dome edge: put back at (x, y) and fly off toward `angle`. Nothing else changes (no pierce or bounces used). */
  ricochet(x: number, y: number, angle: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.reset(x, y);
    this.dirX = Math.cos(angle);
    this.dirY = Math.sin(angle);
    body.setVelocity(this.dirX * this.speed, this.dirY * this.speed);
    if (this.weapon.def.orient) this.setRotation(angle);
  }

  /** Chain: flies off toward `angle`, with at least `minLife` seconds left to get there. */
  bounce(angle: number, minLife: number): void {
    this.dirX = Math.cos(angle);
    this.dirY = Math.sin(angle);
    this.life = Math.max(this.life - this.age, minLife);
    this.age = 0;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(this.dirX * this.speed, this.dirY * this.speed);
    if (this.weapon.def.orient) this.setRotation(angle);
  }

  /** Called when the outbound pass is used up or the turn point is reached. */
  turnAround(): void {
    this.returning = true;
    this.returnAge = 0;
    this.pierceLeft = this.pierceMax;
    this.hit.clear();
  }

  /** Returns false when the projectile should be released back to the pool. */
  step(dt: number, px: number, py: number): boolean {
    this.age += dt;
    if (this.age >= this.life) return false;
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (this.bomb) {
      const t = this.target;
      let reach = BOMB_LOST_REACH;
      if (t && t.active && t.netId === this.targetId) {
        this.targetX = t.x;
        this.targetY = t.y;
        reach = t.radius + body.halfWidth;
      }
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const d = Math.hypot(dx, dy);
      if (d <= reach) {
        this.arrived = true;
        return true;
      }
      this.dirX = dx / d;
      this.dirY = dy / d;
      body.setVelocity(this.dirX * this.speed, this.dirY * this.speed);
      return true;
    }
    if (!this.boomerang) return true;

    if (!this.returning) {
      const k = Math.max(0, 1 - this.age / BOOMERANG_OUT);
      body.setVelocity(this.dirX * this.speed * k, this.dirY * this.speed * k);
      if (this.age >= BOOMERANG_OUT) this.turnAround();
    } else {
      this.returnAge += dt;
      const dx = px - this.x;
      const dy = py - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 10) return false; // caught
      const sp = this.speed * 1.15 * Math.min(1, this.returnAge / BOOMERANG_RETURN_ACCEL);
      body.setVelocity((dx / d) * sp, (dy / d) * sp);
    }
    return true;
  }
}
