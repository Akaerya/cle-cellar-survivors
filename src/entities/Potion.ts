import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH } from '../constants';
import { nextNetId } from '../net/ids';

/** Pooled health potion lying on the ground. */
export class Potion extends Phaser.Physics.Arcade.Sprite {
  /** Seconds until it disappears. */
  life = 0;
  /** Identifies this drop to network clients (pooled objects are reused). */
  netId = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, ATLAS, 'potion');
  }

  spawn(x: number, y: number, life: number): this {
    this.enableBody(true, x, y, true, true);
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.life = life;
    this.netId = nextNetId();
    this.setAlpha(1).setDepth(DEPTH.gems);
    return this;
  }

  /** Blinks during the last 5 seconds. */
  get blinking(): boolean {
    return this.life < 5 && Math.floor(this.life * 6) % 2 === 0;
  }
}
