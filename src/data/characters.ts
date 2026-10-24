import type { CharacterDef } from './types';

/**
 * Playable characters (members of the Cle Cellar Discord server). Each has its own weapon kit and
 * ultimate; items, base stats and everything else are shared.
 */
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'rsncle',
    name: 'rsncle',
    title: 'THE BANANA MONKEY',
    description: 'Throws bananas, lashes its tail and howls at the night.',
    anim: 'monkey',
    firstFrame: 'monkey_idle_0',
    startingWeapon: 'banana',
    weapons: ['banana', 'tail', 'coconut', 'howl'],
    ultimate: 'banana_storm',
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
  },
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;
