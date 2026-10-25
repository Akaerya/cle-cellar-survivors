import type { WaveEvent, WaveRow } from './types';

/** First-pass numbers from the spec, to tune in playtesting. */
export const WAVES: WaveRow[] = [
  { from: 0, to: 1, target: 15, weights: { bat: 100 } },
  { from: 1, to: 2, target: 30, weights: { bat: 60, zombie: 40 } },
  { from: 2, to: 4, target: 50, weights: { bat: 40, zombie: 60 } },
  { from: 4, to: 5, target: 70, weights: { bat: 30, zombie: 40, ghoul: 30 } },
  { from: 5, to: 7, target: 100, weights: { zombie: 50, ghoul: 50 } },
  { from: 7, to: 10, target: 150, weights: { zombie: 40, ghoul: 40, brute: 20 } },
  { from: 10, to: 13, target: 220, weights: { ghoul: 50, brute: 30, bat: 20 } },
  { from: 13, to: 15, target: 300, weights: { ghoul: 40, brute: 40, zombie: 20 } },
];

/** Enemy HP grows this fraction of base HP per minute (1.0x at 0:00, 3.1x at 14:00). */
export const HP_SCALE_PER_MINUTE = 0.15;

/**
 * Enemies start slower and reach full speed over the first minutes:
 * speed multiplier = min(1, START + PER_MINUTE x minute), so 70% at 0:00, 85% at 2:00, 100% from 4:00.
 * Applies to every enemy on the field, so early enemies speed up as the clock runs.
 */
export const SPEED_SCALE_START = 0.7;
export const SPEED_SCALE_PER_MINUTE = 0.075;

export function speedScaleForMinute(minute: number): number {
  return Math.min(1, SPEED_SCALE_START + SPEED_SCALE_PER_MINUTE * Math.max(0, minute));
}

/**
 * Co-op: enemy HP is multiplied by 1 + this x (players - 1), so 2 players face 1.75x HP,
 * 3 players 2.5x and 4 players 3.25x.
 */
export const HP_SCALE_PER_EXTRA_PLAYER = 0.75;

export function hpScaleForPlayers(players: number): number {
  return 1 + HP_SCALE_PER_EXTRA_PLAYER * Math.max(0, players - 1);
}

/**
 * Spawn pressure: the wave's ON FIELD target (and with it how fast the horde is topped up) is multiplied by
 * (1 + PER_MINUTE x minute) x (1 + PER_EXTRA_PLAYER x (players - 1)), capped at MAX_ENEMIES.
 * So +4% per minute (x1.56 at 14:00) and +15% per extra player (x1.45 with 4 players).
 */
export const SPAWN_SCALE_PER_MINUTE = 0.04;
export const SPAWN_SCALE_PER_EXTRA_PLAYER = 0.15;

export function spawnScaleFor(minute: number, players: number): number {
  return (1 + SPAWN_SCALE_PER_MINUTE * Math.max(0, minute)) * (1 + SPAWN_SCALE_PER_EXTRA_PLAYER * Math.max(0, players - 1));
}

export const WAVE_EVENTS: WaveEvent[] = [
  { at: 5 * 60, type: 'swarm', enemy: 'bat', count: 40 },
  { at: 10 * 60, type: 'swarm', enemy: 'bat', count: 40 },
];

export function waveForMinute(minute: number): WaveRow {
  for (const row of WAVES) {
    if (minute >= row.from && minute < row.to) return row;
  }
  return WAVES[WAVES.length - 1];
}

export function hpScaleForMinute(minute: number): number {
  return 1 + HP_SCALE_PER_MINUTE * Math.max(0, minute);
}
