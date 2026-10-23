import type { PlayerStats } from './types';

/** Base stats for the monkey. Items modify these through flat or percentage changes. */
export const BASE_STATS: PlayerStats = {
  maxHp: 100,
  moveSpeed: 160,
  regen: 0,
  armor: 0,
  pickupRadius: 60,
  damageMult: 1,
  cooldownMult: 1,
  areaMult: 1,
  expMult: 1,
};

/** Collision circle radius of the monkey in px. */
export const PLAYER_RADIUS = 6;

export const STARTING_WEAPON = 'banana';
