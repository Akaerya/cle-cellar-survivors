import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH, INVULN_SECONDS, ARENA_SIZE } from '../constants';
import { BASE_STATS, PLAYER_RADIUS } from '../data/player';
import type { PlayerStats } from '../data/types';

/** The monkey. The player only steers it; everything else is automatic. */
export class Player extends Phaser.Physics.Arcade.Sprite {
  stats: PlayerStats = { ...BASE_STATS };
  hp = BASE_STATS.maxHp;
  /** Last non-zero movement direction, normalised. Some weapons aim with it. */
  readonly facing = new Phaser.Math.Vector2(1, 0);
  moving = false;
  invuln = 0;
  hurtAnim = 0;
  god = false;
  dead = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, ATLAS, 'monkey_idle_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    // Circle centred on the sprite: frame is 16x20, origin 0.5.
    body.setCircle(PLAYER_RADIUS, 8 - PLAYER_RADIUS, 10 - PLAYER_RADIUS);
    this.setCollideWorldBounds(true);
    this.play('monkey-idle');
  }

  get bodyRadius(): number {
    return PLAYER_RADIUS;
  }

  /** Applies new stats; extra max HP from items is added to current HP too. */
  setStats(stats: PlayerStats): void {
    const gained = stats.maxHp - this.stats.maxHp;
    this.stats = stats;
    if (gained > 0) this.hp += gained;
    this.hp = Math.min(this.hp, stats.maxHp);
  }

  private spinTime = 0;
  private lookLeft = false;

  /** Brief turn-around flip when the tail lashes. */
  spin(): void {
    this.spinTime = 0.12;
  }

  heal(amount: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
  }

  /** ix, iy: raw input in -1..1. Diagonals are normalised so they are not faster. */
  steer(ix: number, iy: number, dt: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (this.dead) {
      body.setVelocity(0, 0);
      return;
    }
    const len = Math.hypot(ix, iy);
    this.moving = len > 0;
    if (this.moving) {
      const nx = ix / len;
      const ny = iy / len;
      body.setVelocity(nx * this.stats.moveSpeed, ny * this.stats.moveSpeed);
      this.facing.set(nx, ny);
    } else {
      body.setVelocity(0, 0);
    }
    if (this.facing.x !== 0) this.lookLeft = this.facing.x < 0;
    if (this.spinTime > 0) this.spinTime -= dt;
    this.setFlipX(this.spinTime > 0 ? !this.lookLeft : this.lookLeft);

    if (this.stats.regen > 0 && this.hp < this.stats.maxHp) this.heal(this.stats.regen * dt);

    // Invulnerability flash: white on impact, then blinking.
    if (this.invuln > 0) {
      this.invuln -= dt;
      const t = INVULN_SECONDS - this.invuln;
      if (t < 0.08) {
        this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      } else {
        this.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
        this.setAlpha(Math.floor(t * 16) % 2 === 0 ? 0.35 : 1);
      }
      if (this.invuln <= 0) this.setAlpha(1);
    }

    if (this.hurtAnim > 0) {
      this.hurtAnim -= dt;
    } else {
      const key = this.moving ? 'monkey-walk' : 'monkey-idle';
      if (this.anims.currentAnim?.key !== key) this.play(key, true);
    }

    this.setDepth(DEPTH.units + this.y / ARENA_SIZE);
  }

  /** Returns the damage actually taken (0 while invulnerable). */
  takeHit(raw: number): number {
    if (this.invuln > 0 || this.dead) return 0;
    const dmg = Math.max(1, raw - this.stats.armor);
    this.invuln = INVULN_SECONDS;
    this.hurtAnim = 0.2;
    this.play('monkey-hurt', true);
    if (!this.god) this.hp = Math.max(0, this.hp - dmg);
    return dmg;
  }
}
