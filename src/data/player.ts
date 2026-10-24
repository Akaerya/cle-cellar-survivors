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
  areaMult: 1,
  expMult: 1,
};

/** Collision circle radius of a character in px. */
export const PLAYER_RADIUS = 6;
