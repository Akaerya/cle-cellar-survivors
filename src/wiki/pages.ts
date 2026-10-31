/**
 * The in-game wiki (title screen > WIKI, or the pause menu).
 *
 * Every number is read from src/data and src/constants, so changing a value updates the wiki by
 * itself. The prose (rules, notes, how things work) is written by hand in this file: when you add
 * or change a mechanic, a weapon behaviour, a drop or a co-op rule, update the matching text here.
 */
import {
  ENEMY_HIT_COOLDOWN,
  FALLBACK_HEAL,
  INVULN_SECONDS,
  LEVELUP_INVULN_SECONDS,
  MAX_EFFECT_STACKS,
  MAX_FOLLOWUPS,
  MAX_PROJECTILES,
  MAX_SHIELD_REDUCTION,
  STAB_LEAD,
  MAX_ENEMIES,
  MAX_GEMS,
  MAX_ITEMS,
  MAX_LEVEL,
  MAX_PLAYERS,
  MAX_WEAPONS,
  RUN_SECONDS,
  DESPAWN_SCREENS,
  SPAWN_TICK_MS,
  MIN_MOVE_MULT,
  COLOR,
} from '../constants';
import {
  computeStats,
  effectiveTags,
  expToNext,
  formatTime,
  hasteFactor,
  hitsWithProjectiles,
  itemMaxLevel,
  modEffectAt,
  modReach,
  weaponLevelAt,
  weaponStatsAt,
} from '../core/progression';
import { NAME_MAX } from '../core/profile';
import {
  ASTRAL_CHAINS,
  BASE_STATS,
  BOSSES,
  BOSS_TIMES,
  CHAIN_RANGE,
  CHARACTERS,
  ECHO_GAP,
  ECHO_RADIUS,
  ENEMIES,
  ENEMY_MODIFIERS,
  GEM_TIERS,
  ITEMS,
  MAX_SOUL_WISPS,
  MODIFICATIONS,
  POTION,
  POWERUPS,
  POWERUP_MAX_LEVEL,
  RARE_HP_PER_MODIFIER,
  RARE_TIERS,
  REROLLS_PER_RUN,
  SPLIT_ARC,
  REVIVE,
  WAVES,
  WAVE_EVENTS,
  enemyDef,
  hazardDef,
  hpScaleForMinute,
  hpScaleForPlayers,
  spawnScaleFor,
  reviveHpPercent,
  speedScaleForMinute,
  ultimateDef,
  weaponDef,
  passiveDef,
  CHAIN_SPEED,
  IMPACT_RADIUS,
  MULTISTRIKE_GAP,
  RUTHLESS_EVERY,
  STUN_SECONDS,
} from '../data';
import {
  HP_SCALE_PER_EXTRA_PLAYER,
  HP_SCALE_PER_MINUTE,
  SPAWN_SCALE_PER_EXTRA_PLAYER,
  SPAWN_SCALE_PER_MINUTE,
  SPEED_SCALE_PER_MINUTE,
  SPEED_SCALE_START,
} from '../data/waves';
import type {
  BossSkill,
  EnemyDef,
  EnemyModifierDef,
  ItemDef,
  ModEffect,
  PassiveDef,
  StatKey,
  StatModifier,
  Targeting,
  WeaponDef,
  WeaponStats,
  WeaponTag,
} from '../data/types';

export type Cell = string | { text: string; color?: number };

export type Block =
  | { t: 'h'; text: string }
  | { t: 'p'; text: string; color?: number }
  /** An atlas frame with a title and a subtitle next to it. */
  | { t: 'entry'; icon: string; title: string; sub: string; scale?: number }
  /** Column widths in px; the first row style is the header. */
  | { t: 'table'; cols: { label: string; w: number }[]; rows: Cell[][] }
  | { t: 'gap'; h: number };

export interface WikiPage {
  tab: string;
  /** Where contributors change these values. */
  source: string;
  /** Filter chips shown under the tabs (the first is 'ALL'). Omit for short pages. */
  filters?: () => string[];
  /** The page's content, narrowed to `filter` (one of `filters`, or 'ALL'). */
  blocks: (filter: string) => Block[];
}

/** Filter chips: ALL, then one per character (by display name). */
const characterFilters = () => ['ALL', ...CHARACTERS.map((c) => c.name.toUpperCase())];
const shows = (filter: string, label: string) => filter === 'ALL' || filter === label.toUpperCase();

// ------------------------------------------------------------------ formatting helpers

const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
const num = (v: number, digits = 1) => (Number.isInteger(v) ? String(v) : v.toFixed(digits));
const secs = (v: number) => `${+v.toFixed(2)}S`;
const dash = (v: number, f: (v: number) => string = (x) => num(x)) => (v ? f(v) : '-');

const STAT_LABELS: Record<StatKey, string> = {
  maxHp: 'MAX HP',
  moveSpeed: 'MOVE SPEED',
  regen: 'REGEN (HP/S)',
  regenPercent: 'REGEN (% MAX HP/S)',
  armor: 'ARMOR',
  damageTaken: 'DAMAGE TAKEN',
  pickupRadius: 'PICKUP RADIUS',
  damageMult: 'DAMAGE',
  cooldownMult: 'COOLDOWN',
  abilityHaste: 'ABILITY HASTE',
  critChance: 'CRIT CHANCE',
  critDamage: 'CRIT DAMAGE',
  areaMult: 'AREA',
  expMult: 'EXP GAIN',
  lifeSteal: 'LIFE STEAL',
};

const STAT_NOTES: Record<StatKey, string> = {
  maxHp: 'Fallen at 0. Maximum Health also heals the HP it adds.',
  moveSpeed: 'px per second.',
  regen: 'HP healed every second.',
  regenPercent: 'Share of max HP healed every second, on top of REGEN. Keeps working right after a hit.',
  armor: 'Subtracted from every hit (a hit always deals at least 1).',
  damageTaken: 'Multiplies the damage of every hit, after armor and shields (still at least 1).',
  pickupRadius: 'px. EXP gems inside it fly to you.',
  damageMult: 'Multiplies all weapon damage. The only multiplier: damage bonuses from weapon levels and modifications add up first. Dragonborn stacks and Mistwalker add to it.',
  cooldownMult: 'Multiplies all weapon cooldowns (lower is faster, floor 10%).',
  abilityHaste: 'Cooldowns × 100 / (100 + haste): 20 haste is 16.7% shorter, 100 haste 50%. Works with COOLDOWN; not ultimates.',
  critChance: 'Chance that a hit is a critical strike. Any of your hits can crit: weapons, blasts, echoes, effects, ultimates. Passive weapons such as Original Pristinity add to it.',
  critDamage: 'Damage of a critical strike, as a share of the hit.',
  areaMult: 'Scales weapon size, sweep, stab and breath reach, aura, orbit and blast radius. Weapon size levels and area modifications add to it.',
  expMult: 'Multiplies EXP from gems you pick up.',
  lifeSteal: 'Share of the damage you deal (after everything) that you heal. Dragonborn stacks and Siphoning charges add to it.',
};

const isPercentStat = (k: StatKey) =>
  k === 'lifeSteal' ||
  k === 'damageMult' ||
  k === 'cooldownMult' ||
  k === 'areaMult' ||
  k === 'expMult' ||
  k === 'damageTaken' ||
  k === 'regenPercent' ||
  k === 'critChance' ||
  k === 'critDamage';
const statValue = (k: StatKey, v: number) => (k === 'regenPercent' ? pct(v, 1) : isPercentStat(k) ? pct(v) : num(v));

const TAG_LABELS: Record<WeaponTag, string> = { projectile: 'PROJECTILE', aoe: 'AOE', duration: 'DURATION', melee: 'MELEE', dot: 'DOT' };
const tagList = (tags: WeaponTag[] | undefined) => (tags?.length ? tags.map((t) => TAG_LABELS[t]).join(', ') : 'NONE');
/** The tags modifications go by (damage over time counts as DOT and DURATION, see effectiveTags). */
const weaponTags = (def: WeaponDef) => tagList(effectiveTags(def));

/** How each targeting type uses its stats. Update when a weapon behaviour changes. */
const TARGETING_NOTES: Record<Targeting, string> = {
  nearest:
    'Throws at the closest enemy within RANGE. Holds fire while nothing is in range and shoots the moment something is. COUNT projectiles fan out by the spread angle, unless the weapon fires them one at a time (see below). PIERCE is how many enemies one projectile hits.',
  facing:
    'Fires toward the way you last moved. With SPEED 0 it is a melee sweep: everything within AREA px inside the arc is hit. Extra COUNT adds sweeps spread evenly around you.',
  random: 'Fires in a random direction.',
  orbit:
    'COUNT objects circle you at RANGE px (scaled by AREA). Each enemy can be hit by this weapon once per COOLDOWN. SPEED is how fast they travel along the ring.',
  bomb:
    'Throws at the closest enemy within RANGE (holds fire while nothing is in range). The projectile flies at SPEED, passes over every other enemy and explodes on reaching that enemy, or the spot where it died, hitting everything within RADIUS px. RADIUS is scaled by AREA. It never hits anything on the way, so it cannot split or chain.',
  aura: 'Every COOLDOWN, hits everything within AREA px of you.',
  stab: `Thrusts at the closest enemy once it is within REACH + ${STAB_LEAD} px, hitting everything along a blade REACH px long and WIDTH px wide. Holds while nothing is close. REACH is scaled by AREA.`,
  breath: 'Every COOLDOWN, sprays a cone at the closest enemy within REACH px: everything inside the ARC (degrees) and REACH is hit. Holds while nothing is in reach. REACH is scaled by AREA.',
  strike:
    'Every COOLDOWN, BOLTS lightning bolts land within RANGE px of you. Each bolt picks a different random enemy in range, or a random spot when there are none, and hits everything within RADIUS px of where it lands. RADIUS is scaled by AREA.',
  shield: `Puts Aegis on you: it blocks one hit completely, then the shield takes RECHARGE seconds to put it back (shortened by COOLDOWN and ABILITY HASTE; it only recharges while you have no Aegis). Aegis is an effect, so duration modifications change RECHARGE (Increase Duration +20%: RECHARGE / 1.2, Less Duration: longer) and Reiterate may put a second Aegis on you when it is applied. Every hit that is not blocked is reduced by ABSORBS (after armor, at most ${pct(MAX_SHIELD_REDUCTION)}, still at least 1). Every hit you take, blocked or not (not damage over time), deals REFLECT of its full damage back to whoever dealt it, as a melee hit of the shield: your DAMAGE, the shield's damage bonuses and melee modifications apply. The bubble around you shows Aegis (a ring per extra stack) and the recharge.`,
  field:
    'Every COOLDOWN, conjures FIELDS fields of RADIUS px: one under the closest enemy within RANGE, the others under different random enemies in range (holds while nothing is in range). A field stays where it appeared for DURATION seconds and slows every enemy on it by SLOW (slows do not stack). When it appears and then at every check (how often is below), it applies its effect to every enemy on it; each field applies its own, so two fields give two stacks. The field itself deals no damage. RADIUS is scaled by AREA, DURATION by duration modifications.',
  passive:
    'Does nothing on its own: it changes how all your other attacks work. CRIT is added to your critical strike chance; every critical strike you land takes CRIT REFUND seconds off all your cooldowns, ultimate included (never below ready). Refunds stop once an ability would come back sooner than FASTEST of its cooldown after it was used, so hundreds of crits a second cannot make abilities fire every frame.',
  beam: 'A straight beam that lingers for LIFETIME seconds and hits every enemy that touches it once. SIZE is half its width.',
  wave: 'Cuts a sword wave at the closest enemy within LENGTH px (holds while nothing is that close). The wave flies LENGTH px at SPEED and cuts every enemy it passes without using pierce until it touches the enemy it was aimed at; from that hit on it is a normal projectile: that hit uses 1 PIERCE, then it splits or chains (Pierce lets it go on). Extra COUNT sends more waves, each at a random enemy within LENGTH.',
  spin: 'Every COOLDOWN, once an enemy is within RADIUS, swings all around you: everything within RADIUS px is hit. RADIUS is scaled by AREA.',
  flicker:
    'Every COOLDOWN, teleports you just past a random enemy on your screen and cuts it (holds while there is none). The jump is instant, so Momentum adds nothing. Every enemy its hits reach (Impact splashes and echoes included) has SHADOW chance to give you a Shadow Charge, and every enemy they kill another chance, and each charge is soon spent on another Flicker Strike (see below).',
  infusion:
    'Does nothing on its own. The first hit of each of your attacks (any weapon) has CHANCE to give you a random charge for a few seconds: Brutal, Siphoning or Vicissitude. EFFECT multiplies what every charge does.',
  seeker:
    'A blade floats around you. Every COOLDOWN (counted from the start of a dash) it dashes at SPEED to the closest enemy within RANGE of you, then flies back; on the way there and back it cuts every enemy it touches, each once per dash. SIZE is how close an enemy must be to the blade (scaled by AREA). Holds while nothing is in range. Multistrike repeats are more dashes right after it is back; Ruthless counts dashes.',
  petbuff:
    'Does nothing on its own: it makes your pets stronger (see CHARACTERS, Warren and Giant Bunny). PET DAMAGE is added to their damage, PET HASTE makes them attack that much faster (their cooldowns are divided by 1 + it) and PET SPEED is added to their move speed.',
  armory:
    'Does nothing on its own: each of your pets carries one piece of GEAR (below), picked at random, and attacks with it instead of its headbutt. Every SWAP seconds (shortened by COOLDOWN and ABILITY HASTE) each pet swaps to another piece. Every level of the armory is a level of every piece of gear. Swords stab the enemy the pet reaches; bows and spellbooks shoot from a distance (the pet stops short of its target).',
  followup: `Has no cooldown. Every hit you land with anything else (hits, Impact splashes and echoes; not damage over time) has CHANCE to fire it from you at the enemy that was hit, right after that frame; several hits in one frame can each fire one (at most ${MAX_FOLLOWUPS} a frame). Its own hits never fire it again. Each shot is an attack of its own and a projectile: COUNT shots fan out by the spread angle, and projectile modifications change them.`,
};

/** Table columns per targeting type: which stats mean something for that behaviour. */
type Col = { label: string; w: number; get: (s: WeaponStats) => string };
const C = {
  damage: { label: 'DAMAGE', w: 58, get: (s) => num(s.damage) },
  cooldown: { label: 'COOLDOWN', w: 70, get: (s) => secs(s.cooldown) },
  count: { label: 'COUNT', w: 50, get: (s) => num(s.projectileCount) },
  pierce: { label: 'PIERCE', w: 54, get: (s) => (s.pierce === Infinity ? 'ALL' : num(s.pierce)) },
  area: { label: 'AREA', w: 46, get: (s) => num(s.size) },
  speed: { label: 'SPEED', w: 50, get: (s) => dash(s.speed) },
  range: { label: 'RANGE', w: 50, get: (s) => dash(s.range) },
  knockback: { label: 'KNOCKBACK', w: 80, get: (s) => num(s.knockback) },
  ret: { label: 'RETURN', w: 50, get: (s) => (s.boomerang ? 'YES' : '-') },
  reach: { label: 'REACH', w: 50, get: (s) => num(s.size) },
  width: { label: 'WIDTH', w: 50, get: (s) => num(s.arc) },
  arc: { label: 'ARC (DEG)', w: 70, get: (s) => num(s.arc) },
  bolts: { label: 'BOLTS', w: 50, get: (s) => num(s.projectileCount) },
  radius: { label: 'RADIUS', w: 54, get: (s) => num(s.size) },
  recharge: { label: 'RECHARGE', w: 70, get: (s) => secs(s.cooldown) },
  absorbs: { label: 'ABSORBS', w: 64, get: (s) => pct(s.reduction ?? 0) },
  repeats: { label: 'REPEATS', w: 60, get: (s) => num(s.repeat ?? 0) },
  fields: { label: 'FIELDS', w: 52, get: (s) => num(s.projectileCount) },
  duration: { label: 'DURATION', w: 70, get: (s) => secs(s.lifetime) },
  slow: { label: 'SLOW', w: 46, get: (s) => pct(s.slow ?? 0) },
  crit: { label: 'CRIT', w: 46, get: (s) => pct(s.crit ?? 0) },
  critRefund: { label: 'CRIT REFUND', w: 90, get: (s) => secs(s.critCooldown ?? 0) },
  fastest: { label: 'FASTEST', w: 64, get: (s) => pct(s.refundFloor ?? 0) },
  lifetime: { label: 'LIFETIME', w: 66, get: (s) => secs(s.lifetime) },
  size: { label: 'SIZE', w: 40, get: (s) => num(s.size) },
  length: { label: 'LENGTH', w: 54, get: (s) => num(s.range) },
  reflect: { label: 'REFLECT', w: 60, get: (s) => pct(s.reflect ?? 0) },
  shadow: { label: 'SHADOW', w: 56, get: (s) => pct(s.chargeChance ?? 0, 1) },
  chance: { label: 'CHANCE', w: 56, get: (s) => pct(s.chargeChance ?? 0) },
  effect: { label: 'EFFECT', w: 56, get: (s) => pct(s.chargeEffect ?? 1) },
  petDamage: { label: 'PET DAMAGE', w: 80, get: (s) => `+${pct(s.petDamage ?? 0)}` },
  petHaste: { label: 'PET HASTE', w: 74, get: (s) => `+${pct(s.petHaste ?? 0)}` },
  petSpeed: { label: 'PET SPEED', w: 74, get: (s) => `+${pct(s.petSpeed ?? 0)}` },
  swap: { label: 'SWAP', w: 46, get: (s) => secs(s.cooldown) },
  proc: { label: 'CHANCE', w: 56, get: (s) => pct(s.procChance ?? 0) },
} satisfies Record<string, Col>;
const COLUMNS: Record<Targeting, Col[]> = {
  nearest: [C.damage, C.cooldown, C.count, C.pierce, C.area, C.speed, C.range, C.knockback, C.ret],
  random: [C.damage, C.cooldown, C.count, C.pierce, C.area, C.speed, C.knockback, C.ret],
  facing: [C.damage, C.cooldown, C.count, C.area, C.arc, C.knockback],
  orbit: [C.damage, C.cooldown, C.count, C.area, C.speed, C.range, C.knockback],
  aura: [C.damage, C.cooldown, C.area, C.knockback],
  stab: [C.damage, C.cooldown, C.reach, C.width, C.count, C.knockback],
  breath: [C.damage, C.cooldown, C.reach, C.arc, C.knockback],
  strike: [C.damage, C.cooldown, C.bolts, C.radius, C.range, C.knockback],
  shield: [C.recharge, C.absorbs, C.reflect, C.knockback],
  bomb: [C.damage, C.cooldown, C.count, C.radius, C.speed, C.range, C.knockback],
  field: [C.cooldown, C.fields, C.radius, C.duration, C.slow, C.range],
  passive: [C.crit, C.critRefund, C.fastest],
  beam: [C.damage, C.size, C.lifetime, C.knockback],
  wave: [C.damage, C.cooldown, C.count, C.pierce, C.length, C.speed, C.area, C.knockback],
  spin: [C.damage, C.cooldown, C.radius, C.knockback],
  flicker: [C.damage, C.cooldown, C.shadow, C.knockback],
  infusion: [C.chance, C.effect],
  seeker: [C.damage, C.cooldown, C.size, C.speed, C.range, C.knockback],
  petbuff: [C.petDamage, C.petHaste, C.petSpeed],
  armory: [C.swap],
  followup: [C.damage, C.proc, C.count, C.pierce, C.area, C.speed, C.knockback],
};

// ------------------------------------------------------------------ pages

/**
 * Columns for one weapon: its targeting type's (blast-on-hit projectiles show their blast RADIUS, like bombs, with
 * no pierce), plus REPEATS when any level repeats the attack.
 */
function weaponColumns(def: WeaponDef): Col[] {
  const cols = def.blastOnHit ? [...COLUMNS.bomb] : [...COLUMNS[def.targeting]];
  for (let lv = 1; lv <= MAX_LEVEL; lv++) {
    if ((weaponStatsAt(def, lv).repeat ?? 0) > 0) {
      cols.push(C.repeats);
      break;
    }
  }
  return cols;
}

function weaponsPage(filter: string): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Weapons fire on their own. Each character has its own ${MAX_WEAPONS} weapons (see CHARACTERS) and starts with one; level-up cards only offer your character's weapons. Each goes up to level ${MAX_LEVEL}. Values below are before your DAMAGE, COOLDOWN, ABILITY HASTE and AREA stats and before modifications.`,
    },
    {
      t: 'p',
      text: 'Percent changes add up over levels: four +15% levels are +60%, and four times 40% faster is 160% faster (the cooldown is divided by 2.6). TAGS decide which modifications change a weapon (see MODS). REPEATS: the attack is done again that many times right after each one, a moment apart (squeezed so all repeats land before the next attack).',
      color: COLOR.textDim,
    },
  ];
  for (const c of CHARACTERS) {
    if (!shows(filter, c.name)) continue;
    out.push({ t: 'gap', h: 4 });
    out.push({ t: 'h', text: `${c.name.toUpperCase()}'S WEAPONS` });
    for (const def of c.weapons.map(weaponDef)) {
      out.push({ t: 'gap', h: 4 });
      const start = def.id === c.startingWeapon ? ' · STARTING WEAPON' : '';
      out.push({ t: 'entry', icon: def.icon, title: def.name, sub: `${def.targeting.toUpperCase()}${start} · TAGS: ${weaponTags(def)} · ${def.description}` });
      out.push({ t: 'p', text: TARGETING_NOTES[def.targeting], color: COLOR.textDim });
      if (def.blastOnHit) {
        out.push({
          t: 'p',
          text: `The projectile deals no damage itself and never pierces: every enemy it touches sets off a blast that hits everything within RADIUS px (scaled by AREA). Projectiles from Splits, and every enemy a chaining projectile reaches, set off a blast too. ${def.damageTags ? `Only ${tagList(def.damageTags)} modifications add to the blast's damage.` : ''}`,
          color: COLOR.textDim,
        });
      }
      if (def.burst) out.push({ t: 'p', text: burstText(def), color: COLOR.textDim });
      if (def.shadow) {
        out.push({
          t: 'p',
          text: `SHADOW CHARGES: you hold up to ${def.shadow.max}. Besides SHADOW per enemy reached, every enemy a strike, its splash or its echo kills has another ${pct(def.shadow.onKill)} chance to give one. Every ${secs(def.shadow.check)} one is spent on another Flicker Strike (when an enemy is on screen), whatever the cooldown, which keeps counting. Those strikes are attacks too: Ruthless counts them and Multistrike's chance can repeat them.`,
          color: COLOR.textDim,
        });
      }
      if (def.strikeTime) {
        out.push({
          t: 'p',
          text: `ONE STRIKE AT A TIME: each strike takes ${secs(def.strikeTime)}. Strikes that come up meanwhile wait their turn in this order: the cooldown's strike first, then Multistrike repeats, then Shadow Charge strikes. The cooldown's strike brings Multistrike's sure repeats, any strike may bring one more by chance, and repeats never spend a Shadow Charge. While you are mist (Mistwalker) nothing strikes and no charge is spent.`,
          color: COLOR.textDim,
        });
      }
      if (def.charges) {
        const ch = def.charges;
        out.push({
          t: 'p',
          text: `CHARGES last ${secs(ch.duration)} each, up to ${ch.max} of each kind (a new one past that replaces the oldest). BRUTAL: ${pct(ch.brutal, 1)} chance per charge that a hit deals double damage (not a critical strike). SIPHONING: ${pct(ch.siphon)} of damage dealt healed per charge (life steal). VICISSITUDE: the next damage you take is ${pct(ch.vicissitude)} lower, using up one charge. All before EFFECT.`,
          color: COLOR.textDim,
        });
      }
      if (def.effect) out.push({ t: 'p', text: effectText(def), color: COLOR.textDim });
      if (def.transferOnDeath) {
        out.push({
          t: 'p',
          text: 'An enemy that dies on one of these fields hands every stack it carries (Shock and any other, from anyone) to the closest enemy on your screen, with the time each has left. Virulent Chain does not move them again.',
          color: COLOR.textDim,
        });
      }
      if (def.detonate) out.push({ t: 'p', text: detonateText(def), color: COLOR.textDim });
      const cols = weaponColumns(def);
      const rows: Cell[][] = [];
      for (let lv = 1; lv <= MAX_LEVEL; lv++) {
        const s: WeaponStats = weaponStatsAt(def, lv);
        rows.push([`LV ${lv}`, ...cols.map((col) => col.get(s))]);
      }
      out.push({ t: 'table', cols: [{ label: '', w: 40 }, ...cols.map(({ label, w }) => ({ label, w }))], rows });
      def.levels.forEach((l, i) => out.push({ t: 'p', text: `LV ${i + 2}: ${l.text}` }));
      if (def.gear) out.push(...gearBlocks(def));
    }
  }
  return out;
}

/** An armory's gear: what each piece does and its stats at every level of the armory (before pet bonuses). */
function gearBlocks(def: WeaponDef): Block[] {
  const out: Block[] = [{ t: 'h', text: 'GEAR' }];
  for (const g of def.gear ?? []) {
    out.push({ t: 'entry', icon: g.icon, title: g.name, sub: g.description });
    const ranged = g.targeting === 'nearest';
    const cols = ranged ? [C.damage, C.cooldown, C.pierce, C.speed, C.range, C.knockback] : [C.damage, C.cooldown, C.reach, C.knockback];
    const rows: Cell[][] = [];
    for (let lv = 1; lv <= MAX_LEVEL; lv++) rows.push([`LV ${lv}`, ...cols.map((col) => col.get(weaponStatsAt(g, lv)))]);
    out.push({ t: 'table', cols: [{ label: '', w: 40 }, ...cols.map(({ label, w }) => ({ label, w }))], rows });
  }
  return out;
}

/** A weapon's (or Plunder's) damage-over-time effect: what puts a stack on, its numbers and what scales them. */
function effectText(def: WeaponDef): string {
  const fx = def.effect!;
  const name = fx.name ? fx.name.toUpperCase() : 'EFFECT';
  const source =
    def.targeting === 'field' ? `every check of a field (every ${secs(def.fieldInterval ?? 1)})` : def.targeting === 'passive' ? 'every hit you land' : 'each hit';
  const again = fx.stacks ? 'Stacks: every application adds a stack with its own time.' : 'Hitting again refreshes it.';
  const cap = fx.maxStacks !== undefined ? ` Up to ${fx.maxStacks} stacks of it per enemy.` : '';
  const only = def.damageTags ? ` Only ${tagList(def.damageTags)} modifications add to its damage (besides DOT modifications' own damage-over-time bonuses).` : '';
  return `${name}: ${source} leaves a stack dealing ${num(fx.damage)} damage every ${secs(fx.interval)} for ${secs(fx.duration)}. ${again}${cap}${only}`;
}

/** What a weapon with `detonate` sets off on every hit. */
function detonateText(def: WeaponDef): string {
  const d = def.detonate!;
  const thrown = hitsWithProjectiles(def);
  const which = thrown ? 'Every hit of it (its splits and bounces too)' : 'Every hit of it';
  const own = thrown ? 'levels, modifications, the less damage of splits and bounces' : 'levels, modifications, Ruthless';
  return `${which} sets off the enemy's ${d.effect.toUpperCase()} stacks: the enemy takes ${pct(d.share)} of the damage all of them would still deal in the time they have left, at once. That is damage over time: no Plunder stack, no thorns, and it gets through a bubble (see RARE). The stacks stay. Its own damage bonuses (${own}) scale it; your DAMAGE does not again, since the stacks already have it.`;
}

/** How a weapon fires its extra projectiles one after another (BurstDef). */
function burstText(def: WeaponDef): string {
  const b = def.burst!;
  const when =
    b.spacing === 'end'
      ? `the extra ones follow evenly so the last leaves exactly at ${pct(b.window)} of the cooldown`
      : `they are spread evenly over ${pct(b.window)} of the cooldown (with n projectiles, one every ${pct(b.window)} / n of it)`;
  const aim = b.target === 'random' ? 'each of the others at a random enemy on your screen' : 'each of the others at the closest enemy when it leaves';
  return `With more than one projectile (COUNT, or Additional Projectiles) they are fired one at a time instead of in a spread: ${when}, after ABILITY HASTE. The first goes at the closest enemy, ${aim}.`;
}

/** What a passive does, with every number from the data. */
function passiveText(d: PassiveDef): string {
  switch (d.kind) {
    case 'dodge':
      return `Every hit you take (not damage over time) has a ${pct(d.chance)} chance to be dodged: it does nothing and DODGE shows. The enemy that missed still has to wait ${secs(ENEMY_HIT_COOLDOWN)} to try again. It comes before Aegis, so a dodged hit keeps your Aegis.`;
    case 'rebirth':
      return `On reaching 0 HP you stand right back up with ${pct(d.hp)} of your max HP instead of falling, invulnerable for ${secs(REVIVE.invulnSeconds)} as after a co-op revive. A banner tells everyone to put a random other player in the bin (${d.fallback.toUpperCase()} when nobody else is in the run). Once every ${d.cooldown}S; it is not a death, so it costs no team death in co-op.`;
    case 'growth':
      return `Every ${d.every}S of the run (fallen or not) you gain a stack for the rest of the run. Each stack: ${d.perStack.map((m) => bonusText(m, 1)).join(', ')}. Stacks add up with items and powerups like any other bonus (see ITEMS).`;
    case 'reprieve':
      return `When damage (damage over time included) would leave you below ${pct(d.below)} of your max HP, it is not taken: you heal ${pct(d.heal)} of your max HP over ${secs(d.over)} instead. Once every ${d.cooldown}S.`;
    case 'pets': {
      const a = d.attack.stats;
      return `You start with ${d.start} pets and gain another every ${d.every}S of the run, up to ${d.max}. Pets cannot be hurt and do not block enemies. They wait around you, run at ${d.speed} px/s after enemies within ${d.aggro} px of you (spreading out over several), give up on one that gets further than ${d.leash} px from you, and come running back when you get away. A pet that reaches its enemy headbutts it for ${num(a.damage)} damage every ${secs(a.cooldown)} (${num(a.knockback)} knockback), unless it carries gear (Bunny Armory). Pet damage scales with your DAMAGE and can be a critical strike; modifications do not change pets. Falling sends your pets away until you are back up.`;
    }
    case 'ailment':
      return `Every hit you land with any weapon (Impact splashes and echoes too; not damage over time) puts a stack on the enemy. ${effectText(d.attack)} It is tagged ${weaponTags(d.attack)}: DOT and DURATION modifications are offered from the start and change these stacks (Increase Duration makes them last longer, Less Duration hit harder, Reiterate copies them). Its damage scales with your DAMAGE and shows as PLUNDER on the party screen.`;
  }
}

function charactersPage(filter: string): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Pick who you play as on the character select screen (SOLO), or with CHARACTER in the co-op lobby. Each character has its own weapon kit, ultimate and passive. Items, modifications, powerups and base stats are shared (see ITEMS, MODS and POWERUPS), and several players may pick the same character.`,
    },
    {
      t: 'p',
      text: 'PASSIVES are always on. The box under your ultimate shows yours: green edge when it is ready, greyed out with the seconds left while it recharges. Under it, a gold line lists what is running on you: Aegis, Shadow Charges, Unstable Infusion charges and Mistwalker\'s damage.',
      color: COLOR.textDim,
    },
    { t: 'h', text: 'ULTIMATES (Q)' },
    {
      t: 'p',
      text: 'Press Q to cast your ultimate. Its cooldown starts when you cast it and is not shortened by COOLDOWN; its damage scales with DAMAGE and its projectiles with AREA. Falling ends a running ultimate early (the cooldown keeps going). The box under your build shows it: green edge when ready, gold with a bar while it runs, greyed out with the seconds left while it recharges. Teammates are shown the same way in the list below it.',
    },
  ];
  for (const c of CHARACTERS) {
    if (!shows(filter, c.name)) continue;
    const ult = ultimateDef(c.ultimate);
    const a = ult.attack.stats;
    out.push({ t: 'gap', h: 8 });
    out.push({ t: 'entry', icon: c.firstFrame, title: c.name, sub: `${c.title} · ${c.description}`, scale: 2 });
    out.push({
      t: 'p',
      text: `STARTS WITH ${weaponDef(c.startingWeapon).name.toUpperCase()}. KIT: ${c.weapons.map((id) => weaponDef(id).name.toUpperCase()).join(', ')}.`,
    });
    if (c.passive) {
      const pd = passiveDef(c.passive);
      out.push({ t: 'entry', icon: pd.icon, title: `PASSIVE: ${pd.name}`, sub: pd.description });
      out.push({ t: 'p', text: passiveText(pd), color: COLOR.textDim });
    }
    out.push({ t: 'entry', icon: ult.icon, title: `ULTIMATE: ${ult.name}`, sub: ult.description });
    const how =
      ult.kind === 'storm'
        ? `Every ${secs(ult.interval)} for ${ult.duration}S, ${ult.count} projectiles fly out from you in a spiral that turns ${ult.spin} degrees per second.`
        : ult.kind === 'pet'
          ? `For ${ult.duration}S a pet follows you and every ${secs(ult.interval)} fires at the closest enemy within ${a.range} px of it.`
          : ult.kind === 'giant'
            ? `For ${ult.duration}S a giant pet, ${ult.scale ?? 1} times as large, joins your pets. It gets every bonus your pets get (Carrot Rations, its own piece of gear from Bunny Armory), deals ${ult.power ?? 1} times their damage and runs ${pct((ult.speedMult ?? 1) - 1)} faster. Besides what a pet does, every ${secs(a.cooldown)} it stomps the enemy it reaches: everything within ${num(a.size)} px of that enemy (scaled by AREA) takes ${num(a.damage)} damage (before the ${ult.power ?? 1} times) and ${num(a.knockback)} knockback.`
          : ult.kind === 'detonate'
            ? `Instant: the screen flashes and every enemy carrying ${(ult.attack.detonate?.effect ?? '').toUpperCase()} takes ${pct(ult.attack.detonate?.share ?? 0)} of the damage its stacks would still deal in the time they have left, at once, as damage over time (it gets through a bubble). The stacks stay and keep ticking. It is tagged NONE: modifications do not change it; how strong your stacks are does.`
          : ult.kind === 'mist'
            ? `For ${ult.duration}S you turn to mist: no weapon of yours attacks (cooldowns keep counting), nothing can hurt you, and enemies and bosses ignore you (playing alone, the horde stands still). When it lifts, ${pct(ult.amp ?? 0)} is added to your DAMAGE for ${ult.after ?? 0}S. It is tagged ${tagList(ult.attack.tags)}: duration modifications stretch both the mist and the bonus, Less Duration's damage bonus raises the bonus, and Reiterate may add a second bonus as it starts.`
            : `For ${ult.duration}S a dome of ${ult.radius} px radius stands where you cast it. Every ${secs(ult.interval)} a beam crosses it in a random straight line, lingering for ${secs(a.lifetime)} and hitting every enemy that touches it once (${num(a.size * 2)} px wide). While your projectiles are inside, the edge works like an enemy they can split on, but they use up no pierce or bounces and deal no damage there; they ricochet toward the closest enemy inside the dome they have not hit (straight back when there is none). The beams are tagged ${tagList(ult.attack.tags)}: area modifications widen them, duration modifications make them linger, and Echo Strike, Reduced AoE and Less Duration work on them. Reiterate does not, since the beams leave no stacks. The dome itself keeps its size and length.`;
    out.push({ t: 'p', text: how, color: COLOR.textDim });
    if (ult.kind === 'detonate') {
      out.push({
        t: 'table',
        cols: [
          { label: 'COOLDOWN', w: 70 },
          { label: 'SETS OFF', w: 70 },
        ],
        rows: [[`${ult.cooldown}S`, pct(ult.attack.detonate?.share ?? 0)]],
      });
      continue;
    }
    if (ult.kind === 'mist') {
      out.push({
        t: 'table',
        cols: [
          { label: 'MIST', w: 60 },
          { label: 'COOLDOWN', w: 70 },
          { label: 'DAMAGE AFTER', w: 96 },
          { label: 'FOR', w: 50 },
        ],
        rows: [[`${ult.duration}S`, `${ult.cooldown}S`, `+${pct(ult.amp ?? 0)}`, `${ult.after ?? 0}S`]],
      });
      continue;
    }
    if (ult.kind === 'giant') {
      out.push({
        t: 'table',
        cols: [
          { label: 'DURATION', w: 70 },
          { label: 'COOLDOWN', w: 70 },
          { label: 'SIZE', w: 40 },
          { label: 'POWER', w: 50 },
          { label: 'STOMP', w: 50 },
          { label: 'EVERY', w: 50 },
          { label: 'RADIUS', w: 54 },
          { label: 'KNOCKBACK', w: 80 },
        ],
        rows: [[`${ult.duration}S`, `${ult.cooldown}S`, `X${ult.scale ?? 1}`, `X${ult.power ?? 1}`, num(a.damage), secs(a.cooldown), num(a.size), num(a.knockback)]],
      });
      continue;
    }
    if (ult.kind === 'dome') {
      out.push({
        t: 'table',
        cols: [
          { label: 'DURATION', w: 70 },
          { label: 'COOLDOWN', w: 70 },
          { label: 'RADIUS', w: 54 },
          { label: 'BEAMS', w: 50 },
          { label: 'DAMAGE', w: 58 },
          { label: 'LINGER', w: 56 },
          { label: 'WIDTH', w: 50 },
          { label: 'KNOCKBACK', w: 80 },
        ],
        rows: [[`${ult.duration}S`, `${ult.cooldown}S`, num(ult.radius ?? 0), `${ult.count} / ${secs(ult.interval)}`, num(a.damage), secs(a.lifetime), num(a.size * 2), num(a.knockback)]],
      });
      continue;
    }
    out.push({
      t: 'table',
      cols: [
        { label: 'DURATION', w: 70 },
        { label: 'COOLDOWN', w: 70 },
        { label: 'DAMAGE', w: 58 },
        { label: 'PIERCE', w: 54 },
        { label: 'SPEED', w: 50 },
        { label: 'LIFETIME', w: 66 },
        { label: 'SIZE', w: 40 },
        { label: 'KNOCKBACK', w: 80 },
      ],
      rows: [[`${ult.duration}S`, `${ult.cooldown}S`, num(a.damage), num(a.pierce), num(a.speed), secs(a.lifetime), num(a.size), num(a.knockback)]],
    });
  }
  return out;
}

/** One stat modifier taken `lv` times, e.g. "+10 ABILITY HASTE" or "-2% DAMAGE TAKEN". */
function bonusText(m: StatModifier, lv: number): string {
  const parts: string[] = [];
  if (m.flat) parts.push(isPercentStat(m.stat) ? `+${pct(m.flat * lv, m.stat === 'regenPercent' ? 1 : 0)}` : `${m.flat * lv >= 0 ? '+' : ''}${num(m.flat * lv)}`);
  if (m.percent) parts.push(signedPct(m.percent * lv));
  return `${parts.join(' ')} ${STAT_LABELS[m.stat]}`;
}

/** One row per level shown: the total bonus of an item or powerup and the stats it gives from base. */
function statRows(def: ItemDef, levels: number[]): Cell[][] {
  return levels.map((lv) => {
    const stats = computeStats([{ def, level: lv }]);
    const bonus = def.perLevel.map((m) => bonusText(m, lv)).join(', ');
    const result = def.perLevel
      .map((m) => {
        const v = `${STAT_LABELS[m.stat]} ${statValue(m.stat, stats[m.stat])}`;
        return m.stat === 'abilityHaste' ? `${v} (COOLDOWNS -${pct(1 - hasteFactor(stats.abilityHaste), 1)})` : v;
      })
      .join(', ');
    return [`LV ${lv}`, bonus, { text: result, color: COLOR.gold }];
  });
}

const STAT_COLS = [
  { label: '', w: 40 },
  { label: 'TOTAL BONUS', w: 220 },
  { label: 'RESULT (FROM BASE)', w: 300 },
];

function itemsPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Items raise your stats. You can hold ${MAX_ITEMS} items; each goes up to level ${MAX_LEVEL}. Final stat = (base + flat bonuses) × (1 + percent bonuses), added up over every item and powerup level (see POWERUPS).`,
    },
  ];
  for (const def of ITEMS) {
    out.push({ t: 'gap', h: 6 });
    out.push({ t: 'entry', icon: def.icon, title: def.name, sub: def.description });
    const levels = Array.from({ length: itemMaxLevel(def) }, (_, i) => i + 1);
    out.push({ t: 'table', cols: STAT_COLS, rows: statRows(def, levels) });
  }
  out.push({ t: 'gap', h: 8 });
  out.push({ t: 'h', text: 'BASE STATS (EVERY CHARACTER)' });
  out.push({
    t: 'table',
    cols: [
      { label: 'STAT', w: 130 },
      { label: 'BASE', w: 60 },
      { label: 'NOTES', w: 410 },
    ],
    rows: (Object.keys(BASE_STATS) as StatKey[]).map((k) => [STAT_LABELS[k], { text: statValue(k, BASE_STATS[k]), color: COLOR.gold }, STAT_NOTES[k]]),
  });
  return out;
}

function powerupsPage(filter: string): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Generic powerups are plain stat boosts. They take no slots and each goes up to level ${POWERUP_MAX_LEVEL}, so they keep showing up on cards after your slots are full. They add to the same stats as items: (base + flat bonuses) × (1 + percent bonuses), added up over every item and powerup level. Base values are on the ITEMS page.`,
    },
  ];
  for (const def of POWERUPS) {
    if (!shows(filter, def.name)) continue;
    out.push({ t: 'gap', h: 6 });
    out.push({ t: 'entry', icon: def.icon, title: def.name, sub: def.description });
    if (def.requiresTag) {
      out.push({ t: 'p', text: `Only offered while you own a ${TAG_LABELS[def.requiresTag]} weapon (see WEAPONS).`, color: COLOR.textDim });
    }
    const max = itemMaxLevel(def);
    const levels = [1, 5, 10, 15, max].filter((lv, i, a) => lv <= max && a.indexOf(lv) === i);
    out.push({ t: 'table', cols: STAT_COLS, rows: statRows(def, levels) });
  }
  return out;
}

/** Non-zero totals of a modification, e.g. "+2 PIERCE, +30% DAMAGE". */
function modSummary(e: Required<ModEffect>): string {
  const parts: string[] = [];
  if (e.pierce) parts.push(`+${num(e.pierce)} PIERCE`);
  if (e.projectiles) parts.push(`+${num(e.projectiles)} PROJECTILE${e.projectiles === 1 ? '' : 'S'}`);
  if (e.projectileLess) parts.push(`${pct(e.projectileLess)} LESS DAMAGE`);
  if (e.hitLess) parts.push(`${pct(e.hitLess)} LESS ON HIT`);
  if (e.dotRate) parts.push(`TICKS ${pct(e.dotRate)} SOONER`);
  if (e.dotDamage) parts.push(`${signedPct(e.dotDamage)} DOT DAMAGE`);
  if (e.dotLess) parts.push(`${pct(e.dotLess)} LESS DOT DAMAGE`);
  if (e.dotDuration) parts.push(`${signedPct(e.dotDuration)} DOT DURATION`);
  if (e.virulent) parts.push(`STACKS MOVE TO ${num(e.virulent)} ON DEATH`);
  if (e.split) parts.push(`SPLITS INTO ${num(e.split)} (${pct(e.splitLess)} LESS)`);
  if (e.splitAgain) parts.push(`${pct(e.splitAgain)} TO SPLIT AGAIN`);
  if (e.chain) parts.push(`+${num(e.chain)} BOUNCE${e.chain === 1 ? '' : 'S'} (${pct(e.chainLess)} LESS EACH)`);
  if (e.chainSpeed) parts.push(`${signedPct(e.chainSpeed)} BOUNCE SPEED`);
  if (e.multistrike) parts.push(`+${num(e.multistrike)} ATTACK${e.multistrike === 1 ? '' : 'S'}`);
  if (e.repeatChance) parts.push(`${pct(e.repeatChance)} TO REPEAT`);
  if (e.stunChance) parts.push(`${pct(e.stunChance)} STUN, +${pct(e.stunBonus)} TAKEN`);
  if (e.momentum) parts.push(`${pct(e.momentum)} OF SPEED AS DAMAGE`);
  if (e.impact) parts.push(`SPLASH ${pct(e.impact)} OF THE HIT`);
  if (e.ruthless) parts.push(`+${pct(e.ruthless)} EVERY ${RUTHLESS_EVERY}RD ATTACK`);
  if (e.area) parts.push(`${signedPct(e.area)} AREA`);
  if (e.echo) parts.push(`ECHO ${pct(e.echo)} OF THE HIT`);
  if (e.echoArea) parts.push(`${signedPct(e.echoArea)} ECHO AREA`);
  if (e.echoRepeats > 1) parts.push(`${num(e.echoRepeats)} ECHOES ${secs(ECHO_GAP)} APART`);
  if (e.duration) parts.push(`${signedPct(e.duration)} DURATION`);
  if (e.reiterate) parts.push(`${pct(e.reiterate)} REITERATE`);
  if (e.damage) parts.push(`${signedPct(e.damage)} DAMAGE`);
  return parts.join(', ');
}

/** Worked example for the AREA rule, from the current numbers (Howler Aura at max level, 2 Increased AoE, 1 Reduced AoE). */
function areaExample(): string {
  const howl = weaponLevelAt(weaponDef('howl'), MAX_LEVEL).pct.size ?? 0;
  const more = MODIFICATIONS.find((m) => m.id === 'more_area');
  const less = MODIFICATIONS.find((m) => m.id === 'less_area');
  if (!more || !less) return '';
  const inc = modEffectAt(more, 2).area;
  const red = modEffectAt(less, 1).area;
  const total = 1 + howl + inc + red;
  return `Howler Aura at level ${MAX_LEVEL} (${signedPct(howl)}) with 2 levels of Increased AoE (${signedPct(inc)}) and 1 of Reduced AoE (${signedPct(red)}) has ${pct(total)} of its base radius.`;
}

/** MODS filters: everything, only the rules text, or the modifications carrying one tag. */
const MOD_FILTERS = ['ALL', 'RULES', 'PROJECTILE', 'AOE', 'DURATION', 'MELEE', 'DOT'];

function modsPage(filter: string): Block[] {
  const rules: Block[] = [
    {
      t: 'p',
      text: `Modifications change every weapon that shares one of their tags (PROJECTILE, AOE, DURATION, MELEE or DOT; each weapon's tags are on the WEAPONS page), as far as the weapon has a use for them: CHANGES under each one lists what it really does. Ultimates and Plunder have tags too (see CHARACTERS). A weapon whose effect deals damage over time is DOT even when not tagged so, and every DOT weapon is DURATION too. Each goes up to level ${MAX_LEVEL} and takes no slot. A modification is offered once you own a weapon, or have an ultimate or passive, it changes; after you take it, its upgrades keep being offered.`,
    },
    { t: 'h', text: 'PROJECTILES' },
    {
      t: 'p',
      text: `On hitting an enemy a projectile first splits if it still can: it is replaced by its splits, which fan out over ${SPLIT_ARC} degrees from where it was going, skip the enemies it already hit, start with full pierce and bounces, and deal less damage than it did (Splits' level). Splits never split again, except that at Splits level 5 each projectile from a first split has a chance to split one more time. Otherwise the projectile uses up 1 pierce. Once pierce runs out it chains: it flies to the closest enemy within ${CHAIN_RANGE} px that it has not hit yet (a random direction when there is none), using up 1 bounce per hit. A bounce flies at ${num(CHAIN_SPEED)} × the weapon's speed (more with Chain's speed bonus) and every bounce deals less damage than the hit before it. Projectiles that never hit anything on the way (Coconuts) cannot split or chain; of Pierce they only get the damage bonus. Crystalline Bloom's crystal never pierces and deals no damage itself, so Pierce does nothing for it; Splits and Chain do, and every enemy its crystals touch sets off a blast. Iaijutsu's wave uses no pierce until it reaches the enemy it was aimed at; from there it splits, pierces and chains like any projectile. Additional Projectiles adds to COUNT: spread weapons fan the extra projectiles out, Coconuts, Hailing Arrows and Midnight Tumult fire them one after another, Iaijutsu sends them at random enemies in reach. In exchange every weapon it changes deals less damage (a multiplier, smaller at higher levels), its blasts too. At most ${MAX_PROJECTILES} projectiles fly at once; splits past that are lost.`,
    },
    { t: 'h', text: 'AREA' },
    {
      t: 'p',
      text: `Area bonuses add up: a weapon's own size levels, the AREA stat and area modifications go into one sum. ${areaExample()} Area modifications change only the area part of a weapon: the reach of sweeps, stabs and breaths, the radius of auras, strikes, blasts and freezing fields, the width of beams, the size of orbiting objects, and Impact splashes.`,
    },
    {
      t: 'p',
      text: `Echo Strike: every enemy an AOE weapon hits sends out an echo with a ${ECHO_RADIUS} px radius (scaled by the AREA stat, area modifications and Echo Strike's own area bonus, not by the weapon's size levels). It deals a share of the hit to everything inside, the enemy that was hit included. Echo damage never echoes again. Echoes landing on the same enemy in the same frame count as one hit. Areas that deal no damage themselves (freezing fields) never echo.`,
    },
    { t: 'h', text: 'DURATION' },
    {
      t: 'p',
      text: `Duration weapons leave a stack on every enemy they hit (or, for fields, on every enemy on the field at each check) that deals damage each tick until it runs out; hitting again refreshes it, unless the effect stacks (Rime Trauma, Shock), when every application adds a stack. Duration modifications also stretch how long fields and beams last. Reiterate: when a stack is applied or deals damage it may copy itself with the time it has left. Copies tick and reiterate too, but are never refreshed. At most ${MAX_EFFECT_STACKS} stacks of one weapon sit on one enemy (Shock has its own cap, see WEAPONS). Some duration abilities put their effect on you instead: Storm Shield's Aegis (duration modifications change how fast it comes back, Reiterate may add a second Aegis) and Mistwalker (see CHARACTERS).`,
    },
    { t: 'h', text: 'DAMAGE OVER TIME' },
    {
      t: 'p',
      text: `Damage over time is the ticking of stacks (Rime Trauma, Shock) and what sets them off at once (Midnight Tumult, Caressing Moonlight, Twilight Trill). It is not a hit: it applies no stacks and no follow-up shots, Thorns and Crystalline do not answer it, and a bubble (see RARE) does not stop it; hexproof enemies take no stacks at all. The ticks of one weapon's stacks on one enemy in one frame land as one number. Every stack keeps the bonuses of the weapon that put it on, so Shock from Vulnerability gets Vulnerability's AOE and DURATION bonuses and Shock from Plunder gets Plunder's. DOT modifications change every damage-over-time weapon: DEADLY AILMENTS makes their hits (if they hit at all) deal less and their damage over time more; SADISM makes stacks tick sooner (they last as long, so they tick more often) and harder; VIRULENT CHAIN makes stacks move on when their enemy dies, to the closest enemy however far away (the two closest at level 5, each getting a copy), keeping the time they have left; a blob of ink flies to each, at the cost of less damage over time. DOT damage bonuses add up with the weapon's other damage bonuses; LESS DAMAGE multiplies.`,
    },
    { t: 'h', text: 'MELEE' },
    {
      t: 'p',
      text: `MULTISTRIKE: every attack of a melee weapon is done again right away (${secs(MULTISTRIKE_GAP)} apart, or the weapon's own repeat delay, squeezed so the sure ones land before the next attack; Flicker Strike queues them, see WEAPONS), and any attack, repeats included, may be repeated once more by chance. Repeats ignore the cooldown and count as attacks of their own. Shields have no attack to repeat. STUN: a stunned enemy stands still and takes more damage from everyone for ${secs(STUN_SECONDS)}, longer by the share of its max HP the hit took (a hit taking 15% of it stuns 15% longer). Stunned enemies are tinted yellow; bosses and enemies that ignore debuffs are never stunned. MOMENTUM: adds a share of your move speed right now to each hit's base damage (none while standing still; Flicker Strike counts as standing still). IMPACT: every melee hit also splashes a share of its damage on everything else within ${IMPACT_RADIUS} px of the enemy hit (scaled by AREA). With Impact, AoE modifications are offered for melee weapons and change only the splash: area modifications its radius, Echo Strike makes it echo, and their damage bonus adds to it (weapons that are AOE already have it in the hit). Splash from one weapon on one enemy in one frame counts as one hit; splashes never splash again. RUTHLESS: every ${RUTHLESS_EVERY}rd attack of a weapon (repeats and Shadow Charge strikes count) adds its bonus to the damage sum.`,
    },
    { t: 'h', text: 'DAMAGE' },
    {
      t: 'p',
      text: "Damage bonuses add up: a weapon's own damage levels and the damage bonus of every modification that changes it go into one sum. Coconuts is tagged PROJECTILE and AOE, so Pierce and Reduced AoE both count. Some weapons deal damage with one part only: Crystalline Bloom's blast only takes AOE damage bonuses, Rime Trauma only DURATION ones (and DOT modifications' damage-over-time bonuses). That sum is then multiplied by your DAMAGE stat (the Damage powerup, +5% per level, also added up, plus Dragonborn and Mistwalker) and by the LESS DAMAGE of Additional Projectiles, Deadly Ailments (hits only) and Virulent Chain (damage over time only).",
    },
  ];
  if (filter === 'RULES') return rules;
  const out: Block[] = filter === 'ALL' ? rules : [rules[0]];
  const weapons = CHARACTERS.flatMap((c) => {
    const pd = c.passive ? passiveDef(c.passive) : null;
    return [...c.weapons.map(weaponDef), ultimateDef(c.ultimate).attack, ...(pd?.kind === 'ailment' ? [pd.attack] : [])];
  });
  for (const def of MODIFICATIONS) {
    if (filter !== 'ALL' && !def.tags.some((t) => TAG_LABELS[t] === filter)) continue;
    out.push({ t: 'gap', h: 6 });
    out.push({ t: 'entry', icon: def.icon, title: def.name, sub: `TAGS: ${tagList(def.tags)} · ${def.description}` });
    // Sharing a tag is not always enough: a weapon only listed for what the modification really does for it.
    const changes = weapons.flatMap((w) => {
      const reach = modReach(w, def, true);
      if (reach === 'none') return [];
      const note =
        reach === 'damage only'
          ? ' (DAMAGE ONLY)'
          : reach === 'no damage'
            ? ' (NO DAMAGE BONUS)'
            : reach === 'splash'
              ? ' (SPLASH, WITH IMPACT)'
              : '';
      return [`${w.name.toUpperCase()}${note}`];
    });
    out.push({
      t: 'p',
      text: changes.length ? `CHANGES: ${changes.join(', ')}.` : 'NO WEAPON USES IT YET, SO IT IS NEVER OFFERED.',
      color: changes.length ? COLOR.textDim : COLOR.bad,
    });
    out.push({
      t: 'table',
      cols: [
        { label: '', w: 40 },
        { label: 'THIS LEVEL', w: 250 },
        { label: 'TOTAL', w: 310 },
      ],
      rows: def.levels.map((l, i) => [`LV ${i + 1}`, l.text, { text: modSummary(modEffectAt(def, i + 1)), color: COLOR.gold }]),
    });
  }
  return out;
}

function monstersPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Enemies walk straight at the nearest living player and hurt them on touch. HP grows ${pct(HP_SCALE_PER_MINUTE)} of base per minute; speed starts at ${pct(SPEED_SCALE_START)} and rises ${pct(SPEED_SCALE_PER_MINUTE, 1)} per minute up to 100%. In co-op HP is also multiplied by the player count (see CO-OP). Any of them can come out rare, with a coloured border and extra powers (see RARE). Bosses and their minions are on the BOSSES page.`,
    },
    { t: 'gap', h: 4 },
  ];
  for (const def of ENEMIES) {
    out.push({ t: 'entry', icon: def.firstFrame, title: def.name, sub: `FIRST SEEN AROUND ${formatTime(def.firstMinute * 60)}` });
  }
  out.push({ t: 'gap', h: 4 });
  out.push({
    t: 'table',
    cols: [
      { label: 'MONSTER', w: 76 },
      { label: 'HP', w: 40 },
      { label: 'SPEED', w: 52 },
      { label: 'DAMAGE', w: 58 },
      { label: 'EXP', w: 36 },
      { label: 'POTION', w: 56 },
      { label: 'KB RESIST', w: 72 },
      { label: 'SIZE', w: 40 },
      { label: 'HP AT 5:00 / 10:00 / 14:00', w: 170 },
    ],
    rows: ENEMIES.map((d) => [
      d.name.toUpperCase(),
      num(d.hp),
      num(d.speed),
      num(d.damage),
      num(d.exp),
      pct(d.potionChance, 1),
      pct(d.knockbackResist),
      num(d.radius),
      [5, 10, 14].map((m) => Math.round(d.hp * hpScaleForMinute(m))).join(' / '),
    ]),
  });
  out.push({
    t: 'p',
    text: 'SPEED is px per second at full speed. DAMAGE is per hit before armor; each monster can hit the same player once every ' +
      `${secs(ENEMY_HIT_COOLDOWN)}, so a crowd hurts as much as it has members touching you. KB RESIST is how much knockback is ignored. SIZE is the collision radius in px.`,
    color: COLOR.textDim,
  });
  return out;
}

/** Rare enemies: what a modifier looks like on the enemy. Players never see modifier names, so the wiki goes by this. */
function rareLook(m: EnemyModifierDef): string {
  switch (m.id) {
    case 'astral_touched':
      return 'VIOLET MOTES';
    case 'invulnerability':
      return 'GOLD RING';
    case 'enrage':
      return 'RED GLOW ONCE HURT';
    case 'caustic_ground':
      return 'ACID DRIPS';
    case 'crystalline':
      return 'CRYSTAL SHARDS';
    case 'empower_allies':
      return 'ORANGE RING';
    case 'thorns':
      return 'SPIKES';
    case 'soul_absorption':
      return 'SOUL WISPS';
    case 'spirit_walker':
      return 'DASHED RING';
    case 'temporal_shield':
      return 'BUBBLE';
    default:
      return 'NO MARK';
  }
}

/** One line per enemy modifier, with every number from the data. "You" is any player, "monsters" its allies. */
function rareText(m: EnemyModifierDef): string {
  switch (m.id) {
    case 'astral_touched': {
      const h = hazardDef(m.hazard);
      const c = ASTRAL_CHAINS;
      return `Every ${secs(m.every)} a void field (${h.radius} px) opens at a random spot within ${m.spread} px of it for ${secs(m.life)}. Standing in one slows you by ${pct(h.slow ?? 0)}, and every ${secs(c.every)} it chains you: each chain slows you ${pct(c.slow)} more for ${secs(c.duration)}, also after you step out (up to ${c.max}, shown at your feet).`;
    }
    case 'invulnerability':
      return `Other monsters within ${m.radius} px cannot drop below 1 HP while it lives (two of these do not protect each other). Kill it first.`;
    case 'enrage':
      return `The more HP it has lost, the harder it hits (up to +${pct(m.damage)} damage), the faster it moves (up to +${pct(m.speed)}) and the less it takes (up to ${pct(m.reduction)} less), all in full at ${pct(m.fullAt)} HP left.`;
    case 'physical_resistant':
      return `Takes ${pct(m.reduction)} less damage.`;
    case 'caustic_ground': {
      const h = hazardDef(m.hazard);
      return `When it dies it leaves caustic ground (${h.radius} px) for ${secs(m.life)}, dealing ${num(m.damage)} every ${secs(m.interval)} to anyone inside. That is damage over time: it ignores invulnerability, gives none, and shields cannot block it.`;
    }
    case 'crystalline':
      return `Every hit you land on it (not damage over time) grows a crystal bud under you that explodes after ${secs(m.charge)} for ${num(m.damage)} to anyone within ${m.radius} px. A circle shows the blast: step out of it.`;
    case 'empower_allies':
      return `Monsters within ${m.radius} px, itself included, get +${pct(m.health)} max HP, +${pct(m.speed)} move speed and +${pct(m.damage)} damage while inside (two of these do not stack).`;
    case 'executioner':
      return `Deals ${pct(m.more)} more damage for every full ${pct(m.per)} of max HP you are missing.`;
    case 'extra_life':
      return `+${pct(m.health)} max HP.`;
    case 'hexproof':
      return 'Duration effects and slows (freezing fields) do nothing to it.';
    case 'thorns':
      return `Every hit you land on it (not damage over time) deals ${num(m.flat)} plus ${pct(m.share)} of the hit back to you, but never takes you below ${pct(m.floor)} of your max HP (the damage is cut to what reaches it).`;
    case 'ambush':
      return `Every ${secs(m.cooldown)} it teleports to ${m.distance} px from the closest player, in a puff of smoke.`;
    case 'soul_absorption':
      return `Gains a soul whenever another monster dies within ${m.radius} px: +${pct(m.damage)} damage and ${num(m.haste)} Ability Haste each (its void fields and teleports come sooner). A wisp per soul circles it (up to ${MAX_SOUL_WISPS} shown).`;
    case 'spirit_walker':
      return `Monsters that die within ${m.radius} px of it, itself included, stand back up once with full HP, see-through. That death gives no EXP or kill, but still leaves acid and feeds souls. See-through monsters stay dead the next time.`;
    case 'blocks_attacks':
      return `${pct(m.chance)} chance to ignore any hit, damage over time included: BLOCK shows instead of a number.`;
    case 'temporal_shield':
      return `Hits from players outside its ${m.radius} px bubble deal ${pct(m.reduction)} less. After ${m.hits} of them the bubble breaks (BREAK shows) for ${secs(m.recharge)} while it recharges; only a faint dashed ring is left. Step inside to hit it in full. Damage over time is not a hit: stacks on it keep ticking (and can be set off) at full damage wherever you are. An enemy has one bubble at most; bubbles never stack.`;
  }
}

function raresPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Every enemy the spawner brings in (waves and bat swarms, not bosses or their minions) can come out rare: it gets extra modifiers, picked at random and all different, and +${pct(RARE_HP_PER_MODIFIER)} of its base HP per modifier. A border in the tier's colour shows how many it has. It drops the same EXP as a normal one.`,
    },
    {
      t: 'table',
      cols: [
        { label: 'MODIFIERS', w: 80 },
        { label: 'CHANCE', w: 60 },
        { label: 'ABOUT 1 IN', w: 80 },
        { label: 'BORDER', w: 60 },
        { label: 'HP BONUS', w: 70 },
      ],
      rows: RARE_TIERS.map((t) => [
        num(t.modifiers),
        pct(t.chance, 1),
        num(Math.round(1 / t.chance)),
        { text: '####', color: t.color },
        `+${pct(t.modifiers * RARE_HP_PER_MODIFIER)}`,
      ]),
    },
    {
      t: 'p',
      text: 'Modifiers that add max HP, move speed or damage add up with each other; damage reductions multiply. What rare enemies do to you hurts like a touch: through armor and shields, and its thorns share one hit timer with its touch (caustic ground is damage over time, see below). A hit they ignore (BLOCK) does nothing: no knockback, no effect, no echo. Their auras reach other monsters too, bosses included. Some modifiers have a look of their own (below); an enemy shows every one it has.',
      color: COLOR.textDim,
    },
    { t: 'h', text: 'MODIFIERS' },
  ];
  for (const m of ENEMY_MODIFIERS) out.push({ t: 'p', text: `${rareLook(m)} · ${rareText(m)}` });
  return out;
}

function wavesPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `The run lasts ${formatTime(RUN_SECONDS)}. Every ${SPAWN_TICK_MS} ms the spawner tops the horde up toward ON FIELD, at most a sixth of it per tick, on a ring just outside a random living player's screen. ON FIELD grows over time and with more players: it is multiplied by (1 + ${pct(SPAWN_SCALE_PER_MINUTE)} per minute) × (1 + ${pct(SPAWN_SCALE_PER_EXTRA_PLAYER)} per extra player), so the horde also refills faster. At most ${MAX_ENEMIES} enemies exist at once. Enemies more than ${DESPAWN_SCREENS} screens away from every player are moved back near one, keeping their HP. Any enemy it brings in may come out rare (see RARE).`,
    },
  ];
  out.push({
    t: 'table',
    cols: [
      { label: 'MINUTES', w: 64 },
      { label: 'ON FIELD (SOLO)', w: 106 },
      { label: 'HP ×', w: 44 },
      { label: 'SPEED ×', w: 58 },
      { label: 'MIX', w: 330 },
    ],
    rows: WAVES.map((w) => {
      const total = Object.values(w.weights).reduce((a, b) => a + b, 0);
      const mix = Object.entries(w.weights)
        .map(([id, v]) => `${enemyDef(id).name.toUpperCase()} ${Math.round((v / total) * 100)}%`)
        .join(', ');
      return [
        `${w.from}-${w.to}`,
        `${num(w.target)} (${Math.min(MAX_ENEMIES, Math.round(w.target * spawnScaleFor(w.from, 1)))})`,
        num(hpScaleForMinute(w.from), 2),
        pct(speedScaleForMinute(w.from)),
        mix,
      ];
    }),
  });
  out.push({
    t: 'p',
    text: 'ON FIELD is the table value; in brackets, solo at the start of the row after the per-minute increase. Spawn multiplier by minute and players:',
    color: COLOR.textDim,
  });
  out.push({
    t: 'table',
    cols: [{ label: 'MINUTE', w: 64 }, ...Array.from({ length: MAX_PLAYERS }, (_, i) => ({ label: `${i + 1}P`, w: 50 }))],
    rows: [0, 5, 10, 14].map((m) => [formatTime(m * 60), ...Array.from({ length: MAX_PLAYERS }, (_, i) => `× ${num(spawnScaleFor(m, i + 1), 2)}`)]),
  });
  out.push({ t: 'h', text: 'EVENTS' });
  for (const at of BOSS_TIMES) {
    const end = at >= RUN_SECONDS ? ' Dawn waits until it is defeated.' : '';
    out.push({ t: 'p', text: `${formatTime(at)} · BOSS: one of the bosses arrives (see BOSSES).${end}` });
  }
  for (const ev of WAVE_EVENTS) {
    out.push({ t: 'p', text: `${formatTime(ev.at)} · SWARM: a ring of ${ev.count} ${enemyDef(ev.enemy).name.toUpperCase()}S closes in around every living player.` });
  }
  out.push({ t: 'p', text: `${formatTime(RUN_SECONDS)} · DAWN: every enemy dies and the run is won (once a boss that arrived at ${formatTime(RUN_SECONDS)} is defeated).` });
  return out;
}

function dropsPage(): Block[] {
  const out: Block[] = [
    { t: 'h', text: 'EXP GEMS' },
    {
      t: 'p',
      text: `Every kill drops a gem worth the monster's EXP. Once a gem is inside a player's PICKUP RADIUS it flies straight to them, always faster than they can run. Past ${MAX_GEMS} gems on the ground, new drops merge into the nearest gem, which changes colour as it grows:`,
    },
    {
      t: 'table',
      cols: [
        { label: 'GEM', w: 80 },
        { label: 'HOLDS', w: 120 },
      ],
      rows: GEM_TIERS.map((g, i) => {
        const next = GEM_TIERS[i + 1];
        return [g.color.toUpperCase(), next ? `${g.from}-${next.from - 1} EXP` : `${g.from}+ EXP`];
      }),
    },
    { t: 'gap', h: 6 },
    { t: 'entry', icon: 'potion', title: 'Health potion', sub: `HEALS ${pct(POTION.healPercent)} OF MAX HP`, scale: 2 },
    {
      t: 'p',
      text: `A rare drop from any enemy (chance per monster below). Walk over it to drink it; a player at full HP walks past without using it. It stays for ${POTION.lifetime}S (blinking for the last 5) and at most ${POTION.maxOnGround} lie on the ground at once.`,
    },
    {
      t: 'table',
      cols: [
        { label: 'MONSTER', w: 100 },
        { label: 'DROP CHANCE', w: 100 },
        { label: 'ABOUT 1 IN', w: 100 },
      ],
      rows: ENEMIES.map((d) => [d.name.toUpperCase(), pct(d.potionChance, 1), d.potionChance > 0 ? num(Math.round(1 / d.potionChance)) : '-']),
    },
    { t: 'gap', h: 6 },
    { t: 'h', text: 'LEVELS' },
    {
      t: 'p',
      text: `Each level up offers 3 random cards: new weapons or items (while you have free slots), modifications (once you own a weapon they change), generic powerups, and upgrades to ones you own. With everything maxed the only card is a heal of ${FALLBACK_HEAL} HP. Each player has ${REROLLS_PER_RUN} rerolls per run (R or the REROLL button): a reroll replaces all three cards, with different ones whenever the pool has enough. When the run resumes after your picks you are invulnerable for ${secs(LEVELUP_INVULN_SECONDS)}. EXP needed for the next level:`,
    },
    {
      t: 'table',
      cols: [
        { label: 'LEVEL', w: 60 },
        { label: 'EXP TO NEXT', w: 100 },
        { label: 'TOTAL EXP', w: 100 },
      ],
      rows: [1, 2, 3, 4, 5, 10, 15, 20, 21, 25, 30].map((lv) => {
        let total = 0;
        for (let l = 1; l < lv; l++) total += expToNext(l);
        return [String(lv), String(expToNext(lv)), String(total)];
      }),
    },
  ];
  return out;
}

function coopPage(): Block[] {
  return [
    {
      t: 'p',
      text: `Up to ${MAX_PLAYERS} players. HOST CO-OP gives an invite code and link; friends use JOIN CO-OP. The host's game runs the run for everyone, so the host should keep the game tab visible.`,
    },
    { t: 'h', text: 'LOBBY' },
    {
      t: 'p',
      text: `Everyone picks a character with CHARACTER and can set a display name (up to ${NAME_MAX} letters, digits or . - _ ! ? ') with NAME; without one you are shown as P1 to P4. Names are shown over each character, in the teammate list and on the party screen. Both are remembered for next time.`,
    },
    { t: 'h', text: 'SHARED EXP' },
    {
      t: 'p',
      text: 'The team shares one EXP bar and level. Every level gives each player their own card pick, and the run is held until everyone has chosen. EXP GAIN of the player that picks a gem up applies.',
    },
    { t: 'h', text: 'ENEMY HP' },
    {
      t: 'p',
      text: `Enemy HP × (1 + ${HP_SCALE_PER_EXTRA_PLAYER} × (players - 1)). Enemies chase the nearest living player and spawn around a random one. More players also bring more of them (see WAVES), and bosses scale their HP the same way.`,
    },
    {
      t: 'table',
      cols: [
        { label: 'PLAYERS', w: 70 },
        { label: 'ENEMY HP', w: 80 },
      ],
      rows: Array.from({ length: MAX_PLAYERS }, (_, i) => [String(i + 1), `× ${num(hpScaleForPlayers(i + 1), 2)}`]),
    },
    { t: 'h', text: 'FALLING AND REVIVING' },
    {
      t: 'p',
      text: `A player at 0 HP falls and watches a teammate. Stand within ${REVIVE.radius} px of the body for ${REVIVE.seconds}S to revive them; the bar drains again while nobody stands there. Revived players get ${secs(REVIVE.invulnSeconds)} of invulnerability and make the level-up picks they missed. The run is lost when every player is down.`,
    },
    {
      t: 'p',
      text: `The team's deaths are counted for the whole run, and each death revives with less HP than the one before (never below ${pct(REVIVE.minHpPercent)}):`,
    },
    {
      t: 'table',
      cols: [
        { label: 'TEAM DEATH', w: 90 },
        { label: 'REVIVED WITH', w: 110 },
      ],
      rows: [1, 2, 3, 4, 5, 6, 7].map((n) => [`#${n}`, `${pct(reviveHpPercent(n))} HP`]),
    },
    { t: 'h', text: 'OTHER RULES' },
    {
      t: 'p',
      text: 'The menu (ESC) does not pause the run. Players who leave are removed; if the host leaves, the run ends. After a run the host can play again or return to the lobby so others can join.',
    },
  ];
}

function mechanicsPage(): Block[] {
  return [
    { t: 'h', text: 'MOVING AND FIGHTING' },
    {
      t: 'p',
      text: 'You steer your character (WASD or arrows) and cast its ultimate with Q; weapons fire on their own. Some weapons aim where you last moved, others at the closest enemy. The arena is a walled graveyard; graves and decor never block you.',
    },
    { t: 'h', text: 'TAKING DAMAGE' },
    {
      t: 'p',
      text: `Touching an enemy deals its DAMAGE minus your ARMOR, then minus what your shields absorb, then times your DAMAGE TAKEN and a Vicissitude charge if you have one (at least 1). ${INVULN_SECONDS > 0 ? `After a hit you are invulnerable for ${secs(INVULN_SECONDS)}.` : 'A hit gives no invulnerability: every enemy touching you can hurt you.'} Instead each enemy (its touch and its thorns) and each boss hazard can hurt the same player once every ${secs(ENEMY_HIT_COOLDOWN)}, whether that hit got through, was dodged or was blocked. The only invulnerability is the ${secs(LEVELUP_INVULN_SECONDS)} you get when the run resumes after a level-up pick, and the ${secs(REVIVE.invulnSeconds)} after any revive (a co-op revive, Ragebaiter). Boss attacks (beams, shockwaves, clubs, petals, pollen, whirlpools) and what rare enemies do (thorns, crystal buds) hit the same way; a shockwave, beam or crystal bud hits each player once. Caustic ground from rare enemies is damage over time: each tick goes through armor and shield absorption, but ignores invulnerability and cannot be dodged or blocked. Regen keeps healing right after a hit. Hits push enemies back by the weapon's KNOCKBACK in px, reduced by the enemy's KB RESIST.`,
    },
    {
      t: 'p',
      text: 'A hit is checked in this order: nothing while you are invulnerable or mist (Mistwalker), or while that enemy or hazard is still waiting out its last hit on you; Shroud may dodge it; Aegis may block it; then the damage above, which Death Defied may refuse. Storm Shield deals its share back to whoever hit you, blocked or not. At 0 HP Ragebaiter may stand you right back up; otherwise you fall.',
      color: COLOR.textDim,
    },
    { t: 'h', text: 'CRITICAL STRIKES' },
    {
      t: 'p',
      text: `Every hit you land, from any source (weapons, blasts, echoes, splashes, effects, ultimates), can be a critical strike with your CRIT CHANCE (base ${pct(BASE_STATS.critChance)}). A critical strike deals ${pct(BASE_STATS.critDamage)} of the hit and shows a large pink number. Original Pristinity adds crit chance and takes time off all your cooldowns on every critical strike. Brutal charges (Unstable Infusion) give any hit a separate chance to deal double damage, which is not a critical strike. Every hit heals you by your LIFE STEAL share of the damage it dealt.`,
    },
    { t: 'h', text: 'SLOWS' },
    {
      t: 'p',
      text: `Some effects slow enemies (freezing fields): they walk slower while on the field and a moment after. Slows do not stack; the strongest one counts. Slowed or chilled enemies are tinted pale blue; stunned enemies (Stun, see MODS) stand still and are tinted yellow. Boss webs and rare enemies' void fields slow players the same way while they stand in one, and void fields also chain you, which does stack (see RARE). However much you are slowed, you keep ${pct(MIN_MOVE_MULT)} of your move speed.`,
    },
    { t: 'h', text: 'CARDS AND SLOTS' },
    {
      t: 'p',
      text: `${MAX_WEAPONS} weapon slots and ${MAX_ITEMS} item slots. Each weapon, item and modification goes up to level ${MAX_LEVEL}, each generic powerup to level ${POWERUP_MAX_LEVEL}. Modifications and powerups take no slots. Several level-ups in a row are offered one after another. Each player can reroll the cards ${REROLLS_PER_RUN} times per run.`,
    },
    { t: 'h', text: 'WINNING' },
    { t: 'p', text: `Survive until ${formatTime(RUN_SECONDS)} and dawn breaks: every enemy on the field dies and the run is won. A boss that arrives at ${formatTime(RUN_SECONDS)} holds dawn back until it is defeated.` },
    { t: 'h', text: 'PARTY SCREEN' },
    {
      t: 'p',
      text: 'After a run, every player gets a row: DAMAGE dealt (overkill not counted, ultimate included), DPS (damage over the whole run), KILLS (final blows), TAKEN (HP lost after armor and shields), HEALED (potions, heal cards, life steal and passives, not regen), BLOCKS (hits Aegis stopped), DEATHS, REVIVES (each teammate standing on the body when a revive completes gets one), ULTS cast and CRITS (critical strikes landed). REROLLS used is shown under the weapons. Pick a row to see that player\'s weapons and ultimate (and a passive\'s pets: Warren\'s headbutts; Bunny Armory counts the damage of its gear): level, damage, DPS since it was picked up, kills and share of their damage.',
    },
    { t: 'h', text: 'CONTROLS' },
    { t: 'p', text: 'Q: ultimate. ESC or P: menu (pauses in solo). M: mute. F3: debug overlay. Level-up: 1 2 3, arrows and ENTER, or click; R rerolls.' },
    { t: 'h', text: 'FEEDBACK' },
    {
      t: 'p',
      text: 'Every number in this wiki comes straight from the game data, so it matches the build you are playing. Quote the tab and the values when you suggest balance changes.',
      color: COLOR.textDim,
    },
  ];
}

/** One line per boss skill, with every number from the data. */
function skillText(s: BossSkill): string {
  const every = `every ${secs(s.cooldown)}`;
  switch (s.kind) {
    case 'webs': {
      const web = hazardDef('web');
      return `WEBS · ${every}: ${s.count} webs land at random within ${s.range} px of the closest player. Standing in one (${web.radius} px) cuts move speed by ${pct(web.slow ?? 0)}. Webs last ${s.lifetime}S, fading over the last ${web.fade ?? 0}S.`;
    }
    case 'summon': {
      const m = enemyDef(s.minion);
      const sh = m.shooter;
      const shot = sh ? ` Each one spits a slow petal (${sh.damage} damage, ${sh.speed} px/s) at the closest player within ${sh.range} px every ${secs(sh.interval)}.` : '';
      return `SPROUTS · ${every}: up to ${s.count} ${m.name.toUpperCase()}S grow ${s.distance} px around it (at most ${s.max} alive).${shot}`;
    }
    case 'pollen':
      return `POLLEN · ${every}: ${s.count} clouds (${hazardDef('pollen').radius} px) drift after the closest player at ${s.speed} px/s for ${s.lifetime}S, dealing ${s.damage} to anyone inside.`;
    case 'beam':
      return `WATER BEAM · ${every}: stops and aims at the closest player for ${secs(s.charge)} (a red line shows where), then fires a beam ${s.length} px long and ${s.width} px wide that hits for ${s.damage}.`;
    case 'whirlpools':
      return `WHIRLPOOLS · ${every}: ${s.count} whirlpools (${hazardDef('whirlpool').radius} px) open up to ${s.range} px from random players for ${s.lifetime}S, dealing ${s.damage} to anyone inside.`;
    case 'slam':
      return `SLAM · ${every}: stops and raises its club for ${secs(s.windup)} (a red circle shows the reach), then a shockwave rolls out to ${s.radius} px over ${secs(s.duration)}, hitting each player it passes for ${s.damage}.`;
    case 'clubs':
      return `CLUBS · ${every}: throws ${s.count} clubs in every direction at ${s.speed} px/s. They slow to a stop after ${secs(s.outTime)}, then fly back to it, hitting for ${s.damage}.`;
  }
}

function bossesPage(filter: string): Block[] {
  const times = BOSS_TIMES.map((t) => formatTime(t)).join(', ');
  const out: Block[] = [
    {
      t: 'p',
      text: `A boss arrives at ${times}: each run picks ${BOSS_TIMES.length} different bosses at random (the same seed meets the same ones). A boss that arrives at ${formatTime(RUN_SECONDS)} holds dawn back: the run is won once it is defeated, while the horde keeps coming. Bosses are much bigger, ignore knockback, hurt on touch and have a big HP bar over them and at the top of the screen. Their HP grows with time and players like every enemy's (see MONSTERS and CO-OP). Each skill has its own cooldown; one with a wind-up roots the boss and shows a red warning first. A boss drops its EXP as one gem, and a health potion.`,
    },
    {
      t: 'p',
      text: `Boss attacks hurt like a touch: through armor and shields. Every pollen cloud, whirlpool, club and petal can hurt you once every ${secs(ENEMY_HIT_COOLDOWN)}, so standing in two clouds hurts twice as often. Webs deal no damage but slow you.`,
      color: COLOR.textDim,
    },
  ];
  const hpAt = (d: EnemyDef) => BOSS_TIMES.map((t) => num(Math.round(d.hp * hpScaleForMinute(t / 60)))).join(' / ');
  for (const d of BOSSES) {
    if (!shows(filter, d.name)) continue;
    const b = d.boss!;
    out.push({ t: 'gap', h: 8 });
    out.push({ t: 'entry', icon: d.firstFrame, title: d.name, sub: `${b.title} · ${b.description}` });
    out.push({
      t: 'table',
      cols: [
        { label: 'HP', w: 50 },
        { label: `HP AT ${BOSS_TIMES.map((t) => formatTime(t)).join(' / ')} (SOLO)`, w: 230 },
        { label: 'SPEED', w: 50 },
        { label: 'TOUCH', w: 50 },
        { label: 'EXP', w: 40 },
        { label: 'SIZE', w: 40 },
      ],
      rows: [[num(d.hp), hpAt(d), num(d.speed), num(d.damage), num(d.exp), num(d.radius)]],
    });
    for (const s of b.skills) out.push({ t: 'p', text: skillText(s) });
    for (const s of b.skills) {
      if (s.kind !== 'summon') continue;
      const m = enemyDef(s.minion);
      out.push({ t: 'entry', icon: m.firstFrame, title: m.name, sub: `MINION · ${num(m.hp)} HP (SCALES LIKE OTHER ENEMIES) · DOES NOT MOVE · ${num(m.damage)} TOUCH DAMAGE · ${num(m.exp)} EXP` });
    }
  }
  return out;
}

export const WIKI_PAGES: WikiPage[] = [
  { tab: 'CHARACTERS', source: 'src/data/characters.ts, src/data/ultimates.ts, src/data/passives.ts', filters: characterFilters, blocks: charactersPage },
  { tab: 'WEAPONS', source: 'src/data/weapons.ts', filters: characterFilters, blocks: weaponsPage },
  { tab: 'MODS', source: 'src/data/modifications.ts, src/constants.ts', filters: () => MOD_FILTERS, blocks: modsPage },
  { tab: 'ITEMS', source: 'src/data/items.ts, src/data/player.ts', blocks: itemsPage },
  { tab: 'POWERUPS', source: 'src/data/powerups.ts', filters: () => ['ALL', ...POWERUPS.map((p) => p.name.toUpperCase())], blocks: powerupsPage },
  { tab: 'MONSTERS', source: 'src/data/enemies.ts', blocks: monstersPage },
  { tab: 'RARE', source: 'src/data/enemyModifiers.ts', blocks: raresPage },
  { tab: 'BOSSES', source: 'src/data/bosses.ts', filters: () => ['ALL', ...BOSSES.map((b) => b.name.toUpperCase())], blocks: bossesPage },
  { tab: 'WAVES', source: 'src/data/waves.ts, src/data/bosses.ts', blocks: wavesPage },
  { tab: 'DROPS', source: 'src/data/drops.ts, src/core/progression.ts, src/data/player.ts', blocks: dropsPage },
  { tab: 'CO-OP', source: 'src/data/coop.ts, src/data/waves.ts', blocks: coopPage },
  { tab: 'RULES', source: 'src/constants.ts', blocks: mechanicsPage },
];
