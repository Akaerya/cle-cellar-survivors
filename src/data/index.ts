import { BOSSES, BOSS_HAZARDS, MINIONS } from './bosses';
import { CHARACTERS } from './characters';
import { ENEMIES } from './enemies';
import { ENEMY_MODIFIERS, RARE_HAZARDS } from './enemyModifiers';
import { CURIOS, CURIO_ATTACKS } from './curios';
import { MODIFICATIONS } from './modifications';
import { PASSIVES } from './passives';
import { POWERUPS } from './powerups';
import { ULTIMATES } from './ultimates';
import { WEAPONS } from './weapons';
import type { CharacterDef, EnemyDef, EnemyModifierDef, CurioDef, CurioId, EnemyModifierId, HazardDef, ModificationDef, PassiveDef, PowerupDef, UltimateDef, WeaponDef } from './types';

export * from './types';
export { ENEMIES } from './enemies';
export { BOSSES, BOSS_TIMES, MINIONS } from './bosses';
export { ENEMY_MODIFIERS, RARE_TIERS, RARE_HP_PER_MODIFIER, ASTRAL_CHAINS, MAX_SOUL_WISPS } from './enemyModifiers';

/** Everything left in the world that touches players: boss hazards, then rare enemies' ones. Snapshots send the index. */
export const HAZARDS: HazardDef[] = [...BOSS_HAZARDS, ...RARE_HAZARDS];

/**
 * Every enemy kind: the wave enemies, boss minions, then bosses. An enemy's index in this list is how
 * snapshots tell joiners which art to draw.
 */
export const ALL_ENEMIES: EnemyDef[] = [...ENEMIES, ...MINIONS, ...BOSSES];
export { CURIOS, CURIO_TIERS, CURIO_EVERY, CURIO_CHOICES, CURIO_ATTACKS, curioText } from './curios';
export {
  MODIFICATIONS,
  SPLIT_ARC,
  CHAIN_RANGE,
  CHAIN_SPEED,
  ECHO_RADIUS,
  ECHO_GAP,
  MULTISTRIKE_GAP,
  STUN_SECONDS,
  IMPACT_RADIUS,
  RUTHLESS_EVERY,
} from './modifications';
export { PASSIVES } from './passives';
export { POWERUPS, POWERUP_MAX_LEVEL } from './powerups';
export { WEAPONS, SHOCK } from './weapons';
export { WAVES, WAVE_EVENTS, waveForMinute, hpScaleForMinute, hpScaleForPlayers, speedScaleForMinute, spawnScaleFor } from './waves';
export { BASE_STATS, PLAYER_RADIUS, REROLLS_PER_RUN } from './player';
export { CHARACTERS, DEFAULT_CHARACTER } from './characters';
export { ULTIMATES } from './ultimates';

/** What pets attack with: the passives' own attacks, then every weapon's gear (Bunny Armory). */
export const PET_ATTACKS: WeaponDef[] = [
  ...PASSIVES.flatMap((p) => (p.kind === 'pets' ? [p.attack] : [])),
  ...WEAPONS.flatMap((w) => w.gear ?? []),
];

/** Atlas animation of Shadows and Dust's cyclones (drawn in the summon layer). */
export const CYCLONE_ANIM = 'cyclone-spin';

/**
 * Art of everything drawn in the snapshot's summon layer: pets (bare, then with each piece of gear), then seeker
 * blades, then Shadows and Dust's cyclones. A summon's index in this list is how snapshots tell joiners which
 * animation to play.
 */
export const SUMMON_ANIMS: string[] = [
  ...new Set([
    ...PASSIVES.flatMap((p) => (p.kind === 'pets' ? [p.anim] : [])),
    ...WEAPONS.flatMap((w) => (w.gear ?? []).flatMap((g) => (g.petAnim ? [g.petAnim] : []))),
    ...WEAPONS.flatMap((w) => (w.targeting === 'seeker' && w.projectileAnim ? [w.projectileAnim] : [])),
    CYCLONE_ANIM,
  ]),
];

/**
 * Everything that can fire a projectile: weapons, ultimate attacks, pet attacks, then curio attacks. A projectile's
 * index in this list is how snapshots tell joiners which art to draw.
 */
export const ATTACK_DEFS: WeaponDef[] = [...WEAPONS, ...ULTIMATES.map((u) => u.attack), ...PET_ATTACKS, ...CURIO_ATTACKS];

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((e) => [e.id, e]));

const weaponMap = byId(WEAPONS);
const curioMap = byId(CURIOS);
const modMap = byId(MODIFICATIONS);
const powerupMap = byId(POWERUPS);
const enemyMap = byId(ALL_ENEMIES);
const hazardMap = byId(HAZARDS);
const characterMap = byId(CHARACTERS);
const ultimateMap = byId(ULTIMATES);
const passiveMap = byId(PASSIVES);

export function weaponDef(id: string): WeaponDef {
  const d = weaponMap.get(id);
  if (!d) throw new Error(`Unknown weapon ${id}`);
  return d;
}

export function curioDef(id: string): CurioDef {
  const d = curioMap.get(id);
  if (!d) throw new Error(`Unknown curio ${id}`);
  return d;
}

/** The curio `id`, typed by its kind. */
export function curioOf<K extends CurioId>(id: K): Extract<CurioDef, { id: K }> {
  return curioDef(id) as Extract<CurioDef, { id: K }>;
}

export function modDef(id: string): ModificationDef {
  const d = modMap.get(id);
  if (!d) throw new Error(`Unknown modification ${id}`);
  return d;
}

export function powerupDef(id: string): PowerupDef {
  const d = powerupMap.get(id);
  if (!d) throw new Error(`Unknown powerup ${id}`);
  return d;
}

export function enemyDef(id: string): EnemyDef {
  const d = enemyMap.get(id);
  if (!d) throw new Error(`Unknown enemy ${id}`);
  return d;
}
/** The modifier `id`, typed by its kind. */
export function enemyModifier<K extends EnemyModifierId>(id: K): Extract<EnemyModifierDef, { id: K }> {
  const d = ENEMY_MODIFIERS.find((m) => m.id === id);
  if (!d) throw new Error(`Unknown enemy modifier ${id}`);
  return d as Extract<EnemyModifierDef, { id: K }>;
}

/** A modifier's bit in `Enemy.modMask` and in snapshots: 1 << its index in ENEMY_MODIFIERS. */
export function modifierBit(id: EnemyModifierId): number {
  return 1 << ENEMY_MODIFIERS.findIndex((m) => m.id === id);
}

export function hazardDef(id: string): HazardDef {
  const d = hazardMap.get(id);
  if (!d) throw new Error(`Unknown hazard ${id}`);
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

export function passiveDef(id: string): PassiveDef {
  const d = passiveMap.get(id);
  if (!d) throw new Error(`Unknown passive ${id}`);
  return d;
}

export { POTION, GEM_TIERS } from './drops';
export { REVIVE, reviveHpPercent } from './coop';
