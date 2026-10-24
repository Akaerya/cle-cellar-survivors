import Phaser from 'phaser';
import { COLOR } from '../constants';
import { POTION } from '../data';
import type { Player } from '../entities/Player';
import { Potion } from '../entities/Potion';
import type { GameScene } from '../scenes/GameScene';

/** Rare health potions: dropped by dying enemies, picked up by walking over them. */
export class Potions {
  readonly group: Phaser.Physics.Arcade.Group;

  constructor(private game: GameScene) {
    this.group = game.physics.add.group({ classType: Potion, maxSize: POTION.maxOnGround, runChildUpdate: false });
  }

  /** Rolls the enemy's drop chance; drops a potion on success. */
  roll(x: number, y: number, chance: number): void {
    if (chance <= 0 || this.game.rng.float() >= chance) return;
    const p = this.group.get(x, y) as Potion | null;
    if (!p) return; // the ground is full
    p.spawn(x, y, POTION.lifetime);
  }

  update(dt: number): void {
    const players = this.game.livePlayers();
    const R2 = POTION.pickupRadius * POTION.pickupRadius;
    for (const p of this.group.getChildren() as Potion[]) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.disableBody(true, true);
        continue;
      }
      p.setAlpha(p.blinking ? 0.3 : 1);
      // Only a player that is hurt drinks it, so a full-HP teammate does not waste it.
      for (const pl of players) {
        if (pl.hp >= pl.stats.maxHp) continue;
        if ((pl.x - p.x) ** 2 + (pl.y - p.y) ** 2 > R2) continue;
        this.drink(p, pl);
        break;
      }
    }
  }

  private drink(p: Potion, pl: Player): void {
    p.disableBody(true, true);
    const before = pl.hp;
    pl.heal(pl.stats.maxHp * POTION.healPercent);
    const healed = pl.hp - before;
    this.game.fx.healNumber(pl.x, pl.y - 12, healed);
    this.game.fx.puff(pl.x, pl.y, COLOR.good, 8);
    this.game.playSfx('heal', pl.x, pl.y);
    this.game.onPlayerHealed(pl);
  }
}
