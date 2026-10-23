/**
 * Shapes for every data file. Adding a weapon, item or enemy means adding an entry
 * that satisfies one of these types; engine code reads them generically.
 */

export type Targeting = 'nearest' | 'facing' | 'random' | 'orbit' | 'aura';

export interface WeaponStats {
  /** Seconds between volleys. For orbit and aura weapons: seconds between hits on the same enemy. */
  cooldown: number;
  damage: number;
  projectileCount: number;
  /** px/s. For orbit weapons this is the speed along the ring. 0 with `facing` means a melee sweep. */
  speed: number;
  /** Enemies hit before the projectile vanishes. Use Infinity for sweeps, orbits and auras. */
  pierce: number;
  /** Seconds a projectile lives (for sweeps: how long the slash is drawn). */
  lifetime: number;
  /** px radius of the projectile, sweep or aura. Scaled by the player's area multiplier. */
  size: number;
  /** px an enemy is pushed back on hit. */
  knockback: number;
  /** Degrees between projectiles in one volley. */
  spread: number;
  /** `nearest`: max distance to a target. `orbit`: ring radius (scaled by area). */
  range: number;
  /** `facing` sweeps: arc width in degrees. */
  arc: number;
  /** Projectiles fly out, then return to the monkey; the return trip is a new pass. */
  boomerang: boolean;
}

export type NumericWeaponStat = Exclude<keyof WeaponStats, 'boomerang'>;

export interface WeaponLevel {
  /** Shown on the level-up card. */
  text: string;
  add?: Partial<Record<NumericWeaponStat, number>>;
  mul?: Partial<Record<NumericWeaponStat, number>>;
  set?: Partial<WeaponStats>;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Shown on the card when the weapon is offered as new. */
  description: string;
  icon: string;
  targeting: Targeting;
  /** Atlas animation for projectiles / orbiting objects. */
  projectileAnim?: string;
  /** Radius of the projectile art at scale 1, used to scale art with `size`. */
  artRadius?: number;
  /** Colour of slash or aura effects. */
  color?: number;
  /** Level 1 stats. */
  stats: WeaponStats;
  /** Changes applied to reach level 2, 3, 4 and 5, in order. */
  levels: WeaponLevel[];
}

export interface PlayerStats {
  maxHp: number;
  moveSpeed: number;
  regen: number;
  armor: number;
  pickupRadius: number;
  damageMult: number;
  cooldownMult: number;
  areaMult: number;
  expMult: number;
}

export type StatKey = keyof PlayerStats;

export interface StatModifier {
  stat: StatKey;
  /** Added to the base value. */
  flat?: number;
  /** Fraction of the base value, e.g. 0.1 for +10%. */
  percent?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Applied once per level. */
  perLevel: StatModifier[];
  /** Shown on the card for each upgrade. */
  levelText: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  speed: number;
  damage: number;
  exp: number;
  /** Collision circle radius in px. */
  radius: number;
  /** Atlas animation key. */
  anim: string;
  firstFrame: string;
  /** Minute the type first appears in the wave table (documentation; the wave weights decide). */
  firstMinute: number;
  /** 0 = full knockback, 1 = immune. */
  knockbackResist: number;
  /** Colour of the death puff. */
  puffColor: number;
  shadow: 'shadow_s' | 'shadow_l';
  /** Extra px between sprite and shadow (bats hover). */
  hover: number;
}

export interface WaveRow {
  /** First minute this row applies to (inclusive). */
  from: number;
  /** Last minute (exclusive). */
  to: number;
  /** Enemies the spawner keeps alive at once. */
  target: number;
  /** Spawn weights by enemy id. */
  weights: Record<string, number>;
}

export interface WaveEvent {
  /** Seconds into the run. */
  at: number;
  type: 'swarm';
  enemy: string;
  count: number;
}
