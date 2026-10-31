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
/** Projectile pool size, shared by every player (splitting projectiles can fill it fast). */
export const MAX_PROJECTILES = 600;
/** Duration effects: most stacks one enemy can carry from one weapon (Reiterate copies stop here). */
export const MAX_EFFECT_STACKS = 30;
/** `followup` weapons: most shots one player's hits can queue in one frame (the rest of that frame's chances are lost). */
export const MAX_FOLLOWUPS = 24;
/** A slow lasts this many ms after the enemy was last on the slowing field (fields refresh it every frame). */
export const SLOW_LINGER_MS = 120;
/** Tint of slowed enemies. */
export const CHILL_TINT = 0x9fd8ff;
/** Tint of stunned enemies (Stun modification). */
export const STUN_TINT = 0xffe27a;
/** However many slows pile up (webs, void fields, Astral Chains), a character keeps at least this share of its move speed. */
export const MIN_MOVE_MULT = 0.1;
export const MAX_WEAPONS = 4;
export const MAX_ITEMS = 4;
export const MAX_LEVEL = 5;
/** Invulnerability after taking a hit: none, so every enemy in a crowd can hurt you (see ENEMY_HIT_COOLDOWN). */
export const INVULN_SECONDS = 0;
/** Seconds before the same enemy (its touch or its thorns) or the same hazard can hurt the same player again. */
export const ENEMY_HIT_COOLDOWN = 0.5;
/** Invulnerability each living player gets when the run resumes after a level-up pick. */
export const LEVELUP_INVULN_SECONDS = 0.25;
export const SPAWN_TICK_MS = 500;
export const FALLBACK_HEAL = 30;
/** `stab` weapons thrust at enemies this many px beyond the blade's reach, so the stab lands as they close in. */
export const STAB_LEAD = 12;
/** Shields never absorb more than this fraction of a hit, however many levels are stacked. */
export const MAX_SHIELD_REDUCTION = 0.9;

/** Co-op: players per run, and how each player is told apart (P1..P4). */
export const MAX_PLAYERS = 4;
export const PLAYER_COLORS = [0xf7d84a, 0x6ec6ff, 0xff7a8a, 0x7be38a] as const;
/** Multiplied into the character sprite; P1 keeps the original colours. */
export const PLAYER_TINTS = [0xffffff, 0xbfe2ff, 0xffc4c9, 0xc8f5c9] as const;

/** Enemies further than this many screens away (per axis) are moved back near the edge. */
export const DESPAWN_SCREENS = 1.5;

export const DEPTH = {
  floor: 0,
  decor: 1,
  wall: 2,
  shadows: 4,
  gems: 5,
  aura: 6,
  units: 10, // enemies and players, y-sorted inside 10..11
  projectiles: 20,
  slash: 21,
  /** Dome ultimates: a see-through overlay above units and projectiles. */
  dome: 25,
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
  lobby: 'Lobby',
  wiki: 'Wiki',
  select: 'CharacterSelect',
} as const;
