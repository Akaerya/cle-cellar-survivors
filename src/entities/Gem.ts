import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH } from '../constants';

export function gemColor(value: number): 'blue' | 'green' | 'red' {
  if (value >= 20) return 'red';
  if (value >= 5) return 'green';
  return 'blue';
}

/** Pooled EXP gem. Sits on the ground until it enters the pickup radius, then homes in. */
export class Gem extends Phaser.Physics.Arcade.Sprite {
  value = 1;
  attracted = false;
  vx = 0;
  vy = 0;
  private color: string = '';

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, ATLAS, 'gem_blue_0');
  }

  spawn(x: number, y: number, value: number): this {
    this.enableBody(true, x, y, true, true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(3, this.width / 2 - 3, this.height / 2 - 3);
    body.setVelocity(0, 0);
    this.attracted = false;
    this.vx = this.vy = 0;
    this.value = 0;
    this.color = '';
    this.addValue(value);
    this.setDepth(DEPTH.gems);
    return this;
  }

  addValue(v: number): void {
    this.value += v;
    const c = gemColor(this.value);
    if (c !== this.color) {
      this.color = c;
      this.play({ key: `gem-${c}`, startFrame: Math.floor(Math.random() * 2) }, true);
    }
  }
}
