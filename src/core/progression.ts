import { BASE_STATS } from '../data/player';
import type { ItemDef, PlayerStats, StatKey, WeaponDef, WeaponStats } from '../data/types';

/** EXP needed to go from `level` to `level + 1`. */
export function expToNext(level: number): number {
  if (level <= 20) return 5 + 10 * (level - 1);
  return 5 + 10 * 19 + 13 * (level - 20);
}

/** Weapon stats at a given level (1..5), built from the level-1 stats and the per-level changes. */
export function weaponStatsAt(def: WeaponDef, level: number): WeaponStats {
  const s: WeaponStats = { ...def.stats };
  const steps = Math.min(level - 1, def.levels.length);
  for (let i = 0; i < steps; i++) {
    const lv = def.levels[i];
    if (lv.add) for (const k in lv.add) (s as any)[k] += (lv.add as any)[k];
    if (lv.mul) for (const k in lv.mul) (s as any)[k] *= (lv.mul as any)[k];
    if (lv.set) Object.assign(s, lv.set);
  }
  return s;
}

export interface OwnedItem {
  def: ItemDef;
  level: number;
}

const STAT_KEYS = Object.keys(BASE_STATS) as StatKey[];

/** Player stats = (base + flat) x (1 + percent), summed over every owned item level. */
export function computeStats(items: OwnedItem[]): PlayerStats {
  const flat: Record<string, number> = {};
  const pct: Record<string, number> = {};
  for (const k of STAT_KEYS) {
    flat[k] = 0;
    pct[k] = 0;
  }
  for (const it of items) {
    for (const m of it.def.perLevel) {
      flat[m.stat] += (m.flat ?? 0) * it.level;
      pct[m.stat] += (m.percent ?? 0) * it.level;
    }
  }
  const out = { ...BASE_STATS };
  for (const k of STAT_KEYS) {
    out[k] = (BASE_STATS[k] + flat[k]) * (1 + pct[k]);
  }
  out.cooldownMult = Math.max(0.1, out.cooldownMult);
  out.maxHp = Math.max(1, Math.round(out.maxHp));
  return out;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}
