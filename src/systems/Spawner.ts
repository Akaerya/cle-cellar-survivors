import Phaser from 'phaser';
import { ARENA_SIZE, DESPAWN_SCREENS, INNER, MAX_ENEMIES, VIEW_H, VIEW_W, COLOR } from '../constants';
import { EV } from '../core/events';
import { sfx } from '../core/sfx';
import { enemyDef, hpScaleForMinute, waveForMinute, WAVE_EVENTS } from '../data';
import type { WaveEvent } from '../data/types';
import type { GameScene } from '../scenes/GameScene';

const RING_MARGIN = 24;

/** Tops the horde up toward the wave target every tick, and runs timed events such as bat swarms. */
export class Spawner {
  private fired = new Set<number>();

  constructor(private game: GameScene) {}

  get minute(): number {
    return Math.floor(this.game.runTime / 60);
  }

  get target(): number {
    return waveForMinute(this.minute).target;
  }

  tick(): void {
    const g = this.game;
    if (g.state !== 'playing') return;
    this.relocateStragglers();
    const minute = this.minute;
    const wave = waveForMinute(minute);
    const hpScale = hpScaleForMinute(minute);
    const alive = g.enemies.live;
    const deficit = Math.min(wave.target - alive, MAX_ENEMIES - alive);
    if (deficit <= 0) return;
    const batch = Math.min(deficit, Math.max(4, Math.ceil(wave.target / 6)));
    for (let i = 0; i < batch; i++) {
      const id = g.rng.weighted(wave.weights);
      if (!id) break;
      const def = enemyDef(id);
      const pt = this.ringPoint(def.radius);
      if (!pt) continue;
      g.enemies.spawn(def, pt.x, pt.y, hpScale);
    }
  }

  /** Spawns `count` enemies of the current wave mix on the ring (debug button). */
  spawnBurst(count: number): void {
    const wave = waveForMinute(this.minute);
    const hpScale = hpScaleForMinute(this.minute);
    for (let i = 0; i < count; i++) {
      const id = this.game.rng.weighted(wave.weights);
      if (!id) break;
      const def = enemyDef(id);
      const pt = this.ringPoint(def.radius);
      if (pt) this.game.enemies.spawn(def, pt.x, pt.y, hpScale);
    }
  }

  checkEvents(runTime: number): void {
    WAVE_EVENTS.forEach((ev, i) => {
      if (this.fired.has(i) || runTime < ev.at) return;
      this.fired.add(i);
      if (ev.type === 'swarm') this.swarm(ev);
    });
  }

  /** A ring of enemies closing in from every side that is inside the arena. */
  private swarm(ev: WaveEvent): void {
    const g = this.game;
    const def = enemyDef(ev.enemy);
    const hpScale = hpScaleForMinute(this.minute);
    const R = Math.hypot(VIEW_W, VIEW_H) / 2 + 20;
    const offset = g.rng.angle();
    for (let i = 0; i < ev.count; i++) {
      const a = offset + (i / ev.count) * Math.PI * 2;
      const x = g.player.x + Math.cos(a) * R;
      const y = g.player.y + Math.sin(a) * R;
      if (!this.insideArena(x, y, def.radius)) continue;
      g.enemies.spawn(def, x, y, hpScale);
    }
    sfx.play('swarm');
    g.events.emit(EV.banner, 'THE BATS ARE COMING', COLOR.bad);
  }

  private insideArena(x: number, y: number, r: number): boolean {
    return x > INNER.left + r + 2 && x < INNER.right - r - 2 && y > INNER.top + r + 2 && y < INNER.bottom - r - 2;
  }

  /** Random point on a rectangle just outside the viewport; points outside the arena are dropped. */
  ringPoint(radius: number): { x: number; y: number } | null {
    // The view is centred on the monkey and clamped at the arena edges, like the camera.
    // Computed directly so it is right even before the camera has rendered once.
    const p = this.game.player;
    const cx = Phaser.Math.Clamp(p.x, VIEW_W / 2, ARENA_SIZE - VIEW_W / 2);
    const cy = Phaser.Math.Clamp(p.y, VIEW_H / 2, ARENA_SIZE - VIEW_H / 2);
    const left = cx - VIEW_W / 2 - RING_MARGIN;
    const top = cy - VIEW_H / 2 - RING_MARGIN;
    const w = VIEW_W + RING_MARGIN * 2;
    const h = VIEW_H + RING_MARGIN * 2;
    const per = 2 * (w + h);
    for (let tries = 0; tries < 8; tries++) {
      let t = this.game.rng.float() * per;
      let x: number;
      let y: number;
      if (t < w) {
        x = left + t;
        y = top;
      } else if ((t -= w) < h) {
        x = left + w;
        y = top + t;
      } else if ((t -= h) < w) {
        x = left + w - t;
        y = top + h;
      } else {
        t -= w;
        x = left;
        y = top + h - t;
      }
      if (this.insideArena(x, y, radius)) return { x, y };
    }
    return null;
  }

  private relocateStragglers(): void {
    const g = this.game;
    const px = g.player.x;
    const py = g.player.y;
    const limX = DESPAWN_SCREENS * VIEW_W;
    const limY = DESPAWN_SCREENS * VIEW_H;
    for (const e of g.enemies.active) {
      if (!e.active) continue;
      if (Math.abs(e.x - px) > limX || Math.abs(e.y - py) > limY) {
        const pt = this.ringPoint(e.radius);
        if (pt) g.enemies.relocate(e, pt.x, pt.y);
      }
    }
  }
}
