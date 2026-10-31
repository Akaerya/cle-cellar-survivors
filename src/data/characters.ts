import type { CharacterDef } from './types';

/**
 * Playable characters (members of the Cle Cellar Discord server). Each has its own weapon kit, ultimate and
 * passive; items, base stats and everything else are shared.
 */
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'rsncle',
    name: 'cle',
    title: 'THE BANANA MONKEY',
    description: 'Throws bananas, lashes its tail and howls at the night.',
    anim: 'monkey',
    firstFrame: 'monkey_idle_0',
    startingWeapon: 'banana',
    weapons: ['banana', 'tail', 'coconut', 'howl'],
    ultimate: 'banana_storm',
    passive: 'ragebaiter',
  },
  {
    id: 'yookers',
    name: 'yookers',
    title: 'THE STORM KNIGHT',
    description: 'A paladin of the storm. Stabs with a sword and calls lightning down on the horde.',
    anim: 'knight',
    firstFrame: 'knight_idle_0',
    startingWeapon: 'stormblade',
    weapons: ['stormblade', 'thunder_breath', 'thunderstrike', 'storm_shield'],
    ultimate: 'storm_drake',
    passive: 'dragonborn',
  },
  {
    id: 'elysia',
    name: 'yuko',
    title: 'ARROW OF NOVAE',
    description: "'I'm a girl as gorgeous as dancing petals!'",
    anim: 'elysia',
    firstFrame: 'elysia_idle_0',
    startingWeapon: 'hailing_arrows',
    weapons: ['hailing_arrows', 'crystalline_bloom', 'infinite_helix', 'original_pristinity'],
    ultimate: 'beginning_you_and_i',
    passive: 'death_defied',
  },
  {
    id: 'zorus',
    name: 'zorus',
    title: 'WEEBLORD',
    description: "'Nothing personal, Cle.'",
    anim: 'zorus',
    firstFrame: 'zorus_idle_0',
    startingWeapon: 'iaijutsu',
    weapons: ['iaijutsu', 'blade_flurry', 'flicker_strike', 'unstable_infusion'],
    ultimate: 'mistwalker',
    passive: 'shroud',
  },
  {
    id: 'rabbit',
    name: 'rabbit',
    title: 'THE BUNNY CONJURER',
    description: 'Never fights alone: a warren of hardhat bunnies does the heavy lifting.',
    anim: 'rabbit',
    firstFrame: 'rabbit_idle_0',
    startingWeapon: 'arcane_bolt',
    weapons: ['arcane_bolt', 'carrot_sword', 'carrot_rations', 'bunny_armory'],
    ultimate: 'giant_bunny',
    passive: 'warren',
  },
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;
