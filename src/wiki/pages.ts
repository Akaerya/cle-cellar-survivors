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
import { computeStats, expToNext, formatTime, weaponStatsAt } from '../core/progression';
import {
  BASE_STATS,
  ENEMIES,
  GEM_TIERS,
  ITEMS,
  POTION,
  REVIVE,
  STARTING_WEAPON,
  WAVES,
  WAVE_EVENTS,
  WEAPONS,
  enemyDef,
  hpScaleForMinute,
  hpScaleForPlayers,
  reviveHpPercent,
  speedScaleForMinute,
  weaponDef,
} from '../data';
import { HP_SCALE_PER_EXTRA_PLAYER, HP_SCALE_PER_MINUTE, SPEED_SCALE_PER_MINUTE, SPEED_SCALE_START } from '../data/waves';
import type { StatKey, Targeting, WeaponStats } from '../data/types';

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
  armor: 'ARMOR',
  pickupRadius: 'PICKUP RADIUS',
  damageMult: 'DAMAGE',
  cooldownMult: 'COOLDOWN',
  areaMult: 'AREA',
  expMult: 'EXP GAIN',
};

const STAT_NOTES: Record<StatKey, string> = {
  maxHp: 'Fallen at 0. Items that raise it heal the same amount.',
  moveSpeed: 'px per second.',
  regen: 'HP healed every second.',
  armor: 'Subtracted from every hit (a hit always deals at least 1).',
  pickupRadius: 'px. EXP gems inside it fly to you.',
  damageMult: 'Multiplies all weapon damage.',
  cooldownMult: 'Multiplies all weapon cooldowns (lower is faster, floor 10%).',
  areaMult: 'Multiplies weapon size, sweep reach, aura and orbit radius.',
  expMult: 'Multiplies EXP from gems you pick up.',
};

const isPercentStat = (k: StatKey) => k === 'damageMult' || k === 'cooldownMult' || k === 'areaMult' || k === 'expMult';
const statValue = (k: StatKey, v: number) => (isPercentStat(k) ? pct(v) : num(v));

/** How each targeting type uses its stats. Update when a weapon behaviour changes. */
const TARGETING_NOTES: Record<Targeting, string> = {
  nearest:
    'Throws at the closest enemy within RANGE. Holds fire while nothing is in range and shoots the moment something is. COUNT projectiles fan out by the spread angle. PIERCE is how many enemies one projectile hits.',
  facing:
    'Fires toward the way the monkey last moved. With SPEED 0 it is a melee sweep: everything within AREA px inside the arc is hit. Extra COUNT adds sweeps spread evenly around the monkey.',
  random: 'Fires in a random direction.',
  orbit:
    'COUNT objects circle the monkey at RANGE px (scaled by AREA). Each enemy can be hit by this weapon once per COOLDOWN. SPEED is how fast they travel along the ring.',
  aura: 'Every COOLDOWN, hits everything within AREA px of the monkey.',
};

// ------------------------------------------------------------------ pages

function weaponsPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Weapons fire on their own. You start with ${weaponDef(STARTING_WEAPON).name.toUpperCase()} and can hold ${MAX_WEAPONS} weapons; each goes up to level ${MAX_LEVEL}. Values below are before your DAMAGE, COOLDOWN and AREA stats.`,
    },
  ];
  for (const def of WEAPONS) {
    out.push({ t: 'gap', h: 6 });
    out.push({ t: 'entry', icon: def.icon, title: def.name, sub: `${def.targeting.toUpperCase()} · ${def.description}` });
    out.push({ t: 'p', text: TARGETING_NOTES[def.targeting], color: COLOR.textDim });
    const rows: Cell[][] = [];
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const s: WeaponStats = weaponStatsAt(def, lv);
      rows.push([
        `LV ${lv}`,
        num(s.damage),
        secs(s.cooldown),
        num(s.projectileCount),
        s.pierce === Infinity ? 'ALL' : num(s.pierce),
        num(s.size),
        dash(s.speed),
        dash(s.range),
        num(s.knockback),
        s.boomerang ? 'YES' : '-',
      ]);
    }
    out.push({
      t: 'table',
      cols: [
        { label: '', w: 40 },
        { label: 'DAMAGE', w: 58 },
        { label: 'COOLDOWN', w: 70 },
        { label: 'COUNT', w: 50 },
        { label: 'PIERCE', w: 54 },
        { label: 'AREA', w: 46 },
        { label: 'SPEED', w: 50 },
        { label: 'RANGE', w: 50 },
        { label: 'KNOCKBACK', w: 80 },
        { label: 'RETURN', w: 50 },
      ],
      rows,
    });
    def.levels.forEach((l, i) => out.push({ t: 'p', text: `LV ${i + 2}: ${l.text}` }));
  }
  return out;
}

function itemsPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Items raise your stats. You can hold ${MAX_ITEMS} items; each goes up to level ${MAX_LEVEL}. Final stat = (base + flat bonuses) × (1 + percent bonuses), added up over every item level.`,
    },
  ];
  for (const def of ITEMS) {
    out.push({ t: 'gap', h: 6 });
    out.push({ t: 'entry', icon: def.icon, title: def.name, sub: def.description });
    const rows: Cell[][] = [];
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const stats = computeStats([{ def, level: lv }]);
      const bonus = def.perLevel
        .map((m) => {
          const parts: string[] = [];
          if (m.flat) parts.push(`${m.flat * lv >= 0 ? '+' : ''}${num(m.flat * lv)}`);
          if (m.percent) parts.push(signedPct(m.percent * lv));
          return `${parts.join(' ')} ${STAT_LABELS[m.stat]}`;
        })
        .join(', ');
      const result = def.perLevel.map((m) => `${STAT_LABELS[m.stat]} ${statValue(m.stat, stats[m.stat])}`).join(', ');
      rows.push([`LV ${lv}`, bonus, { text: result, color: COLOR.gold }]);
    }
    out.push({
      t: 'table',
      cols: [
        { label: '', w: 40 },
        { label: 'TOTAL BONUS', w: 220 },
        { label: 'RESULT (FROM BASE)', w: 240 },
      ],
      rows,
    });
  }
  out.push({ t: 'gap', h: 8 });
  out.push({ t: 'h', text: 'MONKEY BASE STATS' });
  out.push({
    t: 'table',
    cols: [
      { label: 'STAT', w: 120 },
      { label: 'BASE', w: 60 },
      { label: 'NOTES', w: 420 },
    ],
    rows: (Object.keys(BASE_STATS) as StatKey[]).map((k) => [STAT_LABELS[k], { text: statValue(k, BASE_STATS[k]), color: COLOR.gold }, STAT_NOTES[k]]),
  });
  return out;
}

function monstersPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `Enemies walk straight at the nearest living monkey and hurt it on touch. HP grows ${pct(HP_SCALE_PER_MINUTE)} of base per minute; speed starts at ${pct(SPEED_SCALE_START)} and rises ${pct(SPEED_SCALE_PER_MINUTE, 1)} per minute up to 100%. In co-op HP is also multiplied by the player count (see CO-OP).`,
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
    text: 'SPEED is px per second at full speed. DAMAGE is per hit before armor; a monkey cannot be hit again for ' +
      `${secs(INVULN_SECONDS)} after a hit. KB RESIST is how much knockback is ignored. SIZE is the collision radius in px.`,
    color: COLOR.textDim,
  });
  return out;
}

function wavesPage(): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `The run lasts ${formatTime(RUN_SECONDS)}. Every ${SPAWN_TICK_MS} ms the spawner tops the horde up toward ON FIELD, at most a sixth of it per tick, on a ring just outside a random living monkey's screen. At most ${MAX_ENEMIES} enemies exist at once. Enemies more than ${DESPAWN_SCREENS} screens away from every monkey are moved back near one, keeping their HP.`,
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
    out.push({ t: 'p', text: `${formatTime(ev.at)} · SWARM: a ring of ${ev.count} ${enemyDef(ev.enemy).name.toUpperCase()}S closes in around every living monkey.` });
  }
  out.push({ t: 'p', text: `${formatTime(RUN_SECONDS)} · DAWN: every enemy dies and the run is won.` });
  return out;
}

function dropsPage(): Block[] {
  const out: Block[] = [
    { t: 'h', text: 'EXP GEMS' },
    {
      t: 'p',
      text: `Every kill drops a gem worth the monster's EXP. Once a gem is inside a monkey's PICKUP RADIUS it flies straight to that monkey, always faster than it can run. Past ${MAX_GEMS} gems on the ground, new drops merge into the nearest gem, which changes colour as it grows:`,
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
      text: `A rare drop from any enemy (chance per monster below). Walk over it to drink it; a monkey at full HP walks past without using it. It stays for ${POTION.lifetime}S (blinking for the last 5) and at most ${POTION.maxOnGround} lie on the ground at once.`,
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
      text: `Each level up offers 3 random cards: new weapons or items (while you have free slots) and upgrades to ones you own. With everything maxed the only card is a heal of ${FALLBACK_HEAL} HP. EXP needed for the next level:`,
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
    { t: 'h', text: 'SHARED EXP' },
    {
      t: 'p',
      text: 'The team shares one EXP bar and level. Every level gives each monkey its own card pick, and the run is held until everyone has chosen. EXP GAIN of the monkey that picks a gem up applies.',
    },
    { t: 'h', text: 'ENEMY HP' },
    {
      t: 'p',
      text: `Enemy HP × (1 + ${HP_SCALE_PER_EXTRA_PLAYER} × (players - 1)). Enemies chase the nearest living monkey and spawn around a random one.`,
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
      text: `A monkey at 0 HP falls and watches a teammate. Stand within ${REVIVE.radius} px of the body for ${REVIVE.seconds}S to revive it; the bar drains again while nobody stands there. Revived monkeys get ${secs(REVIVE.invulnSeconds)} of invulnerability and make the level-up picks they missed. The run is lost when every monkey is down.`,
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
      text: 'You only steer the monkey (WASD or arrows); weapons fire on their own. Some weapons aim where you last moved. The arena is a walled graveyard; graves and decor never block you.',
    },
    { t: 'h', text: 'TAKING DAMAGE' },
    {
      t: 'p',
      text: `Touching an enemy deals its DAMAGE minus your ARMOR (at least 1). After a hit you are invulnerable for ${secs(INVULN_SECONDS)}. Hits push enemies back by the weapon's KNOCKBACK in px, reduced by the enemy's KB RESIST.`,
    },
    { t: 'h', text: 'CARDS AND SLOTS' },
    {
      t: 'p',
      text: `${MAX_WEAPONS} weapon slots and ${MAX_ITEMS} item slots. Each weapon and item goes up to level ${MAX_LEVEL}. Several level-ups in a row are offered one after another.`,
    },
    { t: 'h', text: 'WINNING' },
    { t: 'p', text: `Survive until ${formatTime(RUN_SECONDS)} and dawn breaks: every enemy on the field dies and the run is won.` },
    { t: 'h', text: 'CONTROLS' },
    { t: 'p', text: 'ESC or P: menu (pauses in solo). M: mute. F3: debug overlay. Level-up: 1 2 3, arrows and ENTER, or click.' },
    { t: 'h', text: 'FEEDBACK' },
    {
      t: 'p',
      text: 'Every number in this wiki comes straight from the game data, so it matches the build you are playing. Quote the tab and the values when you suggest balance changes.',
      color: COLOR.textDim,
    },
  ];
}

export const WIKI_PAGES: WikiPage[] = [
  { tab: 'WEAPONS', source: 'src/data/weapons.ts', blocks: weaponsPage },
  { tab: 'ITEMS', source: 'src/data/items.ts, src/data/player.ts', blocks: itemsPage },
  { tab: 'MONSTERS', source: 'src/data/enemies.ts', blocks: monstersPage },
  { tab: 'WAVES', source: 'src/data/waves.ts', blocks: wavesPage },
  { tab: 'DROPS', source: 'src/data/drops.ts, src/core/progression.ts', blocks: dropsPage },
  { tab: 'CO-OP', source: 'src/data/coop.ts, src/data/waves.ts', blocks: coopPage },
  { tab: 'RULES', source: 'src/constants.ts', blocks: mechanicsPage },
];
