/**
 * Shapes for every data file. Adding a weapon, item or enemy means adding an entry
 * that satisfies one of these types; engine code reads them generically.
 */

export type Targeting =
  | 'nearest'
  | 'facing'
  | 'random'
  | 'orbit'
  | 'aura'
  | 'stab'
  | 'breath'
  | 'strike'
  | 'shield'
  | 'bomb'
  | 'field'
  | 'passive'
  | 'beam'
  | 'wave'
  | 'spin'
  | 'flicker'
  | 'infusion'
  | 'seeker'
  | 'petbuff'
  | 'armory'
  | 'followup';

/**
 * Ability tags. A modification (data/modifications.ts) changes every weapon that carries one of its tags.
 * `projectile`: thrown or orbiting objects. `aoe`: hits everything in an area (the area part of the weapon).
 * `duration`: leaves a timed effect on enemies (see `WeaponDef.effect`) or on its owner (see `WeaponDef.buff`).
 * `melee`: strikes up close with a blade (or answers a hit taken, for shields).
 * `dot`: deals damage over time. A weapon whose effect deals damage counts as `dot` even without the tag, and a `dot`
 * weapon counts as `duration` too (see `effectiveTags` in core/progression.ts).
 */
export type WeaponTag = 'projectile' | 'aoe' | 'duration' | 'melee' | 'dot';

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
  /** Enemies hit before the projectile vanishes. Use Infinity for sweeps, orbits, auras and bombs. */
  pierce: number;
  /** Seconds a projectile lives (for sweeps: how long the slash is drawn; for bombs: longest flight before it explodes anyway). */
  lifetime: number;
  /**
   * px radius of the projectile, sweep or aura; reach of a stab or breath; blast radius of a strike or bomb.
   * Scaled by the player's area multiplier.
   */
  size: number;
  /** px an enemy is pushed back on hit. */
  knockback: number;
  /** Degrees between projectiles in one volley. */
  spread: number;
  /** `nearest`, `bomb`: max distance to a target. `orbit`: ring radius (scaled by area). `strike`: px around the player bolts land in. */
  range: number;
  /** `facing` sweeps and `breath`: arc width in degrees. `stab`: blade width in px. */
  arc: number;
  /** Projectiles fly out, then return to the thrower; the return trip is a new pass. */
  boomerang: boolean;
  /** `shield`: fraction of every hit absorbed while the block is recharging (0..1). */
  reduction?: number;
  /** Times the attack is performed again after the first one, `WeaponDef.repeatDelay` seconds apart. */
  repeat?: number;
  /** `passive`: chance (0..1) added to the owner's critical strike chance. */
  crit?: number;
  /** `passive`: seconds taken off every cooldown of the owner (ultimate included) on each critical strike. */
  critCooldown?: number;
  /**
   * `passive`: share of each cooldown that crit refunds can never take off (0.5: an ability comes back no sooner than
   * half its cooldown after it was used). Without it, hundreds of crits a second would let abilities fire every frame.
   */
  refundFloor?: number;
  /** `field`: fraction of their speed enemies inside the field lose (0.25 = 25% slower). Slows do not stack. */
  slow?: number;
  /** `shield`: share of every hit taken (before any reduction) dealt back to the attacker. */
  reflect?: number;
  /**
   * `flicker`: chance (0..1) per enemy hit to gain a Shadow Charge. Weapons with `charges`: chance per attack that
   * hits to gain a charge.
   */
  chargeChance?: number;
  /** Weapons with `charges`: multiplies what every charge does (1 = as in `WeaponDef.charges`, 2 = 100% increased effect). */
  chargeEffect?: number;
  /** `petbuff`: fraction added to the damage of the owner's pets (0.25 = +25%). */
  petDamage?: number;
  /** `petbuff`: pets attack this much more often (0.2 = 20% faster; the cooldown is divided by 1 + it). */
  petHaste?: number;
  /** `petbuff`: fraction added to the move speed of the owner's pets. */
  petSpeed?: number;
  /** `followup`: chance (0..1) per hit the owner lands (not by this weapon) to fire it at the enemy that was hit. */
  procChance?: number;
}

export type NumericWeaponStat = Exclude<keyof WeaponStats, 'boomerang'>;

/** A damage-over-time effect a weapon's hits (or fields) leave on enemies (duration weapons). */
export interface EffectDef {
  /**
   * Effects that share an id are one ailment whoever applied them (Shock from Plunder and from Vulnerability):
   * `WeaponDef.detonate` finds stacks by it.
   */
  id?: string;
  /** Shown in the wiki, e.g. 'Rime Trauma'. */
  name?: string;
  /** Damage per tick, before DAMAGE and modification bonuses. */
  damage: number;
  /** Seconds between ticks. */
  interval: number;
  /** Seconds one stack lasts. Scaled by duration modifications. */
  duration: number;
  /** Every application adds a new stack. Without it, a new hit refreshes the stack the weapon applied before. */
  stacks?: boolean;
  /** Enemies carrying the effect are tinted this colour. */
  tint?: number;
  /** Most stacks one weapon can keep on one enemy (defaults to MAX_EFFECT_STACKS). Reiterate copies stop here too. */
  maxStacks?: number;
}

/**
 * On hit, the weapon sets off what the enemy's stacks of effect `effect` (EffectDef.id) still have to deal: `share` of
 * the damage they would do in the time they have left, dealt at once as damage over time. The stacks stay. The
 * weapon's own damage bonuses (levels, modifications, Ruthless, splits and bounces) scale it; DAMAGE does not again,
 * since the stacks already have it.
 */
export interface DetonateDef {
  effect: string;
  share: number;
}

/** The kinds of charge Unstable Infusion gives (see ChargesDef). */
export type ChargeKind = 'brutal' | 'siphon' | 'vicissitude';

/** `infusion` weapons: the charges a hit can give the owner. Effects are per charge, before `chargeEffect`. */
export interface ChargesDef {
  /** Seconds each charge lasts. */
  duration: number;
  /** Most charges of one kind at once; a new one past that replaces the oldest. */
  max: number;
  /** Brutal: chance (0..1) per charge that a hit deals double damage (not a critical strike). */
  brutal: number;
  /** Siphoning: share of damage dealt recovered as health, per charge. */
  siphon: number;
  /** Vicissitude: share the next damage taken is reduced by; that instance uses up one charge. */
  vicissitude: number;
}

/** `flicker` weapons: Shadow Charges, each one an extra strike that skips the cooldown. */
export interface ShadowDef {
  /** Seconds between checks for a Shadow Charge to spend. */
  check: number;
  /** Most Shadow Charges held at once. */
  max: number;
  /** Chance (0..1) to gain one when the weapon's hit (or splash, or echo) kills its enemy, on top of the chance per hit. */
  onKill: number;
}

/** How a weapon fires its extra projectiles one after another instead of all at once. */
export interface BurstDef {
  /** Fraction of the cooldown (after Ability Haste) the projectiles are spread over. */
  window: number;
  /**
   * 'within': n projectiles spaced window / n apart, so the last leaves one gap before the window ends.
   * 'end': the extra projectiles are spaced window / (n - 1) apart, so the last leaves exactly at the end of the window.
   */
  spacing: 'within' | 'end';
  /** Who the projectiles after the first aim at: the closest enemy, or a random enemy on the owner's screen. */
  target: 'nearest' | 'random';
}

export interface WeaponLevel {
  /** Shown on the level-up card. */
  text: string;
  /** Flat amounts added to the base value. */
  add?: Partial<Record<NumericWeaponStat, number>>;
  /**
   * Percent of the base value added (0.15 = +15%). Percents add up over levels, so four +15% levels are +60%.
   * Size and damage percents also go into the same sum as the AREA stat and modification bonuses.
   */
  pct?: Partial<Record<NumericWeaponStat, number>>;
  /** Attacks this much more often (0.4 = 40% faster). Adds up over levels; the cooldown is divided by 1 + the total. */
  faster?: number;
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
  /** Which modifications change this weapon. No tags: none do. */
  tags?: WeaponTag[];
  /**
   * Modifications only add their damage bonus when they share one of these tags (defaults to `tags`). For weapons
   * whose damage comes from one part only, e.g. a projectile that deals no damage but sets off an AoE blast.
   */
  damageTags?: WeaponTag[];
  /** The projectile never pierces: the Pierce modification's extra pierce does not apply. */
  noPierce?: boolean;
  /** The weapon's area deals no damage itself (a field that only slows and applies an effect): Echo Strike does nothing. */
  harmlessArea?: boolean;
  /** The projectile deals no damage itself: every enemy it touches sets off a blast of `stats.size` px. */
  blastOnHit?: boolean;
  /** Look of the weapon's blasts: an orange burst, or a cold crystal burst. */
  blastStyle?: 'burst' | 'frost';
  /** Projectiles turn to face where they fly (arrows). */
  orient?: boolean;
  /** Level 1 stats. */
  stats: WeaponStats;
  /** Changes applied to reach level 2, 3, 4 and 5, in order. */
  levels: WeaponLevel[];
  /** Seconds between an attack and each of its repeats (`stats.repeat`). */
  repeatDelay?: number;
  /**
   * With more than one projectile, they are fired one at a time instead of all at once (see BurstDef). The first
   * always goes at the closest enemy.
   */
  burst?: BurstDef;
  /** `field`: seconds between the field's checks for enemies standing on it (the first check is when it appears). */
  fieldInterval?: number;
  /** Timed effect each hit (or field check) leaves on the enemy. Give the weapon the `duration` tag. */
  effect?: EffectDef;
  /**
   * An effect the weapon puts on its owner instead (Storm Shield's Aegis, Mistwalker's amplification). With the
   * `duration` tag, Reiterate can copy it when it is applied.
   */
  buff?: { name: string };
  /** The charges the owner's attacks can give while the weapon is owned (Unstable Infusion, Vulnerability). */
  charges?: ChargesDef;
  /** `flicker`: its Shadow Charges. */
  shadow?: ShadowDef;
  /**
   * `flicker`: seconds one strike takes. Strikes that come up meanwhile (the cooldown, Multistrike repeats, Shadow
   * Charges) wait their turn in that order of priority and go one after another.
   */
  strikeTime?: number;
  /**
   * `armory`: the weapons the owner's pets can carry, one each, picked at random and swapped every `stats.cooldown`
   * seconds. Each is the attack the pet makes instead of its own: `stab` cuts the closest enemy within its reach,
   * `nearest` fires a projectile at it. Their damage grows with the armory's level (`levels` of each gear weapon).
   */
  gear?: WeaponDef[];
  /** Atlas animation of a pet carrying this gear (`gear` weapons). */
  petAnim?: string;
  /** `seeker`: px from the owner the blade floats at while it waits for its next dash. */
  hover?: number;
  /** Every hit sets off the enemy's stacks of an effect (see DetonateDef). */
  detonate?: DetonateDef;
  /** `field`: how the field looks: a freezing swirl (default) or a spider web. */
  fieldStyle?: 'swirl' | 'web';
  /**
   * `field`: an enemy that dies on the field hands all its duration effect stacks (any weapon's) to the closest enemy
   * on the owner's screen, with the time they have left.
   */
  transferOnDeath?: boolean;
}

/**
 * What a modification does, as totals at one level. Missing fields are 0. Every bonus applies only to
 * weapons that share a tag with the modification.
 */
export interface ModEffect {
  /** Extra enemies a projectile hits before vanishing. */
  pierce?: number;
  /** Extra projectiles each time the weapon fires. */
  projectiles?: number;
  /** Fraction added to damage (0.15 = +15%). Bonuses from different modifications add up. */
  damage?: number;
  /** Projectiles split into this many on hitting an enemy (0 = no split). */
  split?: number;
  /** Fraction less damage a split projectile deals than the one it split from. */
  splitLess?: number;
  /** Chance (0..1) that a projectile from a split can split one more time. */
  splitAgain?: number;
  /** Bounces to a nearby enemy once a projectile's pierce runs out. */
  chain?: number;
  /** Fraction less damage a projectile deals after each bounce than before it. */
  chainLess?: number;
  /** Fraction added to the speed of a projectile that bounced. */
  chainSpeed?: number;
  /** Fraction added to area. Area bonuses add up with each other and with the AREA stat. */
  area?: number;
  /** Echo Strike: fraction of each area hit dealt again around the enemy that was hit. */
  echo?: number;
  /** Echo Strike: fraction added to the echo radius. */
  echoArea?: number;
  /** Echo Strike: times each echo goes off. */
  echoRepeats?: number;
  /** Fraction added to the duration of effects (negative shortens them). */
  duration?: number;
  /** Chance (0..1) that an effect stack copies itself when it deals damage or is applied. */
  reiterate?: number;
  /** Multistrike: times every attack is done again right away. */
  multistrike?: number;
  /** Multistrike: chance (0..1) that any attack, a repeat included, is done once more. */
  repeatChance?: number;
  /** Stun: chance (0..1) that a hit stuns the enemy. */
  stunChance?: number;
  /** Stun: fraction more damage a stunned enemy takes. */
  stunBonus?: number;
  /** Momentum: share of the owner's current move speed added to the base damage of each hit. */
  momentum?: number;
  /** Impact: share of each hit dealt again as splash around the enemy that was hit (0 = no splash). */
  impact?: number;
  /** Ruthless: fraction added to the damage of every third attack. */
  ruthless?: number;
  /** Additional Projectiles: fraction less damage the weapon deals (multiplies). */
  projectileLess?: number;
  /** Deadly Ailments: fraction less damage the weapon's hits deal (not its damage over time; multiplies). */
  hitLess?: number;
  /** Fraction added to the damage of the weapon's damage over time (adds up with its other damage bonuses). */
  dotDamage?: number;
  /** Virulent Chain: fraction less damage over time the weapon deals (multiplies). */
  dotLess?: number;
  /** Sadism: fraction the time between damage-over-time ticks is shortened by (0.6: ticks 2.5 times as often). */
  dotRate?: number;
  /** Fraction added to how long the weapon's damage-over-time stacks last (adds up with `duration`). */
  dotDuration?: number;
  /** Virulent Chain: when an enemy dies, each of its stacks of the weapon moves to this many enemies nearby. */
  virulent?: number;
}

export type ModKey = keyof ModEffect;

export interface ModLevel {
  /** Shown on the level-up card. */
  text: string;
  /** Added to the totals of the levels before. */
  add?: ModEffect;
  /** Replaces those totals. */
  set?: ModEffect;
}

export interface ModificationDef {
  id: string;
  name: string;
  /** Shown on the card when the modification is offered as new. */
  description: string;
  icon: string;
  /** Changes every weapon that has at least one of these tags. */
  tags: WeaponTag[];
  /** Level 1 (applied when picked) to level 5, in order. */
  levels: ModLevel[];
}

/** One of the passive abilities characters have (data/passives.ts): always on, never picked. */
export type PassiveDef = { id: string; name: string; description: string; icon: string } & (
  /** Shroud: `chance` (0..1) to dodge a hit entirely. */
  | { kind: 'dodge'; chance: number }
  /**
   * Ragebaiter: on falling, stands right back up with `hp` of max HP, once every `cooldown` seconds, invulnerable as
   * long as after a co-op revive (REVIVE.invulnSeconds). A banner tells a random other player to be put in the bin
   * (`fallback` when alone).
   */
  | { kind: 'rebirth'; hp: number; cooldown: number; fallback: string }
  /** Dragonborn: a stack every `every` seconds of the run, each giving the stat changes in `perStack`. */
  | { kind: 'growth'; every: number; perStack: StatModifier[] }
  /**
   * Death Defied: damage that would leave less than `below` of max HP is not taken; instead `heal` of max HP is
   * restored over `over` seconds. Once every `cooldown` seconds.
   */
  | { kind: 'reprieve'; below: number; heal: number; over: number; cooldown: number }
  /**
   * Warren: `start` pets from the start of the run and another every `every` seconds, at most `max`. Pets run at
   * `speed` px/s, go after enemies within `aggro` px of their owner and come back once further than `leash` px from
   * them. `attack` is what a pet does to an enemy it reaches: a headbutt that hits it once it is within
   * `attack.stats.size` px. `anim`: the pet's atlas animation (it carries no gear).
   */
  | { kind: 'pets'; start: number; every: number; max: number; speed: number; aggro: number; leash: number; anim: string; attack: WeaponDef }
  /**
   * Plunder: every hit the owner lands (not damage over time) puts a stack of `attack.effect` on the enemy. `attack`
   * owns the stacks: its tags decide which modifications change them, and it keeps their damage for the party screen.
   */
  | { kind: 'ailment'; attack: WeaponDef }
);

export interface PlayerStats {
  maxHp: number;
  moveSpeed: number;
  regen: number;
  /** Fraction of max HP healed every second, on top of `regen`. */
  regenPercent: number;
  armor: number;
  /** Multiplies damage taken (after armor and shields). */
  damageTaken: number;
  pickupRadius: number;
  damageMult: number;
  cooldownMult: number;
  /** Cooldowns are multiplied by 100 / (100 + haste). */
  abilityHaste: number;
  /** Chance (0..1) that a hit is a critical strike. Passive weapons (e.g. Original Pristinity) add to it. */
  critChance: number;
  /** Damage of a critical strike, as a multiple of the hit (2 = double). */
  critDamage: number;
  areaMult: number;
  expMult: number;
  /** Share of the damage you deal that you recover as health. */
  lifeSteal: number;
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
  /** Highest level (defaults to MAX_LEVEL). */
  maxLevel?: number;
  /** Only offered new while you own a weapon with this tag. */
  requiresTag?: WeaponTag;
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
  shadow: 'shadow_s' | 'shadow_l' | 'shadow_xl';
  /** Extra px between sprite and shadow (bats hover). */
  hover: number;
  /** Chance (0..1) to drop a health potion on death. See data/drops.ts. */
  potionChance: number;
  /** Sprite scale (bosses are drawn larger). `radius` is already in world px. */
  scale?: number;
  /** Weight when enemies push each other apart (default 1): heavy ones shove light ones aside. */
  mass?: number;
  /** Fires slow projectiles at players (boss minions). */
  shooter?: ShooterDef;
  /** Makes this enemy a boss (see data/bosses.ts). */
  boss?: BossInfo;
}

/** An enemy that shoots: every `interval` seconds, one `hazard` at the closest living player within `range`. */
export interface ShooterDef {
  interval: number;
  range: number;
  /** Hazard id (HAZARDS in data/index.ts) fired. */
  hazard: string;
  speed: number;
  damage: number;
  lifetime: number;
}

/**
 * Something a boss leaves in the world that touches players: webs, pollen, whirlpools, thrown things.
 * The look and size are fixed per kind (joiners draw them from this table); damage and timing come from the skill.
 */
export interface HazardDef {
  id: string;
  /** Atlas frame, or the animation to play when `anim` is set. */
  frame: string;
  anim?: string;
  /** px from its centre that counts as touching a player. */
  radius: number;
  /** Radius of the art at scale 1 (the art is scaled to `radius`). */
  artRadius: number;
  /** Radians per second the art turns. */
  spin?: number;
  /** Lies on the ground under units, rather than flying over them. */
  ground: boolean;
  /** Seconds it fades out at the end of its life. */
  fade?: number;
  /** Fraction of move speed a player standing in it loses (webs). */
  slow?: number;
  /** Standing in it also piles a stacking slow on the player (void fields: Astral Chains). */
  chains?: ChainsDef;
}

/**
 * A stacking slow a hazard puts on players standing in it: a stack every `every` seconds, each lasting `duration`
 * seconds (also after leaving) and slowing by `slow` on top of the hazard's own slow, at most `max` stacks.
 */
export interface ChainsDef {
  every: number;
  duration: number;
  slow: number;
  max: number;
}

/** How many modifiers a rare enemy gets, how often (0..1 per spawn), and the colour of its border. */
export interface RareTier {
  modifiers: number;
  chance: number;
  color: number;
}

/**
 * One modifier a rare enemy can have (data/enemyModifiers.ts). Written from the enemy's side: "enemies" are the
 * players, "allies" are the other monsters (bosses and minions too). `name` is internal and never shown to players.
 * `color` is the colour of its look (when it has one). Every number is in seconds, px, HP or a fraction.
 */
export type EnemyModifierDef = { name: string; color: number } & (
  /** Every `every` seconds a `hazard` (void field) appears at a random spot within `spread` px, for `life` seconds. */
  | { id: 'astral_touched'; every: number; spread: number; hazard: string; life: number }
  /** Other allies within `radius` px cannot drop below 1 HP (Intervention). Never protects units that have this modifier. */
  | { id: 'invulnerability'; radius: number }
  /** Increased damage and move speed and less damage taken, growing with missing HP; full at `fullAt` of max HP left. */
  | { id: 'enrage'; damage: number; speed: number; reduction: number; fullAt: number }
  /** Takes `reduction` less damage. */
  | { id: 'physical_resistant'; reduction: number }
  /** On death a `hazard` (caustic ground) is left for `life` seconds, dealing `damage` every `interval` seconds. */
  | { id: 'caustic_ground'; hazard: string; life: number; damage: number; interval: number }
  /** When hit, a `hazard` (crystal bud) grows under the attacker and explodes after `charge` seconds for `damage` within `radius` px. */
  | { id: 'crystalline'; hazard: string; charge: number; radius: number; damage: number }
  /** Allies within `radius` px, itself included, get these increases to max HP, move speed and damage. */
  | { id: 'empower_allies'; radius: number; health: number; speed: number; damage: number }
  /** `more` more damage per `per` of the target's max HP missing. */
  | { id: 'executioner'; per: number; more: number }
  /** `health` increased max HP. */
  | { id: 'extra_life'; health: number }
  /** Debuffs (duration effects, slows) cannot be applied to it. */
  | { id: 'hexproof' }
  /**
   * When hit (not by damage over time), deals `flat` plus `share` of the hit's damage back to the attacker, but never
   * takes them below `floor` of their max HP (the damage is cut to what reaches it).
   */
  | { id: 'thorns'; flat: number; share: number; floor: number }
  /** Every `cooldown` seconds teleports `distance` px from the closest player (when further away than that). */
  | { id: 'ambush'; cooldown: number; distance: number }
  /** Gains a soul whenever an ally dies within `radius` px: `damage` increased damage and `haste` Ability Haste per soul. */
  | { id: 'soul_absorption'; radius: number; damage: number; haste: number }
  /** It and allies within `radius` px come back once with full HP when they die (drawn see-through at `alpha` after). */
  | { id: 'spirit_walker'; radius: number; alpha: number }
  /** `chance` (0..1) to ignore any damage instance. */
  | { id: 'blocks_attacks'; chance: number }
  /**
   * Hits from players further than `radius` px away (their body outside the bubble) deal `reduction` less (damage
   * over time is not a hit). After `hits` such hits the bubble breaks for `recharge` seconds. One bubble per enemy:
   * they never stack.
   */
  | { id: 'temporal_shield'; radius: number; reduction: number; hits: number; recharge: number }
);

export type EnemyModifierId = EnemyModifierDef['id'];

/** One thing a boss does on its own cooldown. Every number is in seconds, px or HP. */
export type BossSkill =
  /** Shoots webs onto random spots within `range` of the closest player. */
  | { kind: 'webs'; cooldown: number; count: number; range: number; lifetime: number }
  /** Summons `minion` enemies around itself, keeping at most `max` alive. */
  | { kind: 'summon'; cooldown: number; count: number; max: number; minion: string; distance: number }
  /** Releases pollen clouds that drift after the closest player and hurt anyone inside. */
  | { kind: 'pollen'; cooldown: number; count: number; speed: number; lifetime: number; damage: number }
  /** Stops, aims at the closest player for `charge` seconds (a red line shows where), then fires a beam. */
  | { kind: 'beam'; cooldown: number; charge: number; length: number; width: number; duration: number; damage: number; color: number }
  /** Opens whirlpools near random players that hurt anyone inside. */
  | { kind: 'whirlpools'; cooldown: number; count: number; range: number; lifetime: number; damage: number }
  /** Stops and raises its club for `windup` seconds (a red circle shows the reach), then a shockwave rolls out. */
  | { kind: 'slam'; cooldown: number; windup: number; radius: number; duration: number; damage: number; band: number }
  /** Throws clubs out in every direction; they slow down, then fly back to the boss. */
  | { kind: 'clubs'; cooldown: number; count: number; speed: number; outTime: number; damage: number; lifetime: number };

export interface BossInfo {
  /** Shown on the HP bar and in the wiki. */
  title: string;
  description: string;
  /** HP bar colour. */
  color: number;
  skills: BossSkill[];
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
  /** Passive id (data/passives.ts): always on. */
  passive?: string;
}

export type UltimateKind = 'storm' | 'pet' | 'dome' | 'mist' | 'giant' | 'detonate';

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
  /** `dome`: px radius of the dome, centred where it was cast. */
  radius?: number;
  /**
   * `dome`: colour of the dome and its beams. `mist`: colour of the mist. `detonate`: colour the screen flashes as
   * every enemy's stacks are set off (`attack.detonate`) at once.
   */
  color?: number;
  /** `mist`: fraction added to the DAMAGE stat once the mist lifts, for `after` seconds. */
  amp?: number;
  after?: number;
  /**
   * `giant`: a giant version of the caster's pets joins them while it lasts (see `PassiveDef` 'pets'), drawn `scale`
   * times as large. It gets every pet bonus, deals `power` times their damage and moves `speedMult` times as fast;
   * `attack` is its own attack, hitting everything within `attack.stats.size` px of the enemy it reaches.
   */
  scale?: number;
  power?: number;
  speedMult?: number;
  /**
   * The projectile the ultimate fires. Uses the WeaponDef shape so it shares the projectile pool,
   * the network sync and the damage tracking. `pet`: `stats.range` is how far the pet looks for targets.
   */
  attack: WeaponDef;
}
