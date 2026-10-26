import type { PlayerStats } from './types';

/** Base stats for every character. Items and powerups modify these through flat or percentage changes. */
export const BASE_STATS: PlayerStats = {
  maxHp: 100,
  moveSpeed: 160,
  regen: 0,
  regenPercent: 0,
  armor: 0,
  damageTaken: 1,
  pickupRadius: 60,
  damageMult: 1,
  cooldownMult: 1,
  abilityHaste: 0,
  critChance: 0,
  critDamage: 2,
  areaMult: 1,
  expMult: 1,
  lifeSteal: 0,
};

/** Level-up rerolls each player gets per run: a reroll replaces all three cards on offer. */
export const REROLLS_PER_RUN = 5;

/** Collision circle radius of a character in px. */
export const PLAYER_RADIUS = 6;
