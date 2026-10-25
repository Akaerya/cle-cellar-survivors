/** Events the Game scene emits on its own `events` emitter; the UI and LevelUp scenes listen. */
export const EV = {
  hpChanged: 'hp-changed', // (hp, maxHp)
  expChanged: 'exp-changed', // (exp, need, level)
  levelUp: 'level-up', // (level)
  killsChanged: 'kills-changed', // (kills)
  timeChanged: 'time-changed', // (seconds)
  buildChanged: 'build-changed', // (weapons, items, mods, powerups: BuildEntry[])
  playerHurt: 'player-hurt', // (amount)
  banner: 'banner', // (text, color)
  debugStats: 'debug-stats', // (stats object)
  debugState: 'debug-state', // (on: boolean)
  runEnded: 'run-ended',
  levelUpOffer: 'level-up-offer', // (reroll: boolean) new cards for the local player are in GameScene.offer
  levelUpWaiting: 'level-up-waiting', // () the local player is done; teammates are still picking
  levelUpOver: 'level-up-over', // () everyone has picked
} as const;

/** Events the UI scene sends back to the Game scene (debug buttons). */
export const DEBUG_EV = {
  toggle: 'debug-toggle',
  spawn: 'debug-spawn',
  addExp: 'debug-add-exp',
  skipMinute: 'debug-skip-minute',
  god: 'debug-god',
  ultReady: 'debug-ult-ready',
  boss: 'debug-boss',
} as const;

export interface BuildEntry {
  id: string;
  name: string;
  icon: string;
  level: number;
  /** Highest level it can reach (shown in gold once there). */
  max?: number;
  damage?: number;
}

/** Per-player numbers collected during a run (host side) for the party screen. */
export interface PlayerRunStats {
  /** Damage dealt by weapons and the ultimate (overkill not counted). */
  damage: number;
  kills: number;
  /** HP lost to enemies (after armor and shields). */
  taken: number;
  /** HP restored by potions and heal cards. */
  healed: number;
  deaths: number;
  /** Teammates this player helped revive. */
  revives: number;
  /** EXP picked up (after EXP gain). */
  exp: number;
  /** Hits a shield blocked completely. */
  blocks: number;
  ultCasts: number;
  /** Critical strikes landed. */
  crits: number;
  /** Level-up rerolls used. */
  rerolls: number;
}

export function emptyRunStats(): PlayerRunStats {
  return { damage: 0, kills: 0, taken: 0, healed: 0, deaths: 0, revives: 0, exp: 0, blocks: 0, ultCasts: 0, crits: 0, rerolls: 0 };
}

/** One weapon (or the ultimate) on the party screen. */
export interface WeaponReport extends BuildEntry {
  damage: number;
  kills: number;
  /** Damage per second since the weapon was picked up. */
  dps: number;
  ultimate?: boolean;
}

export interface PartyMember {
  slot: number;
  name: string;
  character: string;
  /** Left the game before the end. */
  left: boolean;
  stats: PlayerRunStats;
  /** Damage per second over the whole run. */
  dps: number;
  weapons: WeaponReport[];
  items: BuildEntry[];
  mods: BuildEntry[];
  powerups: BuildEntry[];
}

export interface RunSummary {
  victory: boolean;
  time: number;
  level: number;
  kills: number;
  /** Every player in the run, by slot. */
  party: PartyMember[];
  /** The slot of the player this summary is shown to. */
  mySlot: number;
  seed: string;
  /** Co-op: how many players started the run. */
  coopPlayers?: number;
  /** Co-op: how many times a player fell. */
  teamDeaths?: number;
}
