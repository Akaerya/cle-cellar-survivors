/**
 * Shapes for every data file. Adding a weapon, item or enemy means adding an entry
 * that satisfies one of these types; engine code reads them generically.
 */

export type Targeting = 'nearest' | 'facing' | 'random' | 'orbit' | 'aura' | 'stab' | 'breath' | 'strike' | 'shield';

export interface WeaponStats {
  /**
   * Seconds between volleys. For orbit and aura weapons: seconds between hits on the same enemy.
   * For shields: seconds for the block to recharge.
   */
  cooldown: number;
  damage: number;
  projectileCount: number;
  /** px/s. For orbit weapons this is the speed along the ring. 0 with `facing` means a melee sweep. */
  speed: number;
  /** Enemies hit before the projectile vanishes. Use Infinity for sweeps, orbits and auras. */
  pierce: number;
  /** Seconds a projectile lives (for sweeps: how long the slash is drawn). */
  lifetime: number;
  /**
   * px radius of the projectile, sweep or aura; reach of a stab or breath; blast radius of a strike.
   * Scaled by the player's area multiplier.
   */
  size: number;
  /** px an enemy is pushed back on hit. */
  knockback: number;
  /** Degrees between projectiles in one volley. */
  spread: number;
  /** `nearest`: max distance to a target. `orbit`: ring radius (scaled by area). `strike`: px around the player bolts land in. */
  range: number;
  /** `facing` sweeps and `breath`: arc width in degrees. `stab`: blade width in px. */
  arc: number;
  /** Projectiles fly out, then return to the thrower; the return trip is a new pass. */
  boomerang: boolean;
  /** `shield`: fraction of every hit absorbed while the block is recharging (0..1). */
  reduction?: number;
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
  /** Chance (0..1) to drop a health potion on death. See data/drops.ts. */
  potionChance: number;
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

export interface CharacterDef {
  id: string;
  /** Shown as typed (the pixel font draws it in capitals). */
  name: string;
  /** One-line epithet on the character select screen. */
  title: string;
  description: string;
  /** Animation prefix: `${anim}-idle`, `${anim}-walk` and `${anim}-hurt` must exist. */
  anim: string;
  /** Atlas frame for previews (wiki, lobby). */
  firstFrame: string;
  startingWeapon: string;
  /** Weapon ids this character can be offered on level-up (its own kit). Items are shared. */
  weapons: string[];
  /** Ultimate id (data/ultimates.ts), cast with Q. */
  ultimate: string;
}

export type UltimateKind = 'storm' | 'pet';

export interface UltimateDef {
  id: string;
  name: string;
  description: string;
  /** Atlas frame for the HUD. A greyed-out copy named `${icon}_grey` is built at boot. */
  icon: string;
  kind: UltimateKind;
  /** Seconds the effect lasts once cast. */
  duration: number;
  /** Seconds from casting until it can be cast again (not affected by the cooldown stat). */
  cooldown: number;
  /** Seconds between shots while active. */
  interval: number;
  /** Projectiles per shot (`storm`: spread evenly around the caster). */
  count: number;
  /** `storm`: degrees per second the spiral turns. */
  spin?: number;
  /**
   * The projectile the ultimate fires. Uses the WeaponDef shape so it shares the projectile pool,
   * the network sync and the damage tracking. `pet`: `stats.range` is how far the pet looks for targets.
   */
  attack: WeaponDef;
}
