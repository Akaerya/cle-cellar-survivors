/** Events the Game scene emits on its own `events` emitter; the UI and LevelUp scenes listen. */
export const EV = {
  hpChanged: 'hp-changed', // (hp, maxHp)
  expChanged: 'exp-changed', // (exp, need, level)
  levelUp: 'level-up', // (level)
  killsChanged: 'kills-changed', // (kills)
  timeChanged: 'time-changed', // (seconds)
  buildChanged: 'build-changed', // (weapons: BuildEntry[], items: BuildEntry[])
  playerHurt: 'player-hurt', // (amount)
  banner: 'banner', // (text, color)
  debugStats: 'debug-stats', // (stats object)
  debugState: 'debug-state', // (on: boolean)
  runEnded: 'run-ended',
} as const;

/** Events the UI scene sends back to the Game scene (debug buttons). */
export const DEBUG_EV = {
  toggle: 'debug-toggle',
  spawn: 'debug-spawn',
  addExp: 'debug-add-exp',
  skipMinute: 'debug-skip-minute',
  god: 'debug-god',
} as const;

export interface BuildEntry {
  id: string;
  name: string;
  icon: string;
  level: number;
  damage?: number;
}

export interface RunSummary {
  victory: boolean;
  time: number;
  level: number;
  kills: number;
  weapons: BuildEntry[];
  items: BuildEntry[];
  seed: string;
}
