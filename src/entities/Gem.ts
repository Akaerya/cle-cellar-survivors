import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH } from '../constants';
import { GEM_TIERS } from '../data/drops';
import { nextNetId } from '../net/ids';
import type { Player } from './Player';

export function gemColor(value: number): 'blue' | 'green' | 'red' {
  let c: 'blue' | 'green' | 'red' = 'blue';
  for (const t of GEM_TIERS) if (value >= t.from) c = t.color;
  return c;
}

/** Pooled EXP gem. Sits on the ground until it enters a pickup radius, then flies at that player. */
export class Gem extends Phaser.Physics.Arcade.Sprite {
  value = 1;
  /** The player this gem is flying to, or null while it sits on the ground. */
  target: Player | null = null;
  speed = 0;
  /** Identifies this spawn to network clients (pooled objects are reused). */
  netId = 0;
  color: 'blue' | 'green' | 'red' | '' = '';

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, ATLAS, 'gem_blue_0');
  }

  spawn(x: number, y: number, value: number): this {
    this.enableBody(true, x, y, true, true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(3, this.width / 2 - 3, this.height / 2 - 3);
    body.setVelocity(0, 0);
    this.target = null;
    this.speed = 0;
    this.netId = nextNetId();
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
