import Phaser from 'phaser';
import { MAX_GEMS } from '../constants';
import { sfx } from '../core/sfx';
import { Gem } from '../entities/Gem';
import type { GameScene } from '../scenes/GameScene';

const HOMING_ACCEL = 1500;
const HOMING_MAX = 720;
const POP_SPEED = 90;

/** EXP gems: drop, merge past the cap, home in once inside the pickup radius. */
export class Gems {
  readonly group: Phaser.Physics.Arcade.Group;
  live = 0;

  constructor(private game: GameScene) {
    this.group = game.physics.add.group({ classType: Gem, maxSize: MAX_GEMS + 8, runChildUpdate: false });
  }

  drop(x: number, y: number, value: number): void {
    if (this.live >= MAX_GEMS) {
      this.mergeIntoNearest(x, y, value);
      return;
    }
    const g = this.group.get(x, y) as Gem | null;
    if (!g) {
      this.mergeIntoNearest(x, y, value);
      return;
    }
    g.spawn(x, y, value);
    this.live++;
  }

  private mergeIntoNearest(x: number, y: number, value: number): void {
    let best: Gem | null = null;
    let bestD = Infinity;
    for (const c of this.group.getChildren() as Gem[]) {
      if (!c.active) continue;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) best.addValue(value);
  }

  update(dt: number): void {
    const p = this.game.player;
    const R = p.stats.pickupRadius;
    const R2 = R * R;
    for (const g of this.group.getChildren() as Gem[]) {
      if (!g.active) continue;
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2) || 1;
      if (!g.attracted) {
        if (d2 > R2) continue;
        g.attracted = true;
        // Small hop away first, then a rush in: reads as being sucked up.
        g.vx = (-dx / d) * POP_SPEED;
        g.vy = (-dy / d) * POP_SPEED;
      }
      g.vx += (dx / d) * HOMING_ACCEL * dt;
      g.vy += (dy / d) * HOMING_ACCEL * dt;
      const sp = Math.hypot(g.vx, g.vy);
      if (sp > HOMING_MAX) {
        g.vx = (g.vx / sp) * HOMING_MAX;
        g.vy = (g.vy / sp) * HOMING_MAX;
      }
      (g.body as Phaser.Physics.Arcade.Body).setVelocity(g.vx, g.vy);
      if (d < p.bodyRadius + 5) this.collect(g);
    }
  }

  collect(g: Gem): void {
    if (!g.active) return;
    const value = g.value;
    g.disableBody(true, true);
    g.anims.stop();
    this.live--;
    sfx.play('gem');
    this.game.addExp(value);
  }
}
