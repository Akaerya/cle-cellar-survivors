/** Co-op revives: stand on a fallen teammate to bring them back. */
export const REVIVE = {
  /** Seconds a living player must stand on the body. */
  seconds: 5,
  /** px from the body that counts as standing on it. */
  radius: 18,
  /** HP restored after the team's first death, as a fraction of max HP. */
  baseHpPercent: 0.8,
  /**
   * Each later team death lowers the restored HP by a growing step:
   * death n restores base - step x (1 + 2 + ... + (n - 1)), so 80%, 75%, 65%, 50%, 30%, then the floor.
   */
  penaltyStep: 0.05,
  /** Restored HP never drops below this fraction. */
  minHpPercent: 0.1,
  /** Revive progress drains at this multiple of the fill rate when nobody stands on the body. */
  drainRate: 1,
  /** Seconds of invulnerability after standing up. */
  invulnSeconds: 2,
};

/** HP fraction a player gets back when revived from the team's `deathNumber`-th death (1-based). */
export function reviveHpPercent(deathNumber: number): number {
  const k = Math.max(0, deathNumber - 1);
  return Math.max(REVIVE.minHpPercent, REVIVE.baseHpPercent - REVIVE.penaltyStep * ((k * (k + 1)) / 2));
}
