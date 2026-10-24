import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { ARENA_SIZE, DEPTH, MAX_ENEMIES } from '../constants';
import { SpatialGrid } from '../core/spatialGrid';
import type { EnemyDef } from '../data/types';
import { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { GameScene } from '../scenes/GameScene';
import type { WeaponInstance } from './Weapons';

/** Knockback is an impulse that decays with this time constant, so `knockback` px is the distance pushed. */
const KB_TAU = 0.12;
/** px/s of push per full overlap between two enemies. */
const SEP_STRENGTH = 150;
const SEP_MAX = 170;

const MASS: Record<string, number> = { brute: 5 };

export class Enemies {
  readonly group: Phaser.Physics.Arcade.Group;
  readonly grid = new SpatialGrid<Enemy>(ARENA_SIZE, ARENA_SIZE, 64);
  /** Active enemies, rebuilt at the start of every update. */
  readonly active: Enemy[] = [];
  private shadows: Phaser.GameObjects.Blitter;
  live = 0;

  constructor(private game: GameScene) {
    this.group = game.physics.add.group({ classType: Enemy, maxSize: MAX_ENEMIES, runChildUpdate: false });
    this.shadows = game.add.blitter(0, 0, ATLAS).setDepth(DEPTH.shadows);
  }

  spawn(def: EnemyDef, x: number, y: number, hpScale: number): Enemy | null {
    if (this.live >= MAX_ENEMIES) return null;
    const e = this.group.get(x, y) as Enemy | null;
    if (!e) return null;
    e.spawn(def, x, y, hpScale);
    if (!e.shadow) e.shadow = this.shadows.create(x, y, def.shadow);
    else e.shadow.setFrame(def.shadow);
    e.shadow.visible = true;
    this.live++;
    this.active.push(e);
    return e;
  }

  /** Every enemy walks at the nearest monkey in `targets`. */
  update(dt: number, now: number, targets: Player[], frozen: boolean, speedScale = 1): void {
    const active = this.active;
    active.length = 0;
    this.grid.clear();
    const children = this.group.getChildren() as Enemy[];
    for (let i = 0; i < children.length; i++) {
      const e = children[i];
      if (!e.active) continue;
      active.push(e);
      this.grid.insert(e);
      e.sepX = 0;
      e.sepY = 0;
    }

    // Soft push-apart so the horde forms a crowd instead of stacking on one point.
    this.grid.forEachNeighbourPair((a, b) => {
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const min = (a.radius + b.radius) * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) return;
      let d = Math.sqrt(d2);
      if (d < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d = Math.hypot(dx, dy);
      }
      const push = ((min - d) / min) * SEP_STRENGTH;
      const nx = dx / d;
      const ny = dy / d;
      const ma = MASS[a.def.id] ?? 1;
      const mb = MASS[b.def.id] ?? 1;
      const wa = (2 * mb) / (ma + mb);
      const wb = (2 * ma) / (ma + mb);
      a.sepX -= nx * push * wa;
      a.sepY -= ny * push * wa;
      b.sepX += nx * push * wb;
      b.sepY += ny * push * wb;
    });

    const decay = Math.exp(-dt / KB_TAU);
    for (let i = 0; i < active.length; i++) {
      const e = active[i];
      const body = e.body as Phaser.Physics.Arcade.Body;
      if (frozen || targets.length === 0) {
        body.setVelocity(0, 0);
      } else {
        let t = targets[0];
        let best = Infinity;
        for (let k = 0; k < targets.length; k++) {
          const c = targets[k];
          const d2 = (c.x - e.x) ** 2 + (c.y - e.y) ** 2;
          if (d2 < best) {
            best = d2;
            t = c;
          }
        }
        const dx = t.x - e.x;
        const dy = t.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        e.kbx *= decay;
        e.kby *= decay;
        const sl = Math.hypot(e.sepX, e.sepY);
        const sk = sl > SEP_MAX ? SEP_MAX / sl : 1;
        const sp = e.def.speed * speedScale;
        body.setVelocity(
          (dx / d) * sp + e.kbx + e.sepX * sk,
          (dy / d) * sp + e.kby + e.sepY * sk,
        );
        if (Math.abs(dx) > 2) e.setFlipX(dx < 0);
      }
      if (e.flashUntil !== 0 && now >= e.flashUntil) {
        e.flashUntil = 0;
        e.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      }
      e.setDepth(DEPTH.units + e.y / ARENA_SIZE);
      const s = e.shadow!;
      const sw = e.def.shadow === 'shadow_l' ? 24 : 12;
      s.x = e.x - sw / 2;
      s.y = e.y + e.height / 2 - 3 + e.def.hover;
    }
  }

  /** dirX/dirY: unit vector to push the enemy along. */
  hit(e: Enemy, amount: number, dirX: number, dirY: number, knockback: number, weapon?: WeaponInstance): void {
    if (!e.active || e.hp <= 0) return;
    const dealt = Math.min(e.hp, amount);
    e.hp -= amount;
    if (weapon) weapon.damage += dealt;
    e.flash(this.game.time.now);
    this.game.fx.damageNumber(e.x, e.y - e.height / 2, amount, amount >= 25);
    const k = (knockback * (1 - e.def.knockbackResist)) / KB_TAU;
    e.kbx += dirX * k;
    e.kby += dirY * k;
    this.game.playSfx('hit', e.x, e.y);
    if (e.hp <= 0) this.kill(e, true);
  }

  kill(e: Enemy, dropGem: boolean): void {
    if (!e.active) return;
    this.game.fx.puff(e.x, e.y, e.def.puffColor, e.def.id === 'brute' ? 18 : 8);
    if (dropGem) {
      this.game.gems.drop(e.x, e.y + 2, e.def.exp);
      this.game.potions.roll(e.x, e.y - 2, e.def.potionChance);
    }
    e.disableBody(true, true);
    e.anims.stop();
    if (e.shadow) e.shadow.visible = false;
    this.live--;
    if (dropGem) {
      this.game.playSfx('kill', e.x, e.y);
      this.game.onEnemyKilled();
    }
  }

  /** Moves an enemy without losing its HP (used for stragglers far from the monkey). */
  relocate(e: Enemy, x: number, y: number): void {
    (e.body as Phaser.Physics.Arcade.Body).reset(x, y);
    e.kbx = e.kby = 0;
  }

  nearest(x: number, y: number, maxDist: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < this.active.length; i++) {
      const e = this.active[i];
      if (!e.active) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = e;
      }
    }
    return best;
  }
}
