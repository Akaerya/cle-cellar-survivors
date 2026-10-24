import type { ItemDef } from './types';

/** Generic powerups go up to this level (items and modifications stop at MAX_LEVEL). */
export const POWERUP_MAX_LEVEL = 20;

/**
 * Generic powerups: plain stat boosts for the character. They take no slots and are offered until they
 * reach POWERUP_MAX_LEVEL. Modifiers work like items: (base + flat) x (1 + percent), summed over levels.
 */
export const POWERUPS: ItemDef[] = [
  {
    id: 'damage',
    name: 'Damage',
    description: 'All your weapons deal 5% more damage.',
    icon: 'icon_pu_damage',
    perLevel: [{ stat: 'damageMult', percent: 0.05 }],
    levelText: '+5% damage.',
    maxLevel: POWERUP_MAX_LEVEL,
  },
  {
    id: 'max_health',
    name: 'Maximum Health',
    description: '+20 max HP. Also heals 20 HP.',
    icon: 'icon_pu_health',
    perLevel: [{ stat: 'maxHp', flat: 20 }],
    levelText: '+20 max HP. Also heals 20 HP.',
    maxLevel: POWERUP_MAX_LEVEL,
  },
  {
    id: 'ability_haste',
    name: 'Ability Haste',
    description: '+10 ability haste: weapon cooldowns tick down faster.',
    icon: 'icon_pu_haste',
    perLevel: [{ stat: 'abilityHaste', flat: 10 }],
    levelText: '+10 ability haste.',
    maxLevel: POWERUP_MAX_LEVEL,
  },
  {
    id: 'move_speed',
    name: 'Movement Speed',
    description: '+10 move speed.',
    icon: 'icon_pu_speed',
    perLevel: [{ stat: 'moveSpeed', flat: 10 }],
    levelText: '+10 move speed.',
    maxLevel: POWERUP_MAX_LEVEL,
  },
  {
    id: 'health_regen',
    name: 'Health Regen',
    description: 'Heal 0.3% of your max HP every second, even right after a hit.',
    icon: 'icon_pu_regen',
    perLevel: [{ stat: 'regenPercent', flat: 0.003 }],
    levelText: '+0.3% max HP healed per second.',
    maxLevel: POWERUP_MAX_LEVEL,
  },
  {
    id: 'damage_taken',
    name: 'Damage Taken',
    description: 'Take 2% less damage from every hit.',
    icon: 'icon_pu_armor',
    perLevel: [{ stat: 'damageTaken', percent: -0.02 }],
    levelText: '-2% damage taken.',
    maxLevel: POWERUP_MAX_LEVEL,
  },
];
