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
/** Chain: speed of a projectile after it bounces, as a multiple of its weapon's speed (1 = unchanged), before Chain's own speed bonus. */
export const CHAIN_SPEED = 1.9;
/** Echo Strike: radius (px) of each echo before AREA, area modifications and Echo Strike's own area bonus. */
export const ECHO_RADIUS = 20;
/** Echo Strike: seconds between echoes when an echo goes off more than once. */
export const ECHO_GAP = 0.2;
/** Multistrike: seconds between an attack and its repeats (weapons with their own `repeatDelay` use that). */
export const MULTISTRIKE_GAP = 0.15;
/** Stun: seconds a stun lasts before the bonus for the share of max HP the hit took. */
export const STUN_SECONDS = 0.5;
/** Impact: radius (px) of the splash before AREA and area modifications. */
export const IMPACT_RADIUS = 25;
/** Ruthless: every this many attacks of a weapon, one is ruthless. */
export const RUTHLESS_EVERY = 3;
/** Virulent Chain: how far (px) the stacks of an enemy that died look for enemies to move to. */
export const VIRULENT_RANGE = 120;

const pierce = { text: '+1 pierce, +15% damage.', add: { pierce: 1, damage: 0.15 } };
const moreArea = { text: '+20% area, +5% damage.', add: { area: 0.2, damage: 0.05 } };
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
    description: 'Projectiles split into 2 when they hit an enemy; the new ones deal 15% less damage and cannot split again.',
    icon: 'icon_mod_split',
    tags: ['projectile'],
    levels: [
      { text: 'Splits into 2. Splits deal 15% less damage.', set: { split: 2, splitLess: 0.15 } },
      { text: 'Splits into 3. Splits deal 10% less damage.', set: { split: 3, splitLess: 0.1 } },
      { text: 'Splits into 4. Splits deal 8% less damage.', set: { split: 4, splitLess: 0.08 } },
      { text: 'Splits into 5. Splits deal 5% less damage.', set: { split: 5, splitLess: 0.05 } },
      { text: 'Splits have a 20% chance to split again. 5% less damage.', set: { split: 5, splitLess: 0.05, splitAgain: 0.2 } },
    ],
  },
  {
    id: 'chain',
    name: 'Chain',
    description: 'Once a projectile has used up its pierce, it bounces to a nearby enemy (+1 bounce). Each bounce deals 30% less damage.',
    icon: 'icon_mod_chain',
    tags: ['projectile'],
    levels: [
      { text: '+1 bounce. Bounces deal 30% less damage.', set: { chain: 1, chainLess: 0.3 } },
      { text: 'Bounces fly 25% faster and deal 25% less damage.', set: { chain: 1, chainLess: 0.25, chainSpeed: 0.25 } },
      { text: '+1 bounce. Bounces deal 20% less damage.', set: { chain: 2, chainLess: 0.2, chainSpeed: 0.25 } },
      { text: 'Bounces fly 25% faster and deal 15% less damage.', set: { chain: 2, chainLess: 0.15, chainSpeed: 0.5 } },
      { text: '+1 bounce. Bounces deal 10% less damage.', set: { chain: 3, chainLess: 0.1, chainSpeed: 0.5 } },
    ],
  },
  {
    id: 'more_projectiles',
    name: 'Additional Projectiles',
    description: 'Projectile weapons fire 1 more projectile each time they are used, but deal 35% less damage.',
    icon: 'icon_mod_projectiles',
    tags: ['projectile'],
    levels: [
      { text: '+1 projectile. 35% less damage.', set: { projectiles: 1, projectileLess: 0.35 } },
      { text: '+2 projectiles. 30% less damage.', set: { projectiles: 2, projectileLess: 0.3 } },
      { text: '+3 projectiles. 25% less damage.', set: { projectiles: 3, projectileLess: 0.25 } },
      { text: '+4 projectiles. 20% less damage.', set: { projectiles: 4, projectileLess: 0.2 } },
      { text: '+5 projectiles. 15% less damage.', set: { projectiles: 5, projectileLess: 0.15 } },
    ],
  },
  // ---------------------------------------------------------------- area
  {
    id: 'more_area',
    name: 'Increased AoE',
    description: `Area weapons cover ${Math.round(moreArea.add.area * 100)}% more area and deal ${Math.round(moreArea.add.damage * 100)}% more damage.`,
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
  // ---------------------------------------------------------------- melee
  {
    id: 'multistrike',
    name: 'Multistrike',
    description: 'Melee weapons attack 1 more time each time they are used, and any attack has a 10% chance to be repeated.',
    icon: 'icon_mod_multistrike',
    tags: ['melee'],
    levels: [
      { text: 'Attacks 1 more time. 10% chance to repeat.', set: { multistrike: 1, repeatChance: 0.1 } },
      { text: '15% chance to repeat.', set: { multistrike: 1, repeatChance: 0.15 } },
      { text: 'Attacks 1 more time. 20% chance to repeat.', set: { multistrike: 2, repeatChance: 0.2 } },
      { text: '25% chance to repeat.', set: { multistrike: 2, repeatChance: 0.25 } },
      { text: 'Attacks 1 more time. 33% chance to repeat.', set: { multistrike: 3, repeatChance: 0.33 } },
    ],
  },
  {
    id: 'stun',
    name: 'Stun',
    description: 'Melee hits have a 20% chance to stun the enemy. Stunned enemies stand still and take 10% more damage.',
    icon: 'icon_mod_stun',
    tags: ['melee'],
    levels: [
      { text: '20% chance to stun. Stunned take 10% more damage.', set: { stunChance: 0.2, stunBonus: 0.1 } },
      { text: '+5% stun chance. Stunned take 15% more damage.', set: { stunChance: 0.25, stunBonus: 0.15 } },
      { text: '+5% stun chance. Stunned take 20% more damage.', set: { stunChance: 0.3, stunBonus: 0.2 } },
      { text: '+5% stun chance. Stunned take 25% more damage.', set: { stunChance: 0.35, stunBonus: 0.25 } },
      { text: '+5% stun chance. Stunned take 30% more damage.', set: { stunChance: 0.4, stunBonus: 0.3 } },
    ],
  },
  {
    id: 'momentum',
    name: 'Momentum',
    description: 'Melee hits deal bonus damage equal to 3% of your current move speed (none while standing still).',
    icon: 'icon_mod_momentum',
    tags: ['melee'],
    levels: [
      { text: '3% of move speed as bonus damage.', set: { momentum: 0.03 } },
      { text: '4% of move speed as bonus damage.', set: { momentum: 0.04 } },
      { text: '5% of move speed as bonus damage.', set: { momentum: 0.05 } },
      { text: '6% of move speed as bonus damage.', set: { momentum: 0.06 } },
      { text: '8% of move speed as bonus damage.', set: { momentum: 0.08 } },
    ],
  },
  {
    id: 'impact',
    name: 'Impact',
    description: `Melee hits also splash around every enemy hit (${IMPACT_RADIUS} px) for 70% less damage. Melee weapons can then take AoE modifications, which change the splash.`,
    icon: 'icon_mod_impact',
    tags: ['melee'],
    levels: [
      { text: 'Splash deals 70% less than the hit.', set: { impact: 0.3 } },
      { text: 'Splash deals 60% less than the hit.', set: { impact: 0.4 } },
      { text: 'Splash deals 50% less than the hit.', set: { impact: 0.5 } },
      { text: 'Splash deals 40% less than the hit.', set: { impact: 0.6 } },
      { text: 'Splash deals 30% less than the hit.', set: { impact: 0.7 } },
    ],
  },
  {
    id: 'ruthless',
    name: 'Ruthless',
    description: 'Every third attack of a melee weapon deals 30% more damage.',
    icon: 'icon_mod_ruthless',
    tags: ['melee'],
    levels: [
      { text: 'Every 3rd attack: +30% damage.', set: { ruthless: 0.3 } },
      { text: 'Every 3rd attack: +40% damage.', set: { ruthless: 0.4 } },
      { text: 'Every 3rd attack: +50% damage.', set: { ruthless: 0.5 } },
      { text: 'Every 3rd attack: +60% damage.', set: { ruthless: 0.6 } },
      { text: 'Every 3rd attack: +70% damage.', set: { ruthless: 0.7 } },
    ],
  },
  // ---------------------------------------------------------------- damage over time
  {
    id: 'deadly_ailments',
    name: 'Deadly Ailments',
    description: 'Damage-over-time weapons deal 40% less damage on hit, but your damage over time deals 30% more.',
    icon: 'icon_mod_deadly',
    tags: ['dot'],
    levels: [0.3, 0.4, 0.5, 0.6, 0.7].map((d) => ({
      text: `40% less damage on hit. +${Math.round(d * 100)}% damage over time.`,
      set: { hitLess: 0.4, dotDamage: d },
    })),
  },
  {
    id: 'sadism',
    name: 'Sadism',
    description: 'Damage over time ticks 20% sooner (it lasts as long) and deals 10% more damage.',
    icon: 'icon_mod_sadism',
    tags: ['dot'],
    levels: [0.2, 0.25, 0.33, 0.5, 0.6].map((r, i) => ({
      text: `Ticks ${Math.round(r * 100)}% sooner. +10% damage over time.`,
      set: { dotRate: r, dotDamage: 0.1 * (i + 1) },
    })),
  },
  {
    id: 'virulent_chain',
    name: 'Virulent Chain',
    description: `When an enemy dies, each of its damage-over-time stacks moves to the closest enemy within ${VIRULENT_RANGE} px with the time it has left. Damage over time deals 20% less.`,
    icon: 'icon_mod_virulent',
    tags: ['dot'],
    levels: [
      { text: 'Stacks move on. 20% less damage over time.', set: { virulent: 1, dotLess: 0.2 } },
      { text: 'Stacks last 5% longer. 20% less damage over time.', set: { virulent: 1, dotLess: 0.2, dotDuration: 0.05 } },
      { text: 'Stacks last 10% longer. 20% less damage over time.', set: { virulent: 1, dotLess: 0.2, dotDuration: 0.1 } },
      { text: 'Stacks last 15% longer. 20% less damage over time.', set: { virulent: 1, dotLess: 0.2, dotDuration: 0.15 } },
      { text: 'Stacks last 20% longer and are copied to 2 enemies. 20% less damage over time.', set: { virulent: 2, dotLess: 0.2, dotDuration: 0.2 } },
    ],
  },
];
