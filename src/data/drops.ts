/** Health potions: a rare drop from any enemy (chance per enemy in data/enemies.ts). */
export const POTION = {
  /** Fraction of the picker's max HP restored. */
  healPercent: 0.3,
  /** Seconds a potion stays on the ground; it blinks for the last 5. */
  lifetime: 45,
  /** Most potions on the ground at once; further drops are skipped. */
  maxOnGround: 12,
  /** px between the potion and the player's centre to pick it up (no magnet). */
  pickupRadius: 12,
};

/** EXP gem colours by the value they hold (gems merge past the gem cap and change colour). */
export const GEM_TIERS = [
  { color: 'blue', from: 1 },
  { color: 'green', from: 5 },
  { color: 'red', from: 20 },
] as const;
