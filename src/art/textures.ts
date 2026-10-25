import Phaser from 'phaser';
import { FONT_MAIN, FONT_TINY } from './font';
import SHEETS from './sprites/sprites.json';

/**
 * Builds GPU textures at boot from the Aseprite exports in `src/art/sprites` (see README, "Art"):
 * - one texture atlas ('atlas') with every sprite frame, named as in `sprites/sprites.json`,
 * - an extruded tileset ('tiles') for the arena tilemap, from the frames of `tiles.aseprite`,
 * - two outlined pixel bitmap fonts ('font', 'tiny'),
 * - a few UI helper textures.
 */

export const ATLAS = 'atlas';
export const TILESET = 'tiles';
export const FONT = 'font';
export const FONT_SMALL = 'tiny';
export const FONT_SIZE = 9; // native size of 'font' (7px glyphs + outline)
export const FONT_SMALL_SIZE = 7;

interface Sheet {
  /** Frame size (every frame of a sheet is the same size). */
  w: number;
  h: number;
  /** Frame name -> [x, y, duration in ms] in the sheet's PNG strip. */
  frames: Record<string, [number, number, number]>;
}
const sheets = SHEETS as unknown as Record<string, Sheet>;
const sheetUrls = import.meta.glob('./sprites/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const sheetKey = (name: string) => `sheet:${name}`;
const TILES_SHEET = 'tiles';

/** Tile indices, in the frame order of tiles.aseprite. */
export const TILE_INDEX: Record<string, number> = Object.fromEntries(Object.keys(sheets[TILES_SHEET].frames).map((n, i) => [n, i]));

/** Queues every sprite sheet PNG; call from the boot scene's preload. */
export function loadSpriteSheets(scene: Phaser.Scene): void {
  for (const name of Object.keys(sheets)) {
    const url = sheetUrls[`./sprites/${name}.png`];
    if (!url) throw new Error(`src/art/sprites/${name}.png is missing: run npm run sprites`);
    scene.load.image(sheetKey(name), url);
  }
}

/** Sprites that also get a greyed-out copy named `${name}_grey` (ultimate icons on cooldown). */
const GREY_PREFIX = 'icon_ult_';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}

const nextPow2 = (n: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, n))));
const sheetImage = (scene: Phaser.Scene, name: string) =>
  scene.textures.get(sheetKey(name)).getSourceImage() as CanvasImageSource;

/** Greys out an area of the canvas in place (darkened luminance). */
function greyOut(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i + 1] = d[i + 2] = Math.round((d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * 0.55);
  }
  ctx.putImageData(img, x, y);
}

/** Packs every frame of every sheet (except the tiles) into one atlas texture. */
function buildAtlas(scene: Phaser.Scene): void {
  type Entry = { name: string; sheet: string; sx: number; sy: number; w: number; h: number; grey: boolean; x: number; y: number };
  const entries: Entry[] = [];
  for (const [sheet, s] of Object.entries(sheets)) {
    if (sheet === TILES_SHEET) continue;
    for (const [name, [sx, sy]] of Object.entries(s.frames)) {
      entries.push({ name, sheet, sx, sy, w: s.w, h: s.h, grey: false, x: 0, y: 0 });
      if (name.startsWith(GREY_PREFIX)) entries.push({ name: `${name}_grey`, sheet, sx, sy, w: s.w, h: s.h, grey: true, x: 0, y: 0 });
    }
  }
  entries.sort((a, b) => b.h - a.h || b.w - a.w);
  const W = 512;
  let x = 1;
  let y = 1;
  let shelf = 0;
  for (const e of entries) {
    if (x + e.w + 1 > W) {
      x = 1;
      y += shelf + 2;
      shelf = 0;
    }
    e.x = x;
    e.y = y;
    x += e.w + 2;
    shelf = Math.max(shelf, e.h);
  }
  const H = nextPow2(y + shelf + 2);
  const [canvas, ctx] = makeCanvas(W, H);
  for (const e of entries) {
    ctx.drawImage(sheetImage(scene, e.sheet), e.sx, e.sy, e.w, e.h, e.x, e.y, e.w, e.h);
    if (e.grey) greyOut(ctx, e.x, e.y, e.w, e.h);
  }
  const tex = scene.textures.addCanvas(ATLAS, canvas)!;
  for (const e of entries) tex.add(e.name, 0, e.x, e.y, e.w, e.h);
}

export const TILESET_MARGIN = 1;
export const TILESET_SPACING = 2;

function buildTileset(scene: Phaser.Scene): void {
  const { w: ts, frames } = sheets[TILES_SHEET];
  const tiles = Object.values(frames);
  const n = tiles.length;
  const W = TILESET_MARGIN * 2 + n * ts + (n - 1) * TILESET_SPACING;
  const H = TILESET_MARGIN * 2 + ts;
  const [canvas, ctx] = makeCanvas(W, H);
  const src = sheetImage(scene, TILES_SHEET);
  tiles.forEach(([sx, sy], i) => {
    const ox = TILESET_MARGIN + i * (ts + TILESET_SPACING);
    const oy = TILESET_MARGIN;
    // Extrude 1px on every side so camera sub-pixel offsets never sample a neighbour tile.
    for (const [dx, dy] of [
      [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
    ]) {
      ctx.drawImage(src, sx, sy, ts, ts, ox + dx, oy + dy, ts, ts);
    }
    ctx.drawImage(src, sx, sy, ts, ts, ox, oy, ts, ts);
  });
  scene.textures.addCanvas(TILESET, canvas);
}

function buildFont(scene: Phaser.Scene, key: string, glyphs: Record<string, string[]>, glyphH: number): void {
  const chars = Object.keys(glyphs);
  const cellH = glyphH + 2;
  const W = 256;
  const cells: { ch: string; x: number; y: number; w: number; gw: number }[] = [];
  let x = 0;
  let y = 0;
  for (const ch of chars) {
    const gw = glyphs[ch][0].length;
    const w = gw + 2;
    if (x + w > W) {
      x = 0;
      y += cellH + 1;
    }
    cells.push({ ch, x, y, w, gw });
    x += w + 1;
  }
  const H = nextPow2(y + cellH + 1);
  const [canvas, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const set = (px: number, py: number, r: number, g: number, b: number) => {
    const i = (py * W + px) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  };
  for (const c of cells) {
    const rows = glyphs[c.ch];
    // outline first (8-neighbourhood), then white ink on top
    for (let gy = 0; gy < glyphH; gy++) {
      for (let gx = 0; gx < c.gw; gx++) {
        if (rows[gy][gx] !== '#') continue;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) set(c.x + 1 + gx + ox, c.y + 1 + gy + oy, 20, 14, 30);
      }
    }
    for (let gy = 0; gy < glyphH; gy++) {
      for (let gx = 0; gx < c.gw; gx++) {
        if (rows[gy][gx] === '#') set(c.x + 1 + gx, c.y + 1 + gy, 255, 255, 255);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, canvas);

  const data: any = { font: key, size: cellH, lineHeight: cellH + 1, chars: {} };
  for (const c of cells) {
    const entry = {
      x: c.x,
      y: c.y,
      width: c.w,
      height: cellH,
      centerX: Math.floor(c.w / 2),
      centerY: Math.floor(cellH / 2),
      xOffset: 0,
      yOffset: 0,
      xAdvance: c.gw + 1,
      data: {},
      kerning: {},
      u0: c.x / W,
      v0: 1 - c.y / H,
      u1: (c.x + c.w) / W,
      v1: 1 - (c.y + cellH) / H,
    };
    data.chars[c.ch.charCodeAt(0)] = entry;
    const lower = c.ch.toLowerCase();
    if (lower !== c.ch) data.chars[lower.charCodeAt(0)] = entry;
  }
  scene.cache.bitmapFont.add(key, { data, texture: key, frame: null });
}

function buildUiTextures(scene: Phaser.Scene): void {
  // Soft dark vignette for menus.
  const [vc, vctx] = makeCanvas(320, 180);
  const grad = vctx.createRadialGradient(160, 90, 30, 160, 90, 200);
  grad.addColorStop(0, 'rgba(10,6,16,0)');
  grad.addColorStop(1, 'rgba(10,6,16,0.85)');
  vctx.fillStyle = grad;
  vctx.fillRect(0, 0, 320, 180);
  scene.textures.addCanvas('vignette', vc);

  // Red hurt border for the HUD.
  const [hc, hctx] = makeCanvas(320, 180);
  const hg = hctx.createRadialGradient(160, 90, 70, 160, 90, 190);
  hg.addColorStop(0, 'rgba(232,68,58,0)');
  hg.addColorStop(1, 'rgba(232,68,58,0.75)');
  hctx.fillStyle = hg;
  hctx.fillRect(0, 0, 320, 180);
  scene.textures.addCanvas('hurt-vignette', hc);

  const [wc, wctx] = makeCanvas(4, 4);
  wctx.fillStyle = '#fff';
  wctx.fillRect(0, 0, 4, 4);
  scene.textures.addCanvas('white', wc);
}

/**
 * Animations: key -> frame-name prefix (frames `${prefix}_0`, `_1`, ... in order, as many as the sheet has).
 * Frame timings come from the frame durations set in Aseprite. Animations loop unless `once`.
 */
const ANIMS: { key: string; frames: string; once?: boolean }[] = [
  ...['monkey', 'knight', 'elysia'].flatMap((c) => [
    { key: `${c}-idle`, frames: `${c}_idle` },
    { key: `${c}-walk`, frames: `${c}_walk` },
    { key: `${c}-hurt`, frames: `${c}_hurt`, once: true },
  ]),
  { key: 'drake-fly', frames: 'drake' },
  { key: 'orb-pulse', frames: 'orb' },
  { key: 'spider-crawl', frames: 'spider' },
  { key: 'bloomboss-sway', frames: 'bloomboss' },
  { key: 'leviathan-swim', frames: 'leviathan' },
  { key: 'cyclops-stomp', frames: 'cyclops' },
  { key: 'sprout-sway', frames: 'sprout' },
  { key: 'pollen-drift', frames: 'pollen' },
  { key: 'caustic-bubble', frames: 'caustic' },
  { key: 'crystalbud-grow', frames: 'crystalbud', once: true },
  { key: 'bat-fly', frames: 'bat' },
  { key: 'zombie-walk', frames: 'zombie' },
  { key: 'ghoul-run', frames: 'ghoul' },
  { key: 'brute-walk', frames: 'brute' },
  { key: 'banana-spin', frames: 'banana' },
  { key: 'coconut-spin', frames: 'coconut' },
  { key: 'arrow-glint', frames: 'arrow' },
  { key: 'bloom-pulse', frames: 'bloom' },
  ...['blue', 'green', 'red'].map((c) => ({ key: `gem-${c}`, frames: `gem_${c}` })),
];

/** Frame name -> duration in ms, across every sheet. */
const durations = new Map(Object.values(sheets).flatMap((s) => Object.entries(s.frames).map(([n, f]) => [n, f[2]] as const)));

function buildAnimations(scene: Phaser.Scene): void {
  for (const a of ANIMS) {
    const frames: Phaser.Types.Animations.AnimationFrame[] = [];
    for (let i = 0; durations.has(`${a.frames}_${i}`); i++) {
      const frame = `${a.frames}_${i}`;
      frames.push({ key: ATLAS, frame, duration: durations.get(frame) });
    }
    if (!frames.length) throw new Error(`animation ${a.key}: no frames named ${a.frames}_0, _1, ...`);
    scene.anims.create({ key: a.key, frames, repeat: a.once ? 0 : -1 });
  }
}

/** Builds everything from the sheets queued by loadSpriteSheets, then frees the sheet textures. */
export function buildAllTextures(scene: Phaser.Scene): void {
  buildAtlas(scene);
  buildTileset(scene);
  for (const name of Object.keys(sheets)) scene.textures.remove(sheetKey(name));
  buildFont(scene, FONT, FONT_MAIN, 7);
  buildFont(scene, FONT_SMALL, FONT_TINY, 5);
  buildUiTextures(scene);
  buildAnimations(scene);
}
