import { MAX_LEVEL } from '../constants';
import { BASE_STATS } from '../data/player';
import type { ItemDef, ModEffect, ModificationDef, ModKey, NumericWeaponStat, PlayerStats, StatKey, WeaponDef, WeaponStats } from '../data/types';

/** EXP needed to go from `level` to `level + 1`. */
export function expToNext(level: number): number {
  if (level <= 20) return 5 + 10 * (level - 1);
  return 5 + 10 * 19 + 13 * (level - 20);
}

/** A weapon at one level, with its percent bonuses kept apart so they can add up with other bonuses. */
export interface WeaponLevelStats {
  /** Level-1 stats plus every flat change (`add`, `set`) up to this level. */
  base: WeaponStats;
  /** Percent bonuses summed over levels, by stat (0.6 = +60% of the base value). */
  pct: Partial<Record<NumericWeaponStat, number>>;
  /** Attack-rate bonus summed over levels (1.6 = 160% faster: cooldown / 2.6). */
  faster: number;
}

/** Sums a weapon's level changes up to `level` (1..5). Percents add up; nothing multiplies. */
export function weaponLevelAt(def: WeaponDef, level: number): WeaponLevelStats {
  const base: WeaponStats = { ...def.stats };
  const o = base as unknown as Record<string, number>;
  const pct: Partial<Record<NumericWeaponStat, number>> = {};
  let faster = 0;
  const steps = Math.min(level - 1, def.levels.length);
  for (let i = 0; i < steps; i++) {
    const lv = def.levels[i];
    // Optional stats (repeat, reduction) count as 0 until a level gives them a value.
    if (lv.add) for (const [k, v] of Object.entries(lv.add)) o[k] = (o[k] ?? 0) + v;
    if (lv.pct) for (const [k, v] of Object.entries(lv.pct)) pct[k as NumericWeaponStat] = (pct[k as NumericWeaponStat] ?? 0) + v;
    if (lv.faster) faster += lv.faster;
    if (lv.set) Object.assign(base, lv.set);
  }
  return { base, pct, faster };
}

/** The stats of one level with its own bonuses applied: base x (1 + percent), cooldown / (1 + faster). */
export function applyLevelBonuses(l: WeaponLevelStats): WeaponStats {
  const s: WeaponStats = { ...l.base };
  const o = s as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(l.pct)) o[k] = (o[k] ?? 0) * (1 + v);
  s.cooldown = s.cooldown / (1 + l.faster);
  return s;
}

/** Weapon stats at a given level (1..5), before the owner's stats and modifications (what the wiki shows). */
export function weaponStatsAt(def: WeaponDef, level: number): WeaponStats {
  return applyLevelBonuses(weaponLevelAt(def, level));
}

/** Card text for reaching `level`: the description for a new weapon, else that level's change. */
export function weaponLevelText(def: WeaponDef, level: number): string {
  if (level <= 1) return def.description;
  return def.levels[level - 2]?.text ?? '';
}

/** Every modification number, all 0. */
export function emptyModEffect(): Required<ModEffect> {
  return {
    pierce: 0,
    projectiles: 0,
    damage: 0,
    split: 0,
    splitDepth: 0,
    chain: 0,
    area: 0,
    echo: 0,
    echoArea: 0,
    echoRepeats: 0,
    duration: 0,
    reiterate: 0,
  };
}

/** A modification's totals at `level`: each level's `add` is summed, its `set` replaces. */
export function modEffectAt(def: ModificationDef, level: number): Required<ModEffect> {
  const out = emptyModEffect();
  const steps = Math.min(level, def.levels.length);
  for (let i = 0; i < steps; i++) {
    const lv = def.levels[i];
    if (lv.add) for (const [k, v] of Object.entries(lv.add)) out[k as ModKey] += v;
    if (lv.set) Object.assign(out, lv.set);
  }
  return out;
}

export interface OwnedMod {
  def: ModificationDef;
  level: number;
}

/** Totals of every owned modification that shares at least one tag with the weapon. */
export function modsForWeapon(def: WeaponDef, mods: OwnedMod[]): Required<ModEffect> {
  const out = emptyModEffect();
  const tags = def.tags ?? [];
  for (const m of mods) {
    if (!m.def.tags.some((t) => tags.includes(t))) continue;
    const e = modEffectAt(m.def, m.level);
    for (const k in out) out[k as ModKey] += e[k as ModKey];
  }
  return out;
}

/** Multiplier on cooldowns from Ability Haste: 100 / (100 + haste), i.e. haste / (100 + haste) shorter. */
export function hasteFactor(haste: number): number {
  return 100 / (100 + Math.max(0, haste));
}

/** Highest level an item or powerup can reach. */
export function itemMaxLevel(def: ItemDef): number {
  return def.maxLevel ?? MAX_LEVEL;
}

export interface OwnedItem {
  def: ItemDef;
  level: number;
}

const STAT_KEYS = Object.keys(BASE_STATS) as StatKey[];

/** Player stats = (base + flat) x (1 + percent), summed over every owned item and powerup level. */
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
  out.damageTaken = Math.max(0, out.damageTaken);
  out.maxHp = Math.max(1, Math.round(out.maxHp));
  return out;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}
