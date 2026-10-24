import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, DEPTH, INVULN_SECONDS, ARENA_SIZE, PLAYER_COLORS, PLAYER_TINTS } from '../constants';
import type { OwnedItem } from '../core/progression';
import { BASE_STATS, PLAYER_RADIUS } from '../data/player';
import type { PlayerStats } from '../data/types';
import { text } from '../ui/widgets';
import type { Weapons } from '../systems/Weapons';

/** The monkey. The player only steers it; everything else is automatic. */
export class Player extends Phaser.Physics.Arcade.Sprite {
  /** 0 for solo and the host, 1..3 for joiners. */
  readonly slot: number;
  stats: PlayerStats = { ...BASE_STATS };
  hp = BASE_STATS.maxHp;
  /** Last non-zero movement direction, normalised. Some weapons aim with it. */
  readonly facing = new Phaser.Math.Vector2(1, 0);
  moving = false;
  invuln = 0;
  /** Length of the current invulnerability, for the flash timing. */
  private invulnTotal = INVULN_SECONDS;
  hurtAnim = 0;
  god = false;
  dead = false;
  /** Co-op: the player disconnected. Their monkey is hidden and ignored. */
  gone = false;
  weapons!: Weapons;
  items: OwnedItem[] = [];
  /** Level-up picks this player still has to make (fallen monkeys keep collecting them). */
  pendingLevelUps = 0;
  /** Co-op, while fallen: revive progress 0..1, and the HP fraction a revive restores. */
  revive = 0;
  reviveHp = 0;
  /** Co-op: where the network says this monkey is (remote players are eased toward it). */
  netX = 0;
  netY = 0;
  private tag: Phaser.GameObjects.BitmapText | null = null;
  private reviveTag: Phaser.GameObjects.BitmapText | null = null;
  private readonly baseTint: number;

  constructor(scene: Phaser.Scene, x: number, y: number, slot = 0, coop = false) {
    super(scene, x, y, ATLAS, 'monkey_idle_0');
    this.slot = slot;
    this.baseTint = coop ? PLAYER_TINTS[slot] : 0xffffff;
    this.netX = x;
    this.netY = y;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    // Circle centred on the sprite: frame is 16x20, origin 0.5.
    body.setCircle(PLAYER_RADIUS, 8 - PLAYER_RADIUS, 10 - PLAYER_RADIUS);
    this.setCollideWorldBounds(true);
    this.setTint(this.baseTint);
    this.play('monkey-idle');
    if (coop) {
      this.tag = text(scene, x, y - 14, `P${slot + 1}`, { origin: [0.5, 1], color: PLAYER_COLORS[slot], depth: DEPTH.hpBar });
      this.reviveTag = text(scene, x, y + 16, '', { origin: [0.5, 0], color: COLOR.good, depth: DEPTH.hpBar }).setVisible(false);
    }
  }

  get bodyRadius(): number {
    return PLAYER_RADIUS;
  }

  /** Still in the fight: not dead and not disconnected. */
  get alive(): boolean {
    return !this.dead && !this.gone;
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
    if (this.dead || this.gone) {
      body.setVelocity(0, 0);
      this.moving = false;
      this.animate(dt);
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
    this.animate(dt);
  }

  /**
   * Co-op: a monkey moved by someone else's input. Eases toward the last reported position
   * so 20-30 updates a second still look smooth.
   */
  follow(dt: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    const k = 1 - Math.exp(-dt * 18);
    const dx = this.netX - this.x;
    const dy = this.netY - this.y;
    if (dx * dx + dy * dy > 120 * 120) body.reset(this.netX, this.netY);
    else body.reset(this.x + dx * k, this.y + dy * k);
    this.animate(dt);
  }

  /** Server-side upkeep the host runs for every monkey. */
  regenerate(dt: number): void {
    if (this.alive && this.stats.regen > 0 && this.hp < this.stats.maxHp) this.heal(this.stats.regen * dt);
  }

  /** Facing flip, hurt flash, walk/idle animation, depth and name tag. */
  animate(dt: number): void {
    if (this.facing.x !== 0) this.lookLeft = this.facing.x < 0;
    if (this.spinTime > 0) this.spinTime -= dt;
    this.setFlipX(this.spinTime > 0 ? !this.lookLeft : this.lookLeft);

    // Invulnerability flash: white on impact, then blinking.
    if (this.invuln > 0 && !this.dead) {
      this.invuln -= dt;
      const t = this.invulnTotal - this.invuln;
      if (t < 0.08) {
        this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      } else {
        this.setTint(this.baseTint).setTintMode(Phaser.TintModes.MULTIPLY);
        this.setAlpha(Math.floor(t * 16) % 2 === 0 ? 0.35 : 1);
      }
      if (this.invuln <= 0) this.setAlpha(1);
    }

    if (!this.dead) {
      if (this.hurtAnim > 0) {
        this.hurtAnim -= dt;
      } else {
        const key = this.moving ? 'monkey-walk' : 'monkey-idle';
        if (this.anims.currentAnim?.key !== key) this.play(key, true);
      }
    }

    this.setDepth(DEPTH.units + this.y / ARENA_SIZE);
    if (this.tag) {
      this.tag.setPosition(Math.round(this.x), Math.round(this.y - 11));
      this.tag.setVisible(!this.gone);
    }
    if (this.reviveTag) {
      const show = this.dead && !this.gone;
      this.reviveTag.setVisible(show);
      if (show) {
        this.reviveTag
          .setText(`REVIVE ${Math.round(this.reviveHp * 100)}%`)
          .setPosition(Math.round(this.x), Math.round(this.y + 15))
          .setAlpha(this.revive > 0 ? 1 : 0.7);
      }
    }
  }

  /** Returns the damage actually taken (0 while invulnerable). */
  takeHit(raw: number): number {
    if (this.invuln > 0 || !this.alive) return 0;
    const dmg = Math.max(1, raw - this.stats.armor);
    this.showHurt();
    if (!this.god) this.hp = Math.max(0, this.hp - dmg);
    return dmg;
  }

  showHurt(): void {
    this.invuln = this.invulnTotal = INVULN_SECONDS;
    this.hurtAnim = 0.2;
    this.play('monkey-hurt', true);
  }

  /** Falls over. Used on the host when HP runs out and on joiners when a snapshot says so. */
  fallOver(): void {
    this.dead = true;
    this.moving = false;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.play('monkey-hurt', true);
    this.setTint(this.baseTint).setTintMode(Phaser.TintModes.MULTIPLY);
    this.scene.tweens.add({ targets: this, alpha: 0.25, angle: 90, duration: 900, ease: 'Quad.easeIn' });
    this.tag?.setAlpha(0.4);
  }

  /** Co-op: revived by a teammate with `hpFraction` of max HP. */
  standUp(hpFraction: number, invulnSeconds: number): void {
    this.scene.tweens.killTweensOf(this);
    this.dead = false;
    this.revive = 0;
    this.setAngle(0).setAlpha(1);
    this.hp = Math.max(1, Math.round(this.stats.maxHp * hpFraction));
    this.invuln = this.invulnTotal = invulnSeconds;
    this.hurtAnim = 0;
    this.play('monkey-idle', true);
    this.tag?.setAlpha(1);
  }

  /** Co-op: the player left. */
  leave(): void {
    this.gone = true;
    this.disableBody(true, true);
    this.tag?.setVisible(false);
    this.reviveTag?.setVisible(false);
  }
}
