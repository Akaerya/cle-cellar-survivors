/** Engine-level constants. Gameplay numbers that designers tune live in src/data instead. */

export const VIEW_W = 640;
export const VIEW_H = 360;

export const TILE = 16;
export const ARENA_TILES = 200;
export const ARENA_SIZE = ARENA_TILES * TILE; // 3200 px
export const WALL_TILES = 2;
export const WALL = WALL_TILES * TILE;

/** Walkable floor inside the border wall. */
export const INNER = {
  left: WALL,
  top: WALL,
  right: ARENA_SIZE - WALL,
  bottom: ARENA_SIZE - WALL,
};

export const RUN_SECONDS = 15 * 60;
export const MAX_ENEMIES = 400;
export const MAX_GEMS = 300;
export const MAX_WEAPONS = 4;
export const MAX_ITEMS = 4;
export const MAX_LEVEL = 5;
export const INVULN_SECONDS = 0.5;
export const SPAWN_TICK_MS = 500;
export const FALLBACK_HEAL = 30;

/** Enemies further than this many screens away (per axis) are moved back near the edge. */
export const DESPAWN_SCREENS = 1.5;

export const DEPTH = {
  floor: 0,
  decor: 1,
  wall: 2,
  shadows: 4,
  gems: 5,
  aura: 6,
  units: 10, // enemies and the monkey, y-sorted inside 10..11
  projectiles: 20,
  slash: 21,
  fx: 30,
  numbers: 40,
  hpBar: 50,
} as const;

export const COLOR = {
  ink: 0x1b1424,
  inkSoft: 0x2c2338,
  panel: 0x1d1628,
  panelEdge: 0x5a4f73,
  panelHi: 0x8a7fa6,
  gold: 0xf7d84a,
  goldDark: 0xc79a22,
  exp: 0x4aa3ff,
  expHi: 0xa8dcff,
  hp: 0xe8443a,
  hpDark: 0x7a1e26,
  white: 0xffffff,
  text: 0xf2ecff,
  textDim: 0x9d93b8,
  good: 0x7be38a,
  bad: 0xff5a66,
} as const;

/** Scene keys. */
export const SCENES = {
  boot: 'Boot',
  title: 'Title',
  game: 'Game',
  ui: 'UI',
  levelUp: 'LevelUp',
  pause: 'Pause',
  gameOver: 'GameOver',
} as const;
