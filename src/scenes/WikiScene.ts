import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, SCENES, VIEW_H, VIEW_W } from '../constants';
import { sfx } from '../core/sfx';
import { Button, onKey, text } from '../ui/widgets';
import { WIKI_PAGES, type Block, type Cell } from '../wiki/pages';

const TOP = 30;
const BOTTOM = VIEW_H - 22;
const LEFT = 20;
const WIDTH = VIEW_W - 44;
const SCROLL_SPEED = 260;

/**
 * Wiki: weapons, items, monsters, waves, drops, co-op and rules, generated from the game data
 * (see wiki/pages.ts). Opened from the title screen or the pause menu.
 */
export class WikiScene extends Phaser.Scene {
  private static lastTab = 0;
  private from: 'title' | 'pause' = 'title';
  private tab = 0;
  private content!: Phaser.GameObjects.Container;
  private contentH = 0;
  private scroll = 0;
  private tabs: Button[] = [];
  private source!: Phaser.GameObjects.BitmapText;
  private bar!: Phaser.GameObjects.Graphics;
  private keys!: { up: Phaser.Input.Keyboard.Key[]; down: Phaser.Input.Keyboard.Key[] };

  constructor() {
    super(SCENES.wiki);
  }

  create(data?: { from?: 'title' | 'pause' }): void {
    this.from = data?.from ?? 'title';
    this.add.rectangle(0, 0, VIEW_W, VIEW_H, COLOR.panel, 1).setOrigin(0);
    this.content = this.add.container(0, 0).setDepth(1);

    // Opaque bands above and below the scroll area stand in for a mask.
    const frame = this.add.graphics().setDepth(2);
    frame.fillStyle(COLOR.panel, 1);
    frame.fillRect(0, 0, VIEW_W, TOP - 2);
    frame.fillRect(0, BOTTOM + 2, VIEW_W, VIEW_H - BOTTOM - 2);
    frame.lineStyle(1, COLOR.panelEdge, 1);
    frame.lineBetween(0, TOP - 2.5, VIEW_W, TOP - 2.5);
    frame.lineBetween(0, BOTTOM + 2.5, VIEW_W, BOTTOM + 2.5);
    this.bar = this.add.graphics().setDepth(3);

    const tw = 78;
    const gap = 4;
    const x0 = Math.round((VIEW_W - (WIKI_PAGES.length * (tw + gap) - gap)) / 2);
    this.tabs = WIKI_PAGES.map((p, i) => new Button(this, x0 + i * (tw + gap), 6, tw, 17, p.tab, () => this.show(i)).setDepth(3));
    this.source = text(this, 8, VIEW_H - 14, '', { color: COLOR.textDim, depth: 3 });
    text(this, VIEW_W - 8, VIEW_H - 14, 'ARROWS SCROLL/TABS · ESC CLOSE', { origin: [1, 0], color: COLOR.textDim, depth: 3 });

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = { up: [kb.addKey(K.UP), kb.addKey(K.W)], down: [kb.addKey(K.DOWN), kb.addKey(K.S)] };
    onKey(this, 'keydown-LEFT', () => this.show(this.tab - 1));
    onKey(this, 'keydown-A', () => this.show(this.tab - 1));
    onKey(this, 'keydown-RIGHT', () => this.show(this.tab + 1));
    onKey(this, 'keydown-D', () => this.show(this.tab + 1));
    onKey(this, 'keydown-PAGE_DOWN', () => this.scrollBy(BOTTOM - TOP - 30));
    onKey(this, 'keydown-PAGE_UP', () => this.scrollBy(-(BOTTOM - TOP - 30)));
    onKey(this, 'keydown-ESC', () => this.close());
    onKey(this, 'keydown-P', () => this.close());
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scrollBy(dy * 0.4));

    this.show(WikiScene.lastTab, false);
  }

  update(_t: number, delta: number): void {
    const held = (list: Phaser.Input.Keyboard.Key[]) => list.some((k) => k.isDown);
    const dir = (held(this.keys.down) ? 1 : 0) - (held(this.keys.up) ? 1 : 0);
    if (dir) this.scrollBy((dir * SCROLL_SPEED * delta) / 1000);
  }

  private show(i: number, sound = true): void {
    const n = WIKI_PAGES.length;
    this.tab = ((i % n) + n) % n;
    WikiScene.lastTab = this.tab;
    if (sound) sfx.play('hover');
    this.tabs.forEach((b, j) => b.setSelected(j === this.tab));
    const page = WIKI_PAGES[this.tab];
    this.source.setText(`DATA: ${page.source}`);
    this.content.removeAll(true);
    this.contentH = this.render(page.blocks());
    this.scroll = 0;
    this.applyScroll();
  }

  /** Lays the blocks out top to bottom; returns the height used. */
  private render(blocks: Block[]): number {
    let y = TOP + 4;
    const add = (o: Phaser.GameObjects.GameObject) => this.content.add(o);
    for (const b of blocks) {
      switch (b.t) {
        case 'h':
          y += 4;
          add(text(this, LEFT, y, b.text, { color: COLOR.gold }));
          y += 13;
          break;
        case 'p': {
          const t = text(this, LEFT, y, b.text.toUpperCase(), { color: b.color ?? COLOR.text, maxWidth: WIDTH });
          add(t);
          y += t.height + 3;
          break;
        }
        case 'entry': {
          const icon = this.add.image(LEFT, y, ATLAS, b.icon).setOrigin(0).setScale(b.scale ?? 1);
          add(icon);
          const x = LEFT + Math.max(18, icon.displayWidth + 6);
          add(text(this, x, y + 1, b.title.toUpperCase(), { color: COLOR.gold }));
          const sub = text(this, x, y + 12, b.sub.toUpperCase(), { color: COLOR.textDim, maxWidth: WIDTH - (x - LEFT) });
          add(sub);
          y += Math.max(icon.displayHeight, 12 + sub.height) + 4;
          break;
        }
        case 'table': {
          const row = (cells: Cell[], header: boolean) => {
            let x = LEFT;
            let h = 10;
            cells.forEach((c, i) => {
              const col = b.cols[i];
              const label = typeof c === 'string' ? c : c.text;
              const color = header ? COLOR.textDim : typeof c === 'string' ? (i === 0 ? COLOR.gold : COLOR.text) : (c.color ?? COLOR.text);
              const t = text(this, x, y, label.toUpperCase(), { color, maxWidth: col.w - 6 });
              add(t);
              h = Math.max(h, t.height + 1);
              x += col.w;
            });
            y += h;
          };
          row(b.cols.map((c) => c.label), true);
          const line = this.add.graphics();
          line.lineStyle(1, COLOR.panelEdge, 1);
          line.lineBetween(LEFT, y - 0.5, LEFT + b.cols.reduce((a, c) => a + c.w, 0) - 6, y - 0.5);
          add(line);
          y += 2;
          for (const r of b.rows) row(r, false);
          y += 4;
          break;
        }
        case 'gap':
          y += b.h;
          break;
      }
    }
    return y - TOP;
  }

  private scrollBy(d: number): void {
    this.scroll += d;
    this.applyScroll();
  }

  private applyScroll(): void {
    const view = BOTTOM - TOP;
    const max = Math.max(0, this.contentH - view + 6);
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, max);
    this.content.y = -Math.round(this.scroll);
    const g = this.bar;
    g.clear();
    if (max <= 0) return;
    const h = Math.max(16, (view * view) / (this.contentH + 6));
    const y = TOP + ((view - h) * this.scroll) / max;
    g.fillStyle(COLOR.inkSoft, 1);
    g.fillRect(VIEW_W - 8, TOP, 4, view);
    g.fillStyle(COLOR.panelHi, 1);
    g.fillRect(VIEW_W - 8, y, 4, h);
  }

  private close(): void {
    sfx.play('pause');
    if (this.from === 'pause') {
      this.scene.stop();
      this.scene.resume(SCENES.pause);
    } else {
      this.scene.start(SCENES.title);
    }
  }
}
