import Phaser from 'phaser';
import { TILESET, TILESET_MARGIN, TILESET_SPACING, TILE_INDEX } from '../art/textures';
import { ARENA_TILES, DEPTH, TILE, WALL_TILES } from '../constants';
import type { Rng } from '../core/rng';

/**
 * Builds the 200x200 walled arena in code: a floor layer of flagstone and earth patches,
 * a decor layer of graves, dead grass and bones that never blocks movement,
 * and a collidable wall layer around the border.
 */
export function buildArena(scene: Phaser.Scene, rng: Rng) {
  const N = ARENA_TILES;
  const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: N, height: N });
  const tileset = map.addTilesetImage('tiles', TILESET, TILE, TILE, TILESET_MARGIN, TILESET_SPACING)!;
  const floor = map.createBlankLayer('floor', tileset)!.setDepth(DEPTH.floor);
  const decor = map.createBlankLayer('decor', tileset)!.setDepth(DEPTH.decor);
  const walls = map.createBlankLayer('walls', tileset)!.setDepth(DEPTH.wall);

  const T = TILE_INDEX;
  const noise = valueNoise(N, 14, rng);
  const center = N / 2;
  const isEarth = (x: number, y: number) => noise(x, y) > 0.52;

  // Floor
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let idx: number;
      if (isEarth(x, y)) {
        idx = rng.float() < 0.22 ? T.earth_b : T.earth_a;
      } else {
        const r = rng.float();
        idx = r < 0.5 ? T.floor_a : r < 0.85 ? T.floor_b : T.floor_c;
      }
      floor.putTileAt(idx, x, y, false);
    }
  }

  const inside = (x: number, y: number) =>
    x >= WALL_TILES + 1 && y >= WALL_TILES + 2 && x < N - WALL_TILES - 1 && y < N - WALL_TILES - 1;
  const nearStart = (x: number, y: number) => Math.abs(x - center) < 9 && Math.abs(y - center) < 7;
  const occupied = new Set<number>();
  const place = (idx: number, x: number, y: number) => {
    if (!inside(x, y) || nearStart(x, y) || occupied.has(y * N + x)) return;
    occupied.add(y * N + x);
    decor.putTileAt(idx, x, y, false);
  };

  // Graveyard clusters: rows of headstones, mostly on earth patches.
  const graves = [T.grave_round, T.grave_round, T.grave_cross, T.grave_broken];
  for (let c = 0; c < 170; c++) {
    const cx = rng.int(4, N - 5);
    const cy = rng.int(4, N - 5);
    if (!isEarth(cx, cy) && rng.float() < 0.7) continue;
    const rows = rng.int(1, 3);
    const cols = rng.int(2, 5);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        if (rng.float() < 0.18) continue;
        place(rng.pick(graves), cx + k * 2, cy + r * 3);
      }
    }
  }

  // Scatter: dead grass, bones, cracks.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = rng.float();
      if (isEarth(x, y)) {
        if (r < 0.05) place(rng.float() < 0.5 ? T.grass_a : T.grass_b, x, y);
        else if (r < 0.056) place(T.bones, x, y);
      } else {
        if (r < 0.012) place(T.crack, x, y);
        else if (r < 0.018) place(T.grass_b, x, y);
        else if (r < 0.021) place(T.bones, x, y);
      }
    }
  }

  // Border wall, 2 tiles thick. The top wall shows its brick face; the others show their top with a lip.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const inWall = x < WALL_TILES || y < WALL_TILES || x >= N - WALL_TILES || y >= N - WALL_TILES;
      if (!inWall) continue;
      const corner = (x < WALL_TILES || x >= N - WALL_TILES) && (y < WALL_TILES || y >= N - WALL_TILES);
      let idx = T.wall_top;
      let flipX = false;
      let flipY = false;
      if (!corner) {
        if (y === WALL_TILES - 1) idx = T.wall_face;
        else if (y === N - WALL_TILES) {
          idx = T.wall_lip;
          flipY = true;
        } else if (x === WALL_TILES - 1) {
          idx = T.wall_lip_w;
          flipX = true;
        } else if (x === N - WALL_TILES) idx = T.wall_lip_w;
      }
      const tile = walls.putTileAt(idx, x, y, false);
      tile.flipX = flipX;
      tile.flipY = flipY;
    }
  }
  // Shadow cast by the top wall onto the first floor row.
  for (let x = WALL_TILES; x < N - WALL_TILES; x++) decor.putTileAt(T.floor_shadow, x, WALL_TILES, false);

  walls.setCollisionByExclusion([-1], true);
  return { map, floor, decor, walls };
}

/** Smooth value noise in 0..1, sampled per tile. */
function valueNoise(size: number, cell: number, rng: Rng) {
  const g = Math.ceil(size / cell) + 2;
  const grid = new Float32Array(g * g);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.float();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = x / cell;
    const fy = y / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const v = (ix: number, iy: number) => grid[iy * g + ix];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}
