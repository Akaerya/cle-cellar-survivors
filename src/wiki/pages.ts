/**
 * The in-game wiki (title screen > WIKI, or the pause menu).
 *
 * Every number is read from src/data and src/constants, so changing a value updates the wiki by
 * itself. The prose (rules, notes, how things work) is written by hand in this file: when you add
 * or change a mechanic, a weapon behaviour, a drop or a co-op rule, update the matching text here.
 */
import {
  FALLBACK_HEAL,
  INVULN_SECONDS,
  MAX_EFFECT_STACKS,
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
  COLOR,
} from '../constants';
import { computeStats, expToNext, formatTime, hasteFactor, itemMaxLevel, modEffectAt, modReach, weaponLevelAt, weaponStatsAt } from '../core/progression';
import { NAME_MAX } from '../core/profile';
import {
  BASE_STATS,
  CHAIN_RANGE,
  CHARACTERS,
  ECHO_GAP,
  ECHO_RADIUS,
  ENEMIES,
  GEM_TIERS,
  ITEMS,
  MODIFICATIONS,
  POTION,
  POWERUPS,
  POWERUP_MAX_LEVEL,
  SPLIT_ARC,
  REVIVE,
  WAVES,
  WAVE_EVENTS,
  enemyDef,
  hpScaleForMinute,
  hpScaleForPlayers,
  reviveHpPercent,
  speedScaleForMinute,
  ultimateDef,
  weaponDef,
} from '../data';
import { HP_SCALE_PER_EXTRA_PLAYER, HP_SCALE_PER_MINUTE, SPEED_SCALE_PER_MINUTE, SPEED_SCALE_START } from '../data/waves';
import type { ItemDef, ModEffect, StatKey, Targeting, WeaponDef, WeaponStats, WeaponTag } from '../data/types';

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
  blocks: () => Block[];
}

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
};

const STAT_NOTES: Record<StatKey, string> = {
  maxHp: 'Fallen at 0. Maximum Health also heals the HP it adds.',
  moveSpeed: 'px per second.',
  regen: 'HP healed every second.',
  regenPercent: 'Share of max HP healed every second, on top of REGEN. Keeps working right after a hit.',
  armor: 'Subtracted from every hit (a hit always deals at least 1).',
  damageTaken: 'Multiplies the damage of every hit, after armor and shields (still at least 1).',
  pickupRadius: 'px. EXP gems inside it fly to you.',
  damageMult: 'Multiplies all weapon damage. The only multiplier: damage bonuses from weapon levels and modifications add up first.',
  cooldownMult: 'Multiplies all weapon cooldowns (lower is faster, floor 10%).',
  abilityHaste: 'Cooldowns × 100 / (100 + haste): 20 haste is 16.7% shorter, 100 haste 50%. Works with COOLDOWN; not ultimates.',
  critChance: 'Chance that a hit is a critical strike. Any of your hits can crit: weapons, blasts, echoes, effects, ultimates. Passive weapons such as Original Pristinity add to it.',
  critDamage: 'Damage of a critical strike, as a share of the hit.',
  areaMult: 'Scales weapon size, sweep, stab and breath reach, aura, orbit and blast radius. Weapon size levels and area modifications add to it.',
  expMult: 'Multiplies EXP from gems you pick up.',
};

const isPercentStat = (k: StatKey) =>
  k === 'damageMult' ||
  k === 'cooldownMult' ||
  k === 'areaMult' ||
  k === 'expMult' ||
  k === 'damageTaken' ||
  k === 'regenPercent' ||
  k === 'critChance' ||
  k === 'critDamage';
const statValue = (k: StatKey, v: number) => (k === 'regenPercent' ? pct(v, 1) : isPercentStat(k) ? pct(v) : num(v));

const TAG_LABELS: Record<WeaponTag, string> = { projectile: 'PROJECTILE', aoe: 'AOE', duration: 'DURATION' };
const tagList = (tags: WeaponTag[] | undefined) => (tags?.length ? tags.map((t) => TAG_LABELS[t]).join(', ') : 'NONE');

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
  shield: `Blocks one hit completely, then recharges for RECHARGE seconds (shortened by COOLDOWN). Every hit that is not blocked is reduced by ABSORBS (after armor, at most ${pct(MAX_SHIELD_REDUCTION)}, still at least 1). A blocked hit gives the usual invulnerability. The bubble around you shows the charge.`,
  field:
    'Every COOLDOWN, conjures FIELDS freezing fields of RADIUS px: one under the closest enemy within RANGE, the others under different random enemies in range (holds while nothing is in range). A field stays where it appeared for DURATION seconds and slows every enemy on it by SLOW (slows do not stack). When it appears and then every second, it applies its effect to every enemy on it; each field applies its own, so two fields give two stacks. The field itself deals no damage. RADIUS is scaled by AREA, DURATION by duration modifications.',
  passive:
    'Does nothing on its own: it changes how all your other attacks work. CRIT is added to your critical strike chance; every critical strike you land takes CRIT REFUND seconds off all your cooldowns, ultimate included (never below ready). Refunds stop once an ability would come back sooner than FASTEST of its cooldown after it was used, so hundreds of crits a second cannot make abilities fire every frame.',
  beam: 'A straight beam that lingers for LIFETIME seconds and hits every enemy that touches it once. SIZE is half its width.',
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
  shield: [C.recharge, C.absorbs],
  bomb: [C.damage, C.cooldown, C.count, C.radius, C.speed, C.range, C.knockback],
  field: [C.cooldown, C.fields, C.radius, C.duration, C.slow, C.range],
  passive: [C.crit, C.critRefund, C.fastest],
  beam: [C.damage, C.size, C.lifetime, C.knockback],
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

function weaponsPage(): Block[] {
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
    out.push({ t: 'gap', h: 4 });
    out.push({ t: 'h', text: `${c.name.toUpperCase()}'S WEAPONS` });
    for (const def of c.weapons.map(weaponDef)) {
      out.push({ t: 'gap', h: 4 });
      const start = def.id === c.startingWeapon ? ' · STARTING WEAPON' : '';
      out.push({ t: 'entry', icon: def.icon, title: def.name, sub: `${def.targeting.toUpperCase()}${start} · TAGS: ${tagList(def.tags)} · ${def.description}` });
      out.push({ t: 'p', text: TARGETING_NOTES[def.targeting], color: COLOR.textDim });
      if (def.blastOnHit) {
        out.push({
          t: 'p',
          text: `The projectile deals no damage itself and never pierces: every enemy it touches sets off a blast that hits everything within RADIUS px (scaled by AREA). Projectiles from Splits, and every enemy a chaining projectile reaches, set off a blast too. ${def.damageTags ? `Only ${tagList(def.damageTags)} modifications add to the blast's damage.` : ''}`,
          color: COLOR.textDim,
        });
      }
      if (def.burst) out.push({ t: 'p', text: burstText(def), color: COLOR.textDim });
      if (def.effect) {
        const fx = def.effect;
        const name = fx.name ? fx.name.toUpperCase() : 'EFFECT';
        const source = def.targeting === 'field' ? 'every check of a field' : 'each hit';
        const again = fx.stacks ? 'Stacks: every application adds a stack.' : 'Hitting again refreshes it.';
        out.push({
          t: 'p',
          text: `${name}: ${source} leaves a stack dealing ${num(fx.damage)} damage every ${secs(fx.interval)} for ${secs(fx.duration)}. ${again} ${def.damageTags ? `Only ${tagList(def.damageTags)} modifications add to its damage.` : ''}`,
          color: COLOR.textDim,
        });
      }
      const cols = weaponColumns(def);
      const rows: Cell[][] = [];
      for (let lv = 1; lv <= MAX_LEVEL; lv++) {
        const s: WeaponStats = weaponStatsAt(def, lv);
        rows.push([`LV ${lv}`, ...cols.map((col) => col.get(s))]);
      }
      out.push({ t: 'table', cols: [{ label: '', w: 40 }, ...cols.map(({ label, w }) => ({ label, w }))], rows });
      def.levels.forEach((l, i) => out.push({ t: 'p', text: `LV ${i + 2}: ${l.text}` }));
    }
  }
  return out;
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

function charactersPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Pick who you play as on the character select screen (SOLO), or with CHARACTER in the co-op lobby. Each character has its own weapon kit and ultimate. Items, modifications, powerups and base stats are shared (see ITEMS, MODS and POWERUPS), and several players may pick the same character.`,
    },
    { t: 'h', text: 'ULTIMATES (Q)' },
    {
      t: 'p',
      text: 'Press Q to cast your ultimate. Its cooldown starts when you cast it and is not shortened by COOLDOWN; its damage scales with DAMAGE and its projectiles with AREA. Falling ends a running ultimate early (the cooldown keeps going). The box under your build shows it: green edge when ready, gold with a bar while it runs, greyed out with the seconds left while it recharges. Teammates are shown the same way in the list below it.',
    },
  ];
  for (const c of CHARACTERS) {
    const ult = ultimateDef(c.ultimate);
    const a = ult.attack.stats;
    out.push({ t: 'gap', h: 8 });
    out.push({ t: 'entry', icon: c.firstFrame, title: c.name, sub: `${c.title} · ${c.description}`, scale: 2 });
    out.push({
      t: 'p',
      text: `STARTS WITH ${weaponDef(c.startingWeapon).name.toUpperCase()}. KIT: ${c.weapons.map((id) => weaponDef(id).name.toUpperCase()).join(', ')}.`,
    });
    out.push({ t: 'entry', icon: ult.icon, title: `ULTIMATE: ${ult.name}`, sub: ult.description });
    const how =
      ult.kind === 'storm'
        ? `Every ${secs(ult.interval)} for ${ult.duration}S, ${ult.count} projectiles fly out from you in a spiral that turns ${ult.spin} degrees per second.`
        : ult.kind === 'pet'
          ? `For ${ult.duration}S a pet follows you and every ${secs(ult.interval)} fires at the closest enemy within ${a.range} px of it.`
          : `For ${ult.duration}S a dome of ${ult.radius} px radius stands where you cast it. Every ${secs(ult.interval)} a beam crosses it in a random straight line, lingering for ${secs(a.lifetime)} and hitting every enemy that touches it once (${num(a.size * 2)} px wide). While your projectiles are inside, the edge works like an enemy they can split on, but they use up no pierce or bounces and deal no damage there; they ricochet toward the closest enemy inside the dome they have not hit (straight back when there is none). The beams are tagged ${tagList(ult.attack.tags)}: area modifications widen them, duration modifications make them linger, and Echo Strike, Reduced AoE and Less Duration work on them. Reiterate does not, since the beams leave no stacks. The dome itself keeps its size and length.`;
    out.push({ t: 'p', text: how, color: COLOR.textDim });
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

/** One row per level shown: the total bonus of an item or powerup and the stats it gives from base. */
function statRows(def: ItemDef, levels: number[]): Cell[][] {
  return levels.map((lv) => {
    const stats = computeStats([{ def, level: lv }]);
    const bonus = def.perLevel
      .map((m) => {
        const parts: string[] = [];
        if (m.flat) parts.push(m.stat === 'regenPercent' ? `+${pct(m.flat * lv, 1)}` : `${m.flat * lv >= 0 ? '+' : ''}${num(m.flat * lv)}`);
        if (m.percent) parts.push(signedPct(m.percent * lv));
        return `${parts.join(' ')} ${STAT_LABELS[m.stat]}`;
      })
      .join(', ');
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

function powerupsPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Generic powerups are plain stat boosts. They take no slots and each goes up to level ${POWERUP_MAX_LEVEL}, so they keep showing up on cards after your slots are full. They add to the same stats as items: (base + flat bonuses) × (1 + percent bonuses), added up over every item and powerup level. Base values are on the ITEMS page.`,
    },
  ];
  for (const def of POWERUPS) {
    out.push({ t: 'gap', h: 6 });
    out.push({ t: 'entry', icon: def.icon, title: def.name, sub: def.description });
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
  if (e.split) parts.push(`SPLITS INTO ${num(e.split)}${e.splitDepth > 1 ? `, UP TO ${num(e.splitDepth)} TIMES` : ''}`);
  if (e.chain) parts.push(`+${num(e.chain)} BOUNCE${e.chain === 1 ? '' : 'S'}`);
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

function modsPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Modifications change every weapon that shares one of their tags (PROJECTILE, AOE or DURATION; each weapon's tags are on the WEAPONS page), as far as the weapon has a use for them: CHANGES under each one lists what it really does. Each goes up to level ${MAX_LEVEL} and takes no slot. A modification is offered once you own a weapon it changes; after you take it, its upgrades keep being offered.`,
    },
    { t: 'h', text: 'PROJECTILES' },
    {
      t: 'p',
      text: `On hitting an enemy a projectile first splits if it still can: it is replaced by its splits, which fan out over ${SPLIT_ARC} degrees from where it was going, skip the enemies it already hit and start with full pierce and bounces. Otherwise it uses up 1 pierce. Once pierce runs out it chains: it flies to the closest enemy within ${CHAIN_RANGE} px that it has not hit yet (a random direction when there is none), using up 1 bounce per hit. Projectiles that never hit anything on the way (Coconuts) cannot split or chain; of Pierce they only get the damage bonus. Crystalline Bloom's crystal never pierces and deals no damage itself, so Pierce does nothing for it; Splits and Chain do, and every enemy its crystals touch sets off a blast. Additional Projectiles adds to COUNT: spread weapons fan the extra projectiles out, Coconuts and Hailing Arrows fire them one after another. At most ${MAX_PROJECTILES} projectiles fly at once; splits past that are lost.`,
    },
    { t: 'h', text: 'AREA' },
    {
      t: 'p',
      text: `Area bonuses add up: a weapon's own size levels, the AREA stat and area modifications go into one sum. ${areaExample()} Area modifications change only the area part of a weapon: the reach of sweeps, stabs and breaths, the radius of auras, strikes, blasts and freezing fields, the width of beams, and the size of orbiting objects.`,
    },
    {
      t: 'p',
      text: `Echo Strike: every enemy an AOE weapon hits sends out an echo with a ${ECHO_RADIUS} px radius (scaled by the AREA stat, area modifications and Echo Strike's own area bonus, not by the weapon's size levels). It deals a share of the hit to everything inside, the enemy that was hit included. Echo damage never echoes again. Echoes landing on the same enemy in the same frame count as one hit. Areas that deal no damage themselves (freezing fields) never echo.`,
    },
    { t: 'h', text: 'DURATION' },
    {
      t: 'p',
      text: `Duration weapons leave a stack on every enemy they hit (or, for freezing fields, on every enemy on the field at each check) that deals damage each tick until it runs out; hitting again refreshes it, unless the effect stacks (Rime Trauma), when every application adds a stack. Duration modifications also stretch how long fields and beams last. Reiterate: when a stack is applied or deals damage it may copy itself with the time it has left. Copies tick and reiterate too, but are never refreshed. At most ${MAX_EFFECT_STACKS} stacks of one weapon sit on one enemy.`,
    },
    { t: 'h', text: 'DAMAGE' },
    {
      t: 'p',
      text: "Damage bonuses add up: a weapon's own damage levels and the damage bonus of every modification that changes it go into one sum. Coconuts is tagged PROJECTILE and AOE, so Pierce and Reduced AoE both count. Some weapons deal damage with one part only: Crystalline Bloom's blast only takes AOE damage bonuses, Rime Trauma only DURATION ones. That sum is then multiplied by your DAMAGE stat (the Damage powerup, +5% per level, also added up), the only damage multiplier.",
    },
  ];
  const weapons = CHARACTERS.flatMap((c) => c.weapons.map(weaponDef));
  for (const def of MODIFICATIONS) {
    out.push({ t: 'gap', h: 6 });
    out.push({ t: 'entry', icon: def.icon, title: def.name, sub: `TAGS: ${tagList(def.tags)} · ${def.description}` });
    // Sharing a tag is not always enough: a weapon only listed for what the modification really does for it.
    const changes = weapons.flatMap((w) => {
      const reach = modReach(w, def);
      if (reach === 'none') return [];
      const note = reach === 'damage only' ? ' (DAMAGE ONLY)' : reach === 'no damage' ? ' (NO DAMAGE BONUS)' : '';
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
      text: `Enemies walk straight at the nearest living player and hurt them on touch. HP grows ${pct(HP_SCALE_PER_MINUTE)} of base per minute; speed starts at ${pct(SPEED_SCALE_START)} and rises ${pct(SPEED_SCALE_PER_MINUTE, 1)} per minute up to 100%. In co-op HP is also multiplied by the player count (see CO-OP).`,
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
    text: 'SPEED is px per second at full speed. DAMAGE is per hit before armor; a player cannot be hit again for ' +
      `${secs(INVULN_SECONDS)} after a hit. KB RESIST is how much knockback is ignored. SIZE is the collision radius in px.`,
    color: COLOR.textDim,
  });
  return out;
}

function wavesPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `The run lasts ${formatTime(RUN_SECONDS)}. Every ${SPAWN_TICK_MS} ms the spawner tops the horde up toward ON FIELD, at most a sixth of it per tick, on a ring just outside a random living player's screen. At most ${MAX_ENEMIES} enemies exist at once. Enemies more than ${DESPAWN_SCREENS} screens away from every player are moved back near one, keeping their HP.`,
    },
  ];
  out.push({
    t: 'table',
    cols: [
      { label: 'MINUTES', w: 70 },
      { label: 'ON FIELD', w: 70 },
      { label: 'HP ×', w: 50 },
      { label: 'SPEED ×', w: 60 },
      { label: 'MIX', w: 350 },
    ],
    rows: WAVES.map((w) => {
      const total = Object.values(w.weights).reduce((a, b) => a + b, 0);
      const mix = Object.entries(w.weights)
        .map(([id, v]) => `${enemyDef(id).name.toUpperCase()} ${Math.round((v / total) * 100)}%`)
        .join(', ');
      return [
        `${w.from}-${w.to}`,
        num(w.target),
        num(hpScaleForMinute(w.from), 2),
        pct(speedScaleForMinute(w.from)),
        mix,
      ];
    }),
  });
  out.push({ t: 'h', text: 'EVENTS' });
  for (const ev of WAVE_EVENTS) {
    out.push({ t: 'p', text: `${formatTime(ev.at)} · SWARM: a ring of ${ev.count} ${enemyDef(ev.enemy).name.toUpperCase()}S closes in around every living player.` });
  }
  out.push({ t: 'p', text: `${formatTime(RUN_SECONDS)} · DAWN: every enemy dies and the run is won.` });
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
      text: `Each level up offers 3 random cards: new weapons or items (while you have free slots), modifications (once you own a weapon they change), generic powerups, and upgrades to ones you own. With everything maxed the only card is a heal of ${FALLBACK_HEAL} HP. EXP needed for the next level:`,
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
      text: `Enemy HP × (1 + ${HP_SCALE_PER_EXTRA_PLAYER} × (players - 1)). Enemies chase the nearest living player and spawn around a random one.`,
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
      text: `Touching an enemy deals its DAMAGE minus your ARMOR, then minus what your shields absorb, then times your DAMAGE TAKEN (at least 1). A charged shield blocks the hit instead. After a hit you are invulnerable for ${secs(INVULN_SECONDS)}. Regen keeps healing right after a hit. Hits push enemies back by the weapon's KNOCKBACK in px, reduced by the enemy's KB RESIST.`,
    },
    { t: 'h', text: 'CRITICAL STRIKES' },
    {
      t: 'p',
      text: `Every hit you land, from any source (weapons, blasts, echoes, effects, ultimates), can be a critical strike with your CRIT CHANCE (base ${pct(BASE_STATS.critChance)}). A critical strike deals ${pct(BASE_STATS.critDamage)} of the hit and shows a large pink number. Original Pristinity adds crit chance and takes time off all your cooldowns on every critical strike.`,
    },
    { t: 'h', text: 'SLOWS' },
    {
      t: 'p',
      text: 'Some effects slow enemies (freezing fields): they walk slower while on the field and a moment after. Slows do not stack; the strongest one counts. Slowed or chilled enemies are tinted pale blue.',
    },
    { t: 'h', text: 'CARDS AND SLOTS' },
    {
      t: 'p',
      text: `${MAX_WEAPONS} weapon slots and ${MAX_ITEMS} item slots. Each weapon, item and modification goes up to level ${MAX_LEVEL}, each generic powerup to level ${POWERUP_MAX_LEVEL}. Modifications and powerups take no slots. Several level-ups in a row are offered one after another.`,
    },
    { t: 'h', text: 'WINNING' },
    { t: 'p', text: `Survive until ${formatTime(RUN_SECONDS)} and dawn breaks: every enemy on the field dies and the run is won.` },
    { t: 'h', text: 'PARTY SCREEN' },
    {
      t: 'p',
      text: 'After a run, every player gets a row: DAMAGE dealt (overkill not counted, ultimate included), DPS (damage over the whole run), KILLS (final blows), TAKEN (HP lost after armor and shields), HEALED (potions and heal cards, not regen), BLOCKS (hits a shield stopped), DEATHS, REVIVES (each teammate standing on the body when a revive completes gets one), ULTS cast and CRITS (critical strikes landed). Pick a row to see that player\'s weapons and ultimate: level, damage, DPS since it was picked up, kills and share of their damage.',
    },
    { t: 'h', text: 'CONTROLS' },
    { t: 'p', text: 'Q: ultimate. ESC or P: menu (pauses in solo). M: mute. F3: debug overlay. Level-up: 1 2 3, arrows and ENTER, or click.' },
    { t: 'h', text: 'FEEDBACK' },
    {
      t: 'p',
      text: 'Every number in this wiki comes straight from the game data, so it matches the build you are playing. Quote the tab and the values when you suggest balance changes.',
      color: COLOR.textDim,
    },
  ];
}

export const WIKI_PAGES: WikiPage[] = [
  { tab: 'CHARACTERS', source: 'src/data/characters.ts, src/data/ultimates.ts', blocks: charactersPage },
  { tab: 'WEAPONS', source: 'src/data/weapons.ts', blocks: weaponsPage },
  { tab: 'MODS', source: 'src/data/modifications.ts, src/constants.ts', blocks: modsPage },
  { tab: 'ITEMS', source: 'src/data/items.ts, src/data/player.ts', blocks: itemsPage },
  { tab: 'POWERUPS', source: 'src/data/powerups.ts', blocks: powerupsPage },
  { tab: 'MONSTERS', source: 'src/data/enemies.ts', blocks: monstersPage },
  { tab: 'WAVES', source: 'src/data/waves.ts', blocks: wavesPage },
  { tab: 'DROPS', source: 'src/data/drops.ts, src/core/progression.ts', blocks: dropsPage },
  { tab: 'CO-OP', source: 'src/data/coop.ts, src/data/waves.ts', blocks: coopPage },
  { tab: 'RULES', source: 'src/constants.ts', blocks: mechanicsPage },
];
