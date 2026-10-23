import Phaser from 'phaser';

/**
 * One seeded generator per run, so a bug or a balance run can be replayed with ?seed=...
 * Visual-only randomness (particles) may still use Math.random.
 */
export class Rng {
  readonly seed: string;
  private gen: Phaser.Math.RandomDataGenerator;

  constructor(seed?: string) {
    this.seed = seed && seed.length > 0 ? seed : String(Math.floor(Math.random() * 1e9));
    this.gen = new Phaser.Math.RandomDataGenerator([this.seed]);
  }

  /** [0, 1) */
  float(): number {
    return this.gen.frac();
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.gen.frac();
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  angle(): number {
    return this.gen.frac() * Math.PI * 2;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.gen.frac() * list.length)];
  }

  /** Picks a key with probability proportional to its weight. */
  weighted(weights: Record<string, number>): string | null {
    let total = 0;
    for (const k in weights) total += Math.max(0, weights[k]);
    if (total <= 0) return null;
    let roll = this.gen.frac() * total;
    for (const k in weights) {
      roll -= Math.max(0, weights[k]);
      if (roll < 0) return k;
    }
    return Object.keys(weights)[0] ?? null;
  }

  /** Fisher-Yates, returns a new array. */
  shuffled<T>(list: readonly T[]): T[] {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.gen.frac() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/** Reads ?seed= from the page URL, if present. */
export function seedFromUrl(): string | undefined {
  try {
    const s = new URLSearchParams(window.location.search).get('seed');
    return s ?? undefined;
  } catch {
    return undefined;
  }
}
