import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { WEAPONS } from './weapons';
import type { EnemyDef, ItemDef, WeaponDef } from './types';

export * from './types';
export { ENEMIES } from './enemies';
export { ITEMS } from './items';
export { WEAPONS } from './weapons';
export { WAVES, WAVE_EVENTS, waveForMinute, hpScaleForMinute, hpScaleForPlayers } from './waves';
export { BASE_STATS, PLAYER_RADIUS, STARTING_WEAPON } from './player';

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((e) => [e.id, e]));

const weaponMap = byId(WEAPONS);
const itemMap = byId(ITEMS);
const enemyMap = byId(ENEMIES);

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
