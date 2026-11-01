import type { CurioDef, CurioTierDef, WeaponDef, WeaponStats, WeaponTag } from './types';
import { NO_STATS } from './weapons';

/**
 * Curios: every CURIO_EVERY levels, right after that level's card, each player picks one of three curios. A curio is
 * kept for the run and is never offered again once owned. Curios do niche, build-defining things; what each does is
 * in systems/Curios.ts. Each of the three cards rolls its tier by CURIO_TIERS (a tier with nothing left to offer
 * passes its chance on to the others).
 */

/** A curio pick comes every this many levels (8, 16, 24, ...). */
export const CURIO_EVERY = 8;

export const CURIO_TIERS: CurioTierDef[] = [
  { tier: 0, chance: 0.03, color: 0xf7d84a, icon: 'icon_curio_t0' },
  { tier: 1, chance: 0.08, color: 0xb46bff, icon: 'icon_curio_t1' },
  { tier: 2, chance: 0.39, color: 0x5aa8ff, icon: 'icon_curio_t2' },
  { tier: 3, chance: 0.5, color: 0x9de08a, icon: 'icon_curio_t3' },
];

/** Cards offered per curio pick. */
export const CURIO_CHOICES = 3;

/**
 * Damage curios deal goes through a weapon definition of its own, so modifications with the curio's tags change it
 * and the party screen counts it. Only the stats a curio uses matter.
 */
function attack(id: string, name: string, stats: Partial<WeaponStats>, more: Partial<WeaponDef> = {}): WeaponDef {
  return {
    id: `curio_${id}`,
    name,
    description: '',
    icon: 'icon_curio_t3',
    targeting: 'passive',
    stats: { ...NO_STATS, ...stats },
    levels: [],
    ...more,
  };
}

const AOE_DURATION: WeaponTag[] = ['aoe', 'duration'];

export const CURIOS: CurioDef[] = [
  // ---------------------------------------------------------------- tier 0
  { id: 'headhunter', name: 'Headhunter', tier: 0, duration: 20, attack: attack('headhunter', 'Headhunter', {}) },
  { id: 'original_sin', name: 'Original Sin', tier: 0, share: 1.5, attack: attack('original_sin', 'Original Sin', {}) },
  {
    id: 'shadows_and_dust',
    name: 'Shadows and Dust',
    tier: 0,
    tags: AOE_DURATION,
    speed: 0.0005,
    damage: 0.001,
    novaAt: 100,
    nova: attack(
      'rampage_nova',
      'Rampage Spears',
      { damage: 30, projectileCount: 16, speed: 260, pierce: Infinity, lifetime: 1.4, size: 5, knockback: 4 },
      { targeting: 'random', projectileAnim: 'spear-glint', artRadius: 5, orient: true, tags: AOE_DURATION, damageTags: ['aoe'] },
    ),
    pulseAt: 300,
    pulse: attack('rampage_pulse', 'Rampage Pulse', { damage: 30, size: 130, knockback: 10 }, { tags: AOE_DURATION, color: 0xb8a0ff }),
    cycloneAt: 600,
    cyclone: {
      speed: 1.5,
      max: 24,
      attack: attack('rampage_cyclone', 'Rampage Cyclone', { damage: 10, cooldown: 0.5, size: 15, lifetime: 10 }, { tags: AOE_DURATION, color: 0xd8d0ff }),
    },
  },
  { id: 'suffering_mass', name: 'Suffering Mass', tier: 0, base: 200, delay: 8, regen: 0.2 },
  { id: 'chronobreak', name: 'Chronobreak', tier: 0, cooldown: 0.75, cost: 0.01, damage: 1.2 },
  { id: 'resonance_dynamo', name: 'Resonance Dynamo', tier: 0, tags: ['projectile'] },
  {
    id: 'martyrs_crown',
    name: "Martyr's Crown",
    tier: 0,
    tags: ['aoe'],
    store: 2,
    window: 4,
    triggers: 3,
    mult: 5,
    attack: attack('martyrs_crown', "Martyr's Crown", { size: 75 }, { tags: ['aoe'], color: 0xffd27a }),
  },

  // ---------------------------------------------------------------- tier 1
  { id: 'bloodrush', name: 'Bloodrush', tier: 1, per: 300, damage: 0.005 },
  { id: 'inspired_learning', name: 'Inspired Learning', tier: 1, need: 4, maxTier: 1, duration: 8, attack: attack('inspired_learning', 'Inspired Learning', {}) },
  { id: 'aegis_aurora', name: 'Aegis Aurora', tier: 1, mitigation: 0.2, shield: 1.5, duration: 2, max: 3 },
  { id: 'kraken_slayer', name: 'Kraken Slayer', tier: 1, every: 3, missing: 1, attack: attack('kraken_slayer', 'Kraken Slayer', { damage: 18 }, { color: 0x5ad8c8 }) },
  { id: 'prismatic_violence', name: 'Prismatic Violence', tier: 1, share: 0.2, attack: attack('prismatic_violence', 'Prismatic Violence', { size: 35 }, { color: 0xff8ad8 }) },

  // ---------------------------------------------------------------- tier 2
  { id: 'necrotic_prism', name: 'Necrotic Prism', tier: 2, keep: 0.1, interval: 0.5, attack: attack('necrotic_prism', 'Necrotic Prism', { size: 130 }, { color: 0x8a5ab8 }) },
  {
    id: 'vaporising_catalyst',
    name: 'Vaporising Catalyst',
    tier: 2,
    life: 3,
    slow: 0.3,
    interval: 0.5,
    attack: attack('vaporising_catalyst', 'Vaporising Catalyst', { damage: 6, size: 35 }, { color: 0x8ee04a }),
  },
  {
    id: 'frostfire_brand',
    name: 'Frostfire Brand',
    tier: 2,
    tags: ['dot'],
    slow: 0.15,
    attack: attack('frostfire_brand', 'Frostfire Brand', {}, {
      tags: ['dot'],
      effect: { id: 'burn', name: 'Burn', damage: 4, interval: 0.5, duration: 5, tint: 0xff9a4a },
    }),
  },
  { id: 'gluttons_pouch', name: "Glutton's Pouch", tier: 2, potions: 2, damage: 0.2, duration: 5 },
  { id: 'still_here', name: 'Still Here', tier: 2, damage: 0.01, haste: 1, leech: 0.0025 },
  {
    id: 'clockwork_capacitor',
    name: 'Clockwork Capacitor',
    tier: 2,
    tags: ['aoe'],
    per: 10,
    max: 100,
    bonus: 3,
    attack: attack('clockwork_capacitor', 'Clockwork Capacitor', { size: 40 }, { tags: ['aoe'], color: 0xffe27a }),
  },
  { id: 'the_collector', name: 'The Collector', tier: 2, below: 0.05 },
  { id: 'lone_hero', name: 'Lone Hero', tier: 2, mitigation: 0.01, haste: 1, duration: 4 },

  // ---------------------------------------------------------------- tier 3
  { id: 'jewel_magnet', name: 'Jewel Magnet', tier: 3, icon: 'icon_magnet', stats: [{ stat: 'pickupRadius', percent: 1 }] },
  { id: 'walking_stick', name: "Cle's Walking Stick", tier: 3, speed: 100, delay: 4 },
  { id: 'dumb_luck', name: 'Dumb Luck', tier: 3, crit: 0.05, per: 0.01, window: 3 },
  {
    id: 'statik_shiv',
    name: 'Statik Shiv',
    tier: 3,
    chance: 0.03,
    share: 0.2,
    range: 80,
    targets: 1,
    every: 50,
    more: 0.02,
    max: 10,
    attack: attack('statik_shiv', 'Statik Shiv', {}, { color: 0x9fe4ff }),
  },
  { id: 'heavy_iron', name: 'Heavy Iron', tier: 3, flat: 3 },
  { id: 'whetstone', name: 'Really Bad Whetstone', tier: 3, above: 0.5, damage: 0.1 },
  { id: 'vampirism', name: 'Vampirism', tier: 3, heal: 0.01 },
  { id: 'mirror_shard', name: 'Mirror Shard', tier: 3, share: 0.15, attack: attack('mirror_shard', 'Mirror Shard', {}, { color: 0xd8f0ff }) },
];

/** Every curio's attacks, for ATTACK_DEFS (projectiles) and the party screen. */
export const CURIO_ATTACKS: WeaponDef[] = CURIOS.flatMap((c) => {
  const list: WeaponDef[] = [];
  if ('attack' in c) list.push(c.attack);
  if (c.id === 'shadows_and_dust') list.push(c.nova, c.pulse, c.cyclone.attack);
  return list;
});

// Damage a curio deals is shown under its own icon on the party screen.
for (const c of CURIOS) {
  const icon = c.icon ?? CURIO_TIERS[c.tier].icon;
  if ('attack' in c) c.attack.icon = icon;
  if (c.id === 'shadows_and_dust') for (const a of [c.nova, c.pulse, c.cyclone.attack]) a.icon = icon;
}

const pct = (v: number) => `${+(v * 100).toFixed(2)}%`;
const secs = (v: number) => `${+v.toFixed(2)}S`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'ST' : n % 10 === 2 && n !== 12 ? 'ND' : n % 10 === 3 && n !== 13 ? 'RD' : 'TH'}`;

/**
 * What a curio does, from its numbers: the card text, and (`card` false) the wiki's, which adds what its tags
 * scale. Bitmap fonts have no lowercase, so callers upper-case it.
 */
export function curioText(c: CurioDef, card = false): string {
  const t = textOf(c);
  if (card || !c.tags?.length) return t;
  return `${t} Scales with ${c.tags.map((x) => x.toUpperCase()).join(' and ')} modifications.`;
}

function textOf(c: CurioDef): string {
  switch (c.id) {
    case 'headhunter':
      return `Killing a rare enemy steals all its modifiers: they work for you for ${secs(c.duration)} each. The same one stolen twice stacks.`;
    case 'original_sin':
      return `A kill sends ${pct(c.share)} of the overkill damage to the enemy closest to it. Kills from that carry on.`;
    case 'shadows_and_dust':
      return `Rampage: each kill is a stack (+${pct(c.speed)} move speed, +${pct(c.damage)} damage). Taking damage ends it. ${c.novaAt}: a nova of spears. ${c.pulseAt}: a ${c.pulse.stats.size} px pulse. ${c.cycloneAt}: a cyclone that multiplies with its kills.`;
    case 'suffering_mass':
      return `Max HP is locked to 1. Fleeting Fantasy (${c.base}, raised by max HP bonuses) takes damage first and gets all healing and regen. After ${secs(c.delay)} unhurt it refills ${pct(c.regen)} a second.`;
    case 'chronobreak':
      return `Every weapon's base cooldown is ${secs(c.cooldown)} (not the ultimate). Each use costs ${pct(c.cost)} of max HP. +${c.damage}% damage per 1% of HP missing.`;
    case 'resonance_dynamo':
      return 'Your projectiles fly back to you at the edge of the screen or the end of their flight, piercing every enemy, without splitting or chaining. Full damage.';
    case 'martyrs_crown':
      return `Damage taken is stored ×${c.store} for ${secs(c.window)}. The ${ordinal(c.triggers)} hit in that time unleashes ×${c.mult} of all of it on everything within ${c.attack.stats.size} px.`;
    case 'bloodrush':
      return `Every ${c.per} HP you restore: +${pct(c.damage)} damage for the rest of the run.`;
    case 'inspired_learning':
      return `With ${c.need} other curios of tier ${c.maxTier} or rarer, killing a rare enemy steals one of its modifiers for ${secs(c.duration)}.`;
    case 'aegis_aurora':
      return `${pct(c.mitigation)} less damage taken. Taking damage gives a ${secs(c.duration)} shield worth ${pct(c.shield)} of your damage mitigation (60% mitigation: 90 points), up to ${pct(c.max)} in all.`;
    case 'kraken_slayer':
      return `Every ${ordinal(c.every)} attack of your starting weapon also deals ${c.attack.stats.damage} damage to each enemy it hits, +${c.missing}% per 1% of the enemy's HP missing.`;
    case 'prismatic_violence':
      return `Enemies you kill explode for ${pct(c.share)} of their max HP within ${c.attack.stats.size} px. Those kills explode too.`;
    case 'necrotic_prism':
      return `You keep ${pct(c.keep)} of every heal. The rest hits every enemy within ${c.attack.stats.size} px (summed every ${secs(c.interval)}).`;
    case 'vaporising_catalyst':
      return `Kills leave caustic ground (${c.attack.stats.size} px, ${secs(c.life)}): ${pct(c.slow)} slow and ${c.attack.stats.damage} damage every ${secs(c.interval)} to enemies in it.`;
    case 'frostfire_brand': {
      const b = c.attack.effect!;
      return `Hitting a slowed enemy burns it: ${b.damage} damage every ${secs(b.interval)} for ${secs(b.duration)}. Burning enemies are ${pct(c.slow)} slower.`;
    }
    case 'gluttons_pouch':
      return `Rare enemies you kill drop ${c.potions} health potions, and you deal ${pct(c.damage)} more damage for ${secs(c.duration)}.`;
    case 'still_here':
      return `Per 1% of HP missing, melee weapons get +${pct(c.damage)} damage and +${c.haste} Ability Haste, and heal ${pct(c.leech)} of the damage they deal.`;
    case 'clockwork_capacitor':
      return `Moving builds Static (1 per ${c.per} px). At ${c.max}, your next hit deals +${pct(c.bonus)} damage and explodes on everything within ${c.attack.stats.size} px.`;
    case 'the_collector':
      return `Hitting or hurting an enemy below ${pct(c.below)} of its max HP kills it.`;
    case 'lone_hero':
      return `Each hit taken in the last ${secs(c.duration)}: ${pct(c.mitigation)} less damage taken and +${c.haste} Ability Haste.`;
    case 'jewel_magnet':
      return `EXP gems fly to you from ${pct(c.stats[0].percent ?? 0)} further away.`;
    case 'walking_stick':
      return `+${c.speed} move speed while you have not taken damage for ${secs(c.delay)}.`;
    case 'dumb_luck':
      return `+${pct(c.crit)} critical strike chance, and +${pct(c.per)} more per critical strike in a ${secs(c.window)} streak (all lost when it ends).`;
    case 'statik_shiv':
      return `Hits have ${pct(c.chance)} chance to zap an enemy within ${c.range} px for ${pct(c.share)} of the hit. Every ${c.every} zaps: +${pct(c.more)} chance and +1 target (${c.max} times).`;
    case 'heavy_iron':
      return `All damage you take is ${c.flat} lower, before armor and mitigation.`;
    case 'whetstone':
      return `+${pct(c.damage)} damage to enemies above ${pct(c.above)} of their max HP.`;
    case 'vampirism':
      return `Kills heal ${pct(c.heal)} of your max HP.`;
    case 'mirror_shard':
      return `${pct(c.share)} of every hit you take (before mitigation) is dealt back to the attacker.`;
  }
}
