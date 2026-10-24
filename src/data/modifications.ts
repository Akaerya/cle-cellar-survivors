import type { ModificationDef } from './types';

/**
 * Modifications: level-up picks that change every weapon sharing one of their tags (WeaponDef.tags).
 * Each goes up to level 5 and is only offered while you own a weapon it changes.
 *
 * Projectiles resolve a hit in this order: split if they still can, otherwise use up pierce,
 * then chain once pierce is gone.
 */

/** Split: the new projectiles fan out over this many degrees around the direction of the one that split. */
export const SPLIT_ARC = 90;
/** Chain: how far (px) a projectile looks for an enemy to bounce to. */
export const CHAIN_RANGE = 140;
/** Echo Strike: radius (px) of each echo before AREA, area modifications and Echo Strike's own area bonus. */
export const ECHO_RADIUS = 20;
/** Echo Strike: seconds between echoes when an echo goes off more than once. */
export const ECHO_GAP = 0.2;

const pierce = { text: '+1 pierce, +15% damage.', add: { pierce: 1, damage: 0.15 } };
const chain = { text: '+1 bounce.', add: { chain: 1 } };
const moreProjectiles = { text: '+1 projectile.', add: { projectiles: 1 } };
const moreArea = { text: '+10% area.', add: { area: 0.1 } };
const lessArea = { text: '-10% area, +18% damage.', add: { area: -0.1, damage: 0.18 } };
const moreDuration = { text: '+20% duration.', add: { duration: 0.2 } };
const lessDuration = { text: '-10% duration, +20% damage.', add: { duration: -0.1, damage: 0.2 } };

export const MODIFICATIONS: ModificationDef[] = [
  // ---------------------------------------------------------------- projectile
  {
    id: 'pierce',
    name: 'Pierce',
    description: 'Projectiles hit 1 more enemy before vanishing and deal 15% more damage.',
    icon: 'icon_mod_pierce',
    tags: ['projectile'],
    levels: [pierce, pierce, pierce, pierce, pierce],
  },
  {
    id: 'split',
    name: 'Splits',
    description: 'Projectiles split into 2 when they hit an enemy. The new ones cannot split again.',
    icon: 'icon_mod_split',
    tags: ['projectile'],
    levels: [
      { text: 'Splits into 2 projectiles.', set: { split: 2 } },
      { text: 'Splits into 3 projectiles.', set: { split: 3 } },
      { text: 'Splits into 4 projectiles.', set: { split: 4 } },
      { text: 'Splits into 5 projectiles.', set: { split: 5 } },
      { text: 'Projectiles can split an additional time.', set: { splitDepth: 2 } },
    ],
  },
  {
    id: 'chain',
    name: 'Chain',
    description: 'Once a projectile has used up its pierce, it bounces to a nearby enemy (+1 bounce).',
    icon: 'icon_mod_chain',
    tags: ['projectile'],
    levels: [chain, chain, chain, chain, chain],
  },
  {
    id: 'more_projectiles',
    name: 'Additional Projectiles',
    description: 'Projectile weapons fire 1 more projectile each time they are used.',
    icon: 'icon_mod_projectiles',
    tags: ['projectile'],
    levels: [moreProjectiles, moreProjectiles, moreProjectiles, moreProjectiles, moreProjectiles],
  },
  // ---------------------------------------------------------------- area
  {
    id: 'more_area',
    name: 'Increased AoE',
    description: `Area weapons cover ${Math.round(moreArea.add.area * 100)}% more area.`,
    icon: 'icon_mod_more_area',
    tags: ['aoe'],
    levels: [moreArea, moreArea, moreArea, moreArea, moreArea],
  },
  {
    id: 'less_area',
    name: 'Reduced AoE',
    description: 'Area weapons cover 10% less area but deal 18% more damage.',
    icon: 'icon_mod_less_area',
    tags: ['aoe'],
    levels: [lessArea, lessArea, lessArea, lessArea, lessArea],
  },
  {
    id: 'echo',
    name: 'Echo Strike',
    description: 'Every enemy an area weapon hits sends out an echo dealing 20% of that damage around it, itself included.',
    icon: 'icon_mod_echo',
    tags: ['aoe'],
    levels: [
      { text: 'Echoes deal 20% of the damage.', set: { echo: 0.2 } },
      { text: 'Echoes deal 25% of the damage.', set: { echo: 0.25 } },
      { text: 'Echoes deal 30% of the damage.', set: { echo: 0.3 } },
      { text: 'Echoes deal 30%. +15% echo area.', set: { echo: 0.3, echoArea: 0.15 } },
      { text: `Echoes deal 30% and go off twice, ${ECHO_GAP}s apart.`, set: { echo: 0.3, echoRepeats: 2 } },
    ],
  },
  // ---------------------------------------------------------------- duration
  {
    id: 'more_duration',
    name: 'Increase Duration',
    description: 'Effects of duration weapons last 20% longer.',
    icon: 'icon_mod_more_duration',
    tags: ['duration'],
    levels: [moreDuration, moreDuration, moreDuration, moreDuration, moreDuration],
  },
  {
    id: 'less_duration',
    name: 'Less Duration',
    description: 'Effects of duration weapons last 10% shorter, but the weapons deal 20% more damage.',
    icon: 'icon_mod_less_duration',
    tags: ['duration'],
    levels: [lessDuration, lessDuration, lessDuration, lessDuration, lessDuration],
  },
  {
    id: 'reiterate',
    name: 'Reiterate',
    description: 'Effects of duration weapons have a 20% chance to copy themselves whenever they deal damage or are applied.',
    icon: 'icon_mod_reiterate',
    tags: ['duration'],
    levels: [
      { text: '20% chance to reiterate.', set: { reiterate: 0.2 } },
      { text: '25% chance to reiterate.', set: { reiterate: 0.25 } },
      { text: '33% chance to reiterate.', set: { reiterate: 0.33 } },
      { text: '50% chance to reiterate.', set: { reiterate: 0.5 } },
      { text: '75% chance to reiterate.', set: { reiterate: 0.75 } },
    ],
  },
];
