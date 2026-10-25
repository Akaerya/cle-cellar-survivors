import type { ChainsDef, EnemyModifierDef, HazardDef, RareTier } from './types';

/**
 * Rare enemies: every enemy the spawner brings in (waves and swarms, not bosses or their minions) may roll a tier and
 * get that many different modifiers, picked at random from ENEMY_MODIFIERS. Rare enemies get a border in the tier's
 * colour, and some modifiers have a look of their own. The modifier names stay in the code: players never see them.
 * What the modifiers do is in systems/EnemyModifiers.ts.
 */

/** Checked in order; an enemy that rolls none of them spawns normal (97.3% of spawns). */
export const RARE_TIERS: RareTier[] = [
  { modifiers: 6, chance: 0.004, color: 0xf7d84a },
  { modifiers: 4, chance: 0.008, color: 0xb46bff },
  { modifiers: 2, chance: 0.015, color: 0x5aa8ff },
];

/** Base HP added per modifier (0.7: two modifiers are +140%). Adds up with Extra Life and Empower Allies. */
export const RARE_HP_PER_MODIFIER = 0.7;

/** Astral Chains: what standing in a void field piles on a player, on top of the field's own slow. */
export const ASTRAL_CHAINS: ChainsDef = { every: 0.25, duration: 3, slow: 0.1, max: 5 };

/** What modifiers leave in the world. Added to HAZARDS (data/index.ts), so joiners draw them like boss hazards. */
export const RARE_HAZARDS: HazardDef[] = [
  { id: 'void_field', frame: 'voidfield', radius: 35, artRadius: 15.5, spin: 0.8, ground: true, fade: 0.5, slow: 0.4, chains: ASTRAL_CHAINS },
  { id: 'caustic_ground', frame: 'caustic_0', anim: 'caustic-bubble', radius: 35, artRadius: 15.5, ground: true, fade: 0.6 },
  { id: 'crystal_bud', frame: 'crystalbud_0', anim: 'crystalbud-grow', radius: 6, artRadius: 6, ground: true },
];

export const ENEMY_MODIFIERS: EnemyModifierDef[] = [
  { id: 'astral_touched', name: 'Astral-Touched', color: 0x9b6bff, every: 4, spread: 80, hazard: 'void_field', life: 3 },
  { id: 'invulnerability', name: 'Invulnerability', color: 0xf7d84a, radius: 40 },
  { id: 'enrage', name: 'Enrages as Life Lost', color: 0xff4a3a, damage: 0.4, speed: 0.4, reduction: 0.3, fullAt: 0.2 },
  { id: 'physical_resistant', name: 'Physical Resistant', color: 0xa8a8b8, reduction: 0.5 },
  { id: 'caustic_ground', name: 'Caustic Ground on Death', color: 0x8ee04a, hazard: 'caustic_ground', life: 4, damage: 5, interval: 0.5 },
  { id: 'crystalline', name: 'Crystalline', color: 0x9fe8ff, hazard: 'crystal_bud', charge: 1, radius: 30, damage: 50 },
  { id: 'empower_allies', name: 'Empower Allies', color: 0xff9a3a, radius: 65, health: 0.4, speed: 0.4, damage: 0.4 },
  { id: 'executioner', name: 'Executioner', color: 0xc0392b, per: 0.1, more: 0.2 },
  { id: 'extra_life', name: 'Extra Life', color: 0xff7a8a, health: 0.4 },
  { id: 'hexproof', name: 'Hexproof', color: 0xe8e8f4 },
  { id: 'thorns', name: 'Thorns', color: 0xd08a4a, flat: 3, share: 0.4 },
  { id: 'ambush', name: 'Ambush', color: 0x6a4a9a, cooldown: 4, distance: 28 },
  { id: 'soul_absorption', name: 'Soul Absorption', color: 0xb8f0ff, radius: 130, damage: 0.01, haste: 1 },
  { id: 'spirit_walker', name: 'Spirit Walker', color: 0x9ff0c8, radius: 130, alpha: 0.55 },
  { id: 'blocks_attacks', name: 'Blocks Attacks', color: 0xd0d0e0, chance: 0.5 },
  { id: 'temporal_shield', name: 'Temporal Shield', color: 0x8ad8ff, radius: 40 },
];

/** Most souls drawn circling a Soul Absorption enemy (it keeps gaining them past this). */
export const MAX_SOUL_WISPS = 8;
