import { CHARACTERS } from './characters';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { ULTIMATES } from './ultimates';
import { WEAPONS } from './weapons';
import type { CharacterDef, EnemyDef, ItemDef, UltimateDef, WeaponDef } from './types';

export * from './types';
export { ENEMIES } from './enemies';
export { ITEMS } from './items';
export { WEAPONS } from './weapons';
export { WAVES, WAVE_EVENTS, waveForMinute, hpScaleForMinute, hpScaleForPlayers, speedScaleForMinute } from './waves';
export { BASE_STATS, PLAYER_RADIUS } from './player';
export { CHARACTERS, DEFAULT_CHARACTER } from './characters';
export { ULTIMATES } from './ultimates';

/**
 * Everything that can fire a projectile: weapons, then ultimate attacks. A projectile's index in this
 * list is how snapshots tell joiners which art to draw.
 */
export const ATTACK_DEFS: WeaponDef[] = [...WEAPONS, ...ULTIMATES.map((u) => u.attack)];

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((e) => [e.id, e]));

const weaponMap = byId(WEAPONS);
const itemMap = byId(ITEMS);
const enemyMap = byId(ENEMIES);
const characterMap = byId(CHARACTERS);
const ultimateMap = byId(ULTIMATES);

export function weaponDef(id: string): WeaponDef {
  const d = weaponMap.get(id);
  if (!d) throw new Error(`Unknown weapon ${id}`);
  return d;
}

export function itemDef(id: string): ItemDef {
  const d = itemMap.get(id);
  if (!d) throw new Error(`Unknown item ${id}`);
  return d;
}

export function enemyDef(id: string): EnemyDef {
  const d = enemyMap.get(id);
  if (!d) throw new Error(`Unknown enemy ${id}`);
  return d;
}
/** Unknown ids (an old profile, a newer client) fall back to the first character. */
export function characterDef(id: string | undefined): CharacterDef {
  return (id && characterMap.get(id)) || CHARACTERS[0];
}

export function ultimateDef(id: string): UltimateDef {
  const d = ultimateMap.get(id);
  if (!d) throw new Error(`Unknown ultimate ${id}`);
  return d;
}

export { POTION, GEM_TIERS } from './drops';
export { REVIVE, reviveHpPercent } from './coop';
