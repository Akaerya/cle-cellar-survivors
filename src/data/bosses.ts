import type { EnemyDef, HazardDef } from './types';

/**
 * Seconds into the run a boss arrives. Each run picks this many different bosses at random from BOSSES
 * (seeded, so the same seed meets the same bosses). A boss due at or after the end of the run (15:00)
 * holds dawn back: the run is won only once it is defeated.
 */
export const BOSS_TIMES = [5 * 60, 10 * 60, 15 * 60];

/** Bosses: enemies with a big HP bar and skills. HP scales with time and players like every enemy. */
export const BOSSES: EnemyDef[] = [
  {
    id: 'broodmother',
    name: 'Broodmother',
    hp: 2500,
    speed: 85,
    damage: 25,
    exp: 150,
    radius: 18,
    anim: 'spider-crawl',
    firstFrame: 'spider_0',
    firstMinute: 5,
    knockbackResist: 1,
    puffColor: 0x8a68b8,
    shadow: 'shadow_xl',
    hover: 0,
    potionChance: 1,
    scale: 2,
    mass: 40,
    boss: {
      title: 'THE MANY-EYED',
      description: 'A giant spider, faster than the other bosses. It spits webs on the ground that slow you to a crawl.',
      color: 0x8a68b8,
      skills: [{ kind: 'webs', cooldown: 3.5, count: 3, range: 150, lifetime: 20 }],
    },
  },
  {
    id: 'corpse_bloom',
    name: 'Corpse Bloom',
    hp: 3000,
    speed: 35,
    damage: 25,
    exp: 150,
    radius: 20,
    anim: 'bloomboss-sway',
    firstFrame: 'bloomboss_0',
    firstMinute: 5,
    knockbackResist: 1,
    puffColor: 0xff5a66,
    shadow: 'shadow_xl',
    hover: 0,
    potionChance: 1,
    scale: 2,
    mass: 40,
    boss: {
      title: 'THE HUNGRY FLOWER',
      description: 'A carnivorous flower. It grows sprouts around itself that spit petals, and puffs out pollen clouds that follow you.',
      color: 0xff5a66,
      skills: [
        { kind: 'summon', cooldown: 10, count: 3, max: 6, minion: 'bloom_sprout', distance: 56 },
        { kind: 'pollen', cooldown: 6, count: 2, speed: 38, lifetime: 9, damage: 8 },
      ],
    },
  },
  {
    id: 'leviathan',
    name: 'Leviathan',
    hp: 3500,
    speed: 45,
    damage: 30,
    exp: 150,
    radius: 20,
    anim: 'leviathan-swim',
    firstFrame: 'leviathan_0',
    firstMinute: 5,
    knockbackResist: 1,
    puffColor: 0x57c8d8,
    shadow: 'shadow_xl',
    hover: 0,
    potionChance: 1,
    scale: 2,
    mass: 40,
    boss: {
      title: 'TERROR OF THE DEEP',
      description: 'A sea monster. It charges up a water beam at you, and opens whirlpools around the map.',
      color: 0x57c8d8,
      skills: [
        { kind: 'beam', cooldown: 7, charge: 1.4, length: 420, width: 22, duration: 0.5, damage: 30, color: 0x57c8d8 },
        { kind: 'whirlpools', cooldown: 9, count: 4, range: 240, lifetime: 10, damage: 6 },
      ],
    },
  },
  {
    id: 'cyclops',
    name: 'Cyclops',
    hp: 4000,
    speed: 40,
    damage: 35,
    exp: 150,
    radius: 20,
    anim: 'cyclops-stomp',
    firstFrame: 'cyclops_0',
    firstMinute: 5,
    knockbackResist: 1,
    puffColor: 0xb47c44,
    shadow: 'shadow_xl',
    hover: 0,
    potionChance: 1,
    scale: 2,
    mass: 40,
    boss: {
      title: 'THE ONE-EYED',
      description: 'A giant with a big club. It slams the ground for a shockwave that rolls outward, and throws clubs that come back.',
      color: 0xf0b030,
      skills: [
        { kind: 'slam', cooldown: 6, windup: 0.8, radius: 210, duration: 0.8, damage: 28, band: 14 },
        { kind: 'clubs', cooldown: 8, count: 6, speed: 95, outTime: 1.8, damage: 15, lifetime: 6 },
      ],
    },
  },
];

/** Enemies that only bosses bring (never in the wave mix). */
export const MINIONS: EnemyDef[] = [
  {
    id: 'bloom_sprout',
    name: 'Bloom Sprout',
    hp: 40,
    speed: 0,
    damage: 8,
    exp: 3,
    radius: 7,
    anim: 'sprout-sway',
    firstFrame: 'sprout_0',
    firstMinute: 5,
    knockbackResist: 1,
    puffColor: 0xffc8cc,
    shadow: 'shadow_s',
    hover: 0,
    potionChance: 0,
    shooter: { interval: 2.4, range: 260, hazard: 'petal', speed: 70, damage: 10, lifetime: 5 },
  },
];

export const HAZARDS: HazardDef[] = [
  { id: 'web', frame: 'web', radius: 26, artRadius: 13, ground: true, fade: 3, slow: 0.65 },
  { id: 'pollen', frame: 'pollen_0', anim: 'pollen-drift', radius: 24, artRadius: 11, ground: false, fade: 1.5 },
  { id: 'whirlpool', frame: 'whirlpool', radius: 30, artRadius: 13, spin: -4, ground: true, fade: 1 },
  { id: 'petal', frame: 'petal', radius: 5, artRadius: 4, spin: 6, ground: false },
  { id: 'club', frame: 'club', radius: 9, artRadius: 7, spin: 9, ground: false },
];
