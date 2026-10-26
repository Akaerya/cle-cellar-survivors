import type { PassiveDef } from './types';

/** Passives: one per character, always on. Run by systems/Passive.ts. */
export const PASSIVES: PassiveDef[] = [
  {
    id: 'ragebaiter',
    name: 'Ragebaiter',
    description: 'When you fall, you stand right back up with 50% HP, and someone gets put in the bin. Once every 120 seconds.',
    icon: 'icon_passive_ragebait',
    kind: 'rebirth',
    hp: 0.5,
    invuln: 1.5,
    cooldown: 120,
    // Named in the banner when nobody else is in the run.
    fallback: 'bearizm',
  },
  {
    id: 'dragonborn',
    name: 'Dragonborn',
    description: 'Every minute, for the rest of the run: +8% damage, +8 ability haste, +1% life steal and 1% less damage taken.',
    icon: 'icon_passive_dragon',
    kind: 'growth',
    every: 60,
    perStack: [
      { stat: 'damageMult', percent: 0.08 },
      { stat: 'abilityHaste', flat: 8 },
      { stat: 'lifeSteal', flat: 0.01 },
      { stat: 'damageTaken', percent: -0.01 },
    ],
  },
  {
    id: 'death_defied',
    name: 'Death Defied',
    description: 'Damage that would leave you below 25% HP is not taken: you heal 40% of your max HP over 2 seconds instead. Once every 120 seconds.',
    icon: 'icon_passive_defied',
    kind: 'reprieve',
    below: 0.25,
    heal: 0.4,
    over: 2,
    cooldown: 120,
  },
  {
    id: 'shroud',
    name: 'Shroud',
    description: '20% chance to dodge a hit entirely.',
    icon: 'icon_passive_shroud',
    kind: 'dodge',
    chance: 0.2,
  },
];
