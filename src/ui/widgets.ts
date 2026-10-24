import Phaser from 'phaser';
import { FONT, FONT_SIZE } from '../art/textures';
import { COLOR } from '../constants';
import { sfx } from '../core/sfx';

export interface TextOpts {
  scale?: number;
  color?: number;
  origin?: [number, number];
  align?: 0 | 1 | 2; // left, center, right
  maxWidth?: number;
  depth?: number;
}

/** Pixel bitmap text at an integer scale. */
export function text(scene: Phaser.Scene, x: number, y: number, str: string, o: TextOpts = {}) {
  const t = scene.add.bitmapText(Math.round(x), Math.round(y), FONT, str, FONT_SIZE * (o.scale ?? 1));
  if (o.origin) t.setOrigin(o.origin[0], o.origin[1]);
  if (o.color !== undefined) t.setTint(o.color);
  if (o.align !== undefined) t.align = o.align;
  if (o.maxWidth) t.setMaxWidth(o.maxWidth);
  if (o.depth !== undefined) t.setDepth(o.depth);
  return t;
}

/** Bordered dark panel with a 1px bevel. */
export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  edge: number = COLOR.panelEdge,
  fill: number = COLOR.panel,
  fillAlpha = 0.94,
): void {
  g.fillStyle(COLOR.ink, 1);
  g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle(fill, fillAlpha);
  g.fillRect(x, y, w, h);
  g.lineStyle(1, edge, 1);
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle(0xffffff, 0.06);
  g.fillRect(x + 1, y + 1, w - 2, 1);
}

/** A clickable, keyboard-selectable button. */
export class Button {
  readonly g: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.BitmapText;
  readonly zone: Phaser.GameObjects.Zone;
  selected = false;
  private hover = false;

  constructor(
    scene: Phaser.Scene,
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    caption: string,
    public onClick: () => void,
    public onHover?: () => void,
  ) {
    this.g = scene.add.graphics();
    this.label = text(scene, x + w / 2, y + h / 2 + 1, caption, { origin: [0.5, 0.5] });
    this.zone = scene.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.zone.on('pointerover', () => {
      this.hover = true;
      this.onHover?.();
      this.redraw();
    });
    this.zone.on('pointerout', () => {
      this.hover = false;
      this.redraw();
    });
    this.zone.on('pointerup', () => this.press());
    this.redraw();
  }

  setDepth(d: number): this {
    this.g.setDepth(d);
    this.label.setDepth(d + 0.1);
    this.zone.setDepth(d + 0.2);
    return this;
  }

  setVisible(v: boolean): this {
    this.g.setVisible(v);
    this.label.setVisible(v);
    if (v) this.zone.setInteractive({ useHandCursor: true });
    else this.zone.disableInteractive();
    return this;
  }

  press(): void {
    sfx.unlock();
    sfx.play('select');
    this.onClick();
  }

  setSelected(v: boolean): void {
    this.selected = v;
    this.redraw();
  }

  redraw(): void {
    const on = this.selected || this.hover;
    this.g.clear();
    drawPanel(this.g, this.x, this.y, this.w, this.h, on ? COLOR.gold : COLOR.panelEdge, on ? 0x2e2342 : COLOR.panel);
    this.label.setTint(on ? COLOR.gold : COLOR.text);
  }
}

/** Keyboard navigation over a list of buttons (arrows/WASD + Enter/Space). */
export class Menu {
  index = 0;
  /** Off while something else owns the keyboard (e.g. typing a name). */
  enabled = true;

  constructor(
    scene: Phaser.Scene,
    public buttons: Button[],
    horizontal = false,
  ) {
    buttons.forEach((b, i) => {
      const prev = b.onHover;
      b.onHover = () => {
        prev?.();
        this.select(i, false);
      };
    });
    const back = horizontal ? ['LEFT', 'A'] : ['UP', 'W'];
    const fwd = horizontal ? ['RIGHT', 'D'] : ['DOWN', 'S'];
    for (const k of back) onKey(scene, `keydown-${k}`, () => this.enabled && this.move(-1));
    for (const k of fwd) onKey(scene, `keydown-${k}`, () => this.enabled && this.move(1));
    onKey(scene, 'keydown-ENTER', () => this.enabled && this.buttons[this.index]?.press());
    onKey(scene, 'keydown-SPACE', () => this.enabled && this.buttons[this.index]?.press());
    this.select(0, false);
  }

  move(d: number): void {
    const n = this.buttons.length;
    this.select((this.index + d + n) % n, true);
  }

  select(i: number, sound: boolean): void {
    if (sound && i !== this.index) sfx.play('hover');
    this.index = i;
    this.buttons.forEach((b, j) => b.setSelected(j === i));
  }
}

/**
 * Registers a keyboard handler that is removed automatically when the scene shuts down.
 * Phaser re-scans its keyboard queue on every DOM key event until the frame ends, so when two keys
 * arrive within one frame the earlier one is emitted again; each handler ignores events it has seen.
 */
export function onKey(scene: Phaser.Scene, event: string, fn: (e: KeyboardEvent) => void): void {
  const kb = scene.input.keyboard!;
  const seen = new WeakSet<KeyboardEvent>();
  const handler = (e: KeyboardEvent) => {
    if (e) {
      if (seen.has(e)) return;
      seen.add(e);
    }
    fn(e);
  };
  kb.on(event, handler);
  scene.events.once('shutdown', () => kb.off(event, handler));
}
