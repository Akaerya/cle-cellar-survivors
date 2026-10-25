import Phaser from 'phaser';
import { FONT_MAIN, FONT_TINY } from './font';
import { PALETTE, SPRITES, TILES } from './spriteData';

/**
 * Turns the character-grid art into GPU textures at boot:
 * - one texture atlas ('atlas') with every sprite frame,
 * - an extruded tileset ('tiles') for the arena tilemap,
 * - two outlined pixel bitmap fonts ('font', 'tiny'),
 * - a few UI helper textures.
 */

export const ATLAS = 'atlas';
export const TILESET = 'tiles';
export const FONT = 'font';
export const FONT_SMALL = 'tiny';
export const FONT_SIZE = 9; // native size of 'font' (7px glyphs + outline)
export const FONT_SMALL_SIZE = 7;

/** Tile indices, in TILES order. */
export const TILE_INDEX: Record<string, number> = Object.fromEntries(TILES.map((t, i) => [t.name, i]));

type RGBA = [number, number, number, number];
const colorCache = new Map<string, RGBA>();

function rgba(ch: string): RGBA | null {
  if (ch === '.') return null;
  let c = colorCache.get(ch);
  if (!c) {
    const hex = PALETTE[ch];
    if (!hex) return null;
    const h = hex.replace('#', '');
    c = [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255,
    ];
    colorCache.set(ch, c);
  }
  return c;
}

/** Sprites that also get a greyed-out copy named `${name}_grey` (ultimate icons on cooldown). */
const GREY_PREFIX = 'icon_ult_';

function paint(img: ImageData, rows: string[], ox: number, oy: number, grey = false): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const c = rgba(row[x]);
      if (!c) continue;
      const px = ox + x;
      const py = oy + y;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const i = (py * img.width + px) * 4;
      if (grey) {
        const l = Math.round((c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) * 0.55);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = l;
      } else {
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
      }
      img.data[i + 3] = c[3];
    }
  }
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return [canvas, ctx];
}

const nextPow2 = (n: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, n))));

function buildAtlas(scene: Phaser.Scene): void {
  const sprites = Object.entries(SPRITES).map(([name, rows]) => ({ name, rows, grey: false }));
  for (const [name, rows] of Object.entries(SPRITES)) {
    if (name.startsWith(GREY_PREFIX)) sprites.push({ name: `${name}_grey`, rows, grey: true });
  }
  const entries = sprites.map((s) => ({ ...s, w: s.rows[0].length, h: s.rows.length, x: 0, y: 0 }));
  entries.sort((a, b) => b.h - a.h || b.w - a.w);
  const W = 256;
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
  const img = ctx.createImageData(W, H);
  for (const e of entries) paint(img, e.rows, e.x, e.y, e.grey);
  ctx.putImageData(img, 0, 0);
  const tex = scene.textures.addCanvas(ATLAS, canvas)!;
  for (const e of entries) tex.add(e.name, 0, e.x, e.y, e.w, e.h);
}

export const TILESET_MARGIN = 1;
export const TILESET_SPACING = 2;

function buildTileset(scene: Phaser.Scene): void {
  const ts = 16;
  const n = TILES.length;
  const W = TILESET_MARGIN * 2 + n * ts + (n - 1) * TILESET_SPACING;
  const H = TILESET_MARGIN * 2 + ts;
  const [canvas, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  TILES.forEach((tile, i) => {
    const ox = TILESET_MARGIN + i * (ts + TILESET_SPACING);
    const oy = TILESET_MARGIN;
    // Extrude 1px on every side so camera sub-pixel offsets never sample a neighbour tile.
    for (const [dx, dy] of [
      [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
    ]) {
      paint(img, tile.rows, ox + dx, oy + dy);
    }
    paint(img, tile.rows, ox, oy);
  });
  ctx.putImageData(img, 0, 0);
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

function frames(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: ATLAS, frame: `${prefix}_${i}` }));
}

function buildAnimations(scene: Phaser.Scene): void {
  const a = scene.anims;
  a.create({ key: 'monkey-idle', frames: frames('monkey_idle', 4), frameRate: 4, repeat: -1 });
  a.create({ key: 'monkey-walk', frames: frames('monkey_walk', 4), frameRate: 10, repeat: -1 });
  a.create({ key: 'monkey-hurt', frames: frames('monkey_hurt', 2), frameRate: 10, repeat: 0 });
  a.create({ key: 'knight-idle', frames: frames('knight_idle', 4), frameRate: 4, repeat: -1 });
  a.create({ key: 'knight-walk', frames: frames('knight_walk', 4), frameRate: 10, repeat: -1 });
  a.create({ key: 'knight-hurt', frames: frames('knight_hurt', 2), frameRate: 10, repeat: 0 });
  a.create({ key: 'elysia-idle', frames: frames('elysia_idle', 4), frameRate: 4, repeat: -1 });
  a.create({ key: 'elysia-walk', frames: frames('elysia_walk', 4), frameRate: 10, repeat: -1 });
  a.create({ key: 'elysia-hurt', frames: frames('elysia_hurt', 2), frameRate: 10, repeat: 0 });
  a.create({ key: 'drake-fly', frames: frames('drake', 2), frameRate: 8, repeat: -1 });
  a.create({ key: 'orb-pulse', frames: frames('orb', 2), frameRate: 12, repeat: -1 });
  a.create({ key: 'bat-fly', frames: frames('bat', 4), frameRate: 12, repeat: -1 });
  a.create({ key: 'zombie-walk', frames: frames('zombie', 4), frameRate: 6, repeat: -1 });
  a.create({ key: 'ghoul-run', frames: frames('ghoul', 4), frameRate: 12, repeat: -1 });
  a.create({ key: 'brute-walk', frames: frames('brute', 4), frameRate: 5, repeat: -1 });
  a.create({ key: 'banana-spin', frames: frames('banana', 4), frameRate: 18, repeat: -1 });
  a.create({ key: 'coconut-spin', frames: frames('coconut', 4), frameRate: 10, repeat: -1 });
  a.create({ key: 'arrow-glint', frames: frames('arrow', 2), frameRate: 8, repeat: -1 });
  a.create({ key: 'bloom-pulse', frames: frames('bloom', 2), frameRate: 10, repeat: -1 });
  for (const c of ['blue', 'green', 'red']) {
    a.create({ key: `gem-${c}`, frames: frames(`gem_${c}`, 2), frameRate: 2, repeat: -1 });
  }
}

export function buildAllTextures(scene: Phaser.Scene): void {
  buildAtlas(scene);
  buildTileset(scene);
  buildFont(scene, FONT, FONT_MAIN, 7);
  buildFont(scene, FONT_SMALL, FONT_TINY, 5);
  buildUiTextures(scene);
  buildAnimations(scene);
}
