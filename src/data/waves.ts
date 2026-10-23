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

/** Enemy HP grows this fraction of base HP per minute (1.0x at 0:00, 2.4x at 14:00). */
export const HP_SCALE_PER_MINUTE = 0.1;

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
