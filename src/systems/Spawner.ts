import Phaser from 'phaser';
import { ARENA_SIZE, DESPAWN_SCREENS, INNER, MAX_ENEMIES, VIEW_H, VIEW_W, COLOR } from '../constants';
import { enemyDef, hpScaleForMinute, hpScaleForPlayers, waveForMinute, WAVE_EVENTS } from '../data';
import type { WaveEvent } from '../data/types';
import type { Player } from '../entities/Player';
import type { GameScene } from '../scenes/GameScene';

const RING_MARGIN = 24;

/**
 * Tops the horde up toward the wave target every tick, and runs timed events such as bat swarms.
 * In co-op each new enemy appears just off the screen of a random living player.
 */
export class Spawner {
  private fired = new Set<number>();

  constructor(private game: GameScene) {}

  get minute(): number {
    return Math.floor(this.game.runTime / 60);
  }

  get target(): number {
    return waveForMinute(this.minute).target;
  }

  /** Minute scaling times the co-op player scaling. */
  private get hpScale(): number {
    return hpScaleForMinute(this.minute) * hpScaleForPlayers(this.game.playerCount);
  }

  tick(): void {
    const g = this.game;
    if (g.state !== 'playing') return;
    const players = g.livePlayers();
    if (players.length === 0) return;
    this.relocateStragglers(players);
    const wave = waveForMinute(this.minute);
    const hpScale = this.hpScale;
    const alive = g.enemies.live;
    const deficit = Math.min(wave.target - alive, MAX_ENEMIES - alive);
    if (deficit <= 0) return;
    const batch = Math.min(deficit, Math.max(4, Math.ceil(wave.target / 6)));
    for (let i = 0; i < batch; i++) {
      const id = g.rng.weighted(wave.weights);
      if (!id) break;
      const def = enemyDef(id);
      const pt = this.ringPoint(def.radius, g.rng.pick(players));
      if (!pt) continue;
      g.enemies.spawn(def, pt.x, pt.y, hpScale);
    }
  }

  /** Spawns `count` enemies of the current wave mix on the ring (debug button). */
  spawnBurst(count: number): void {
    const wave = waveForMinute(this.minute);
    const hpScale = this.hpScale;
    const players = this.game.livePlayers();
    if (players.length === 0) return;
    for (let i = 0; i < count; i++) {
      const id = this.game.rng.weighted(wave.weights);
      if (!id) break;
      const def = enemyDef(id);
      const pt = this.ringPoint(def.radius, this.game.rng.pick(players));
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

  /** A ring of enemies closing in from every side that is inside the arena, around each living player. */
  private swarm(ev: WaveEvent): void {
    const g = this.game;
    const def = enemyDef(ev.enemy);
    const hpScale = this.hpScale;
    const R = Math.hypot(VIEW_W, VIEW_H) / 2 + 20;
    for (const p of g.livePlayers()) {
      const offset = g.rng.angle();
      for (let i = 0; i < ev.count; i++) {
        const a = offset + (i / ev.count) * Math.PI * 2;
        const x = p.x + Math.cos(a) * R;
        const y = p.y + Math.sin(a) * R;
        if (!this.insideArena(x, y, def.radius)) continue;
        g.enemies.spawn(def, x, y, hpScale);
      }
    }
    g.playSfx('swarm');
    g.banner('THE BATS ARE COMING', COLOR.bad);
  }

  private insideArena(x: number, y: number, r: number): boolean {
    return x > INNER.left + r + 2 && x < INNER.right - r - 2 && y > INNER.top + r + 2 && y < INNER.bottom - r - 2;
  }

  /** Random point on a rectangle just outside `p`'s viewport; points outside the arena are dropped. */
  ringPoint(radius: number, p: Player): { x: number; y: number } | null {
    // The view is centred on the player and clamped at the arena edges, like the camera.
    // Computed directly so it is right even before the camera has rendered once.
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

  /** Enemies far from every living player are moved back near one of them, keeping their HP. */
  private relocateStragglers(players: Player[]): void {
    const g = this.game;
    const limX = DESPAWN_SCREENS * VIEW_W;
    const limY = DESPAWN_SCREENS * VIEW_H;
    for (const e of g.enemies.active) {
      if (!e.active) continue;
      const near = players.some((p) => Math.abs(e.x - p.x) <= limX && Math.abs(e.y - p.y) <= limY);
      if (near) continue;
      const pt = this.ringPoint(e.radius, g.rng.pick(players));
      if (pt) g.enemies.relocate(e, pt.x, pt.y);
    }
  }
}
