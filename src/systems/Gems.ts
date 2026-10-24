import Phaser from 'phaser';
import { MAX_GEMS } from '../constants';
import { Gem } from '../entities/Gem';
import type { Player } from '../entities/Player';
import type { GameScene } from '../scenes/GameScene';

/** Speed a gem starts flying at, as a multiple of the target's move speed (always faster than the monkey). */
const START_SPEED_MULT = 1.6;
const ACCEL = 900;
const MAX_SPEED = 900;

/** EXP gems: drop, merge past the cap, fly straight at a monkey once inside its pickup radius. */
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
    const players = this.game.livePlayers();
    for (const g of this.group.getChildren() as Gem[]) {
      if (!g.active) continue;
      if (g.target && !g.target.alive) g.target = null;
      if (!g.target) {
        g.target = this.pickupBy(g, players);
        if (!g.target) continue;
        g.speed = g.target.stats.moveSpeed * START_SPEED_MULT;
      }
      // Straight line at the monkey, re-aimed every frame and always faster than it: no orbiting.
      const p = g.target;
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const d = Math.hypot(dx, dy) || 1;
      g.speed = Math.min(MAX_SPEED, g.speed + ACCEL * dt);
      if (d < p.bodyRadius + 5 || g.speed * dt >= d) {
        this.collect(g, p);
        continue;
      }
      (g.body as Phaser.Physics.Arcade.Body).setVelocity((dx / d) * g.speed, (dy / d) * g.speed);
    }
  }

  /** Nearest living monkey whose pickup radius contains the gem. */
  private pickupBy(g: Gem, players: Player[]): Player | null {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of players) {
      const d2 = (p.x - g.x) ** 2 + (p.y - g.y) ** 2;
      const R = p.stats.pickupRadius;
      if (d2 <= R * R && d2 < bestD) {
        bestD = d2;
        best = p;
      }
    }
    return best;
  }

  collect(g: Gem, p: Player): void {
    if (!g.active) return;
    const value = g.value;
    g.disableBody(true, true);
    g.anims.stop();
    g.target = null;
    this.live--;
    this.game.playSfx('gem');
    this.game.addExp(value * p.stats.expMult);
  }
}
