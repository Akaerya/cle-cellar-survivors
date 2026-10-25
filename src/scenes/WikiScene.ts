import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, SCENES, VIEW_H, VIEW_W } from '../constants';
import { sfx } from '../core/sfx';
import { Button, onKey, text } from '../ui/widgets';
import { WIKI_PAGES, type Block, type Cell } from '../wiki/pages';

/** Tab buttons: y of the first row and height. */
const TABS_Y = 6;
const TAB_H = 17;
const BOTTOM = VIEW_H - 22;
const LEFT = 20;
const WIDTH = VIEW_W - 44;
const SCROLL_SPEED = 260;
/** Tab and filter buttons: px of padding each side of the label, and between buttons. */
const TAB_PAD = 6;
const TAB_GAP = 3;
const CHIP_H = 15;
const CHIP_ROW = CHIP_H + 3;

/**
 * Wiki: characters, weapons, modifications, items, powerups, monsters, rare enemies, bosses, waves, drops, co-op and rules,
 * generated from the game data (see wiki/pages.ts). Long pages have filter chips (by character, tag or entry).
 * Opened from the title screen or the pause menu.
 */
export class WikiScene extends Phaser.Scene {
  private static lastTab = 0;
  /** The filter last picked on each tab, so coming back keeps it. */
  private static lastFilter = new Map<number, number>();
  private from: 'title' | 'pause' = 'title';
  private tab = 0;
  private filter = 0;
  /** Below the tabs (more than one row if they wrap): the top of a page without filters; filter chips start here. */
  private tabsBottom = TABS_Y + TAB_H + 3;
  /** Top of the content: below the tabs and the filter chips. */
  private top = 0;
  private content!: Phaser.GameObjects.Container;
  private contentH = 0;
  private scroll = 0;
  private tabs: Button[] = [];
  private chips: Button[] = [];
  private frame!: Phaser.GameObjects.Graphics;
  private source!: Phaser.GameObjects.BitmapText;
  private hint!: Phaser.GameObjects.BitmapText;
  private bar!: Phaser.GameObjects.Graphics;
  private keys!: { up: Phaser.Input.Keyboard.Key[]; down: Phaser.Input.Keyboard.Key[] };

  constructor() {
    super(SCENES.wiki);
  }

  create(data?: { from?: 'title' | 'pause' }): void {
    this.from = data?.from ?? 'title';
    this.chips = [];
    this.add.rectangle(0, 0, VIEW_W, VIEW_H, COLOR.panel, 1).setOrigin(0);
    this.content = this.add.container(0, 0).setDepth(1);
    // Opaque bands above and below the scroll area stand in for a mask (redrawn when the top moves).
    this.frame = this.add.graphics().setDepth(2);
    this.bar = this.add.graphics().setDepth(3);

    this.tabs = this.buttonRow(
      WIKI_PAGES.map((p) => p.tab),
      TABS_Y,
      TAB_H,
      (i) => this.show(i),
    );
    this.tabsBottom = this.tabs[this.tabs.length - 1].y + TAB_H + 3;
    this.source = text(this, 8, VIEW_H - 14, '', { color: COLOR.textDim, depth: 3 });
    this.hint = text(this, VIEW_W - 8, VIEW_H - 14, '', { origin: [1, 0], color: COLOR.textDim, depth: 3 });

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = { up: [kb.addKey(K.UP), kb.addKey(K.W)], down: [kb.addKey(K.DOWN), kb.addKey(K.S)] };
    onKey(this, 'keydown-LEFT', () => this.show(this.tab - 1));
    onKey(this, 'keydown-A', () => this.show(this.tab - 1));
    onKey(this, 'keydown-RIGHT', () => this.show(this.tab + 1));
    onKey(this, 'keydown-D', () => this.show(this.tab + 1));
    onKey(this, 'keydown-Q', () => this.pickFilter(this.filter - 1, true));
    onKey(this, 'keydown-E', () => this.pickFilter(this.filter + 1, true));
    const digits = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
    digits.forEach((d, i) => onKey(this, `keydown-${d}`, () => this.pickFilter(i, false)));
    onKey(this, 'keydown-PAGE_DOWN', () => this.scrollBy(BOTTOM - this.top - 30));
    onKey(this, 'keydown-PAGE_UP', () => this.scrollBy(-(BOTTOM - this.top - 30)));
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

  /** Buttons as wide as their labels, centred in rows that wrap at the screen width; returns them in order. */
  private buttonRow(labels: string[], y: number, h: number, onPick: (i: number) => void): Button[] {
    const widths = labels.map((l) => {
      const t = text(this, 0, 0, l);
      const w = Math.ceil(t.width) + TAB_PAD * 2;
      t.destroy();
      return w;
    });
    // Greedy wrap, then centre each row.
    const rows: number[][] = [[]];
    let used = 0;
    widths.forEach((w, i) => {
      const row = rows[rows.length - 1];
      if (row.length > 0 && used + TAB_GAP + w > VIEW_W - 16) {
        rows.push([i]);
        used = w;
      } else {
        row.push(i);
        used += (row.length > 1 ? TAB_GAP : 0) + w;
      }
    });
    const out: Button[] = new Array(labels.length);
    rows.forEach((row, r) => {
      const total = row.reduce((a, i) => a + widths[i], 0) + TAB_GAP * (row.length - 1);
      let x = Math.round((VIEW_W - total) / 2);
      for (const i of row) {
        out[i] = new Button(this, x, y + r * (h + 3), widths[i], h, labels[i], () => onPick(i)).setDepth(3);
        x += widths[i] + TAB_GAP;
      }
    });
    return out;
  }

  private show(i: number, sound = true): void {
    const n = WIKI_PAGES.length;
    this.tab = ((i % n) + n) % n;
    WikiScene.lastTab = this.tab;
    if (sound) sfx.play('hover');
    this.tabs.forEach((b, j) => b.setSelected(j === this.tab));
    const page = WIKI_PAGES[this.tab];
    this.source.setText(`DATA: ${page.source}`);

    for (const c of this.chips) {
      c.g.destroy();
      c.label.destroy();
      c.zone.destroy();
    }
    const filters = page.filters?.() ?? [];
    this.chips = filters.length ? this.buttonRow(filters, this.tabsBottom, CHIP_H, (k) => this.pickFilter(k, false)) : [];
    const lastChip = this.chips[this.chips.length - 1];
    const chipRows = lastChip ? Math.round((lastChip.y - this.tabsBottom) / CHIP_ROW) + 1 : 0;
    this.top = this.tabsBottom + 4 + chipRows * CHIP_ROW;
    this.hint.setText(filters.length ? 'ARROWS SCROLL/TABS · 1-9 OR Q/E FILTER · ESC CLOSE' : 'ARROWS SCROLL/TABS · ESC CLOSE');
    this.drawFrame();
    this.filter = Math.min(WikiScene.lastFilter.get(this.tab) ?? 0, Math.max(0, filters.length - 1));
    this.renderPage();
  }

  /** Picks filter chip `k` on the current page (wrapping when cycling with Q/E). */
  private pickFilter(k: number, wrap: boolean): void {
    const n = this.chips.length;
    if (n === 0) return;
    const next = wrap ? ((k % n) + n) % n : k;
    if (next < 0 || next >= n || next === this.filter) return;
    sfx.play('hover');
    this.filter = next;
    WikiScene.lastFilter.set(this.tab, next);
    this.renderPage();
  }

  private renderPage(): void {
    const page = WIKI_PAGES[this.tab];
    this.chips.forEach((c, j) => c.setSelected(j === this.filter));
    const filters = page.filters?.() ?? [];
    this.content.removeAll(true);
    this.contentH = this.render(page.blocks(filters[this.filter] ?? 'ALL'));
    this.scroll = 0;
    this.applyScroll();
  }

  private drawFrame(): void {
    const f = this.frame;
    f.clear();
    f.fillStyle(COLOR.panel, 1);
    f.fillRect(0, 0, VIEW_W, this.top - 2);
    f.fillRect(0, BOTTOM + 2, VIEW_W, VIEW_H - BOTTOM - 2);
    f.lineStyle(1, COLOR.panelEdge, 1);
    f.lineBetween(0, this.top - 2.5, VIEW_W, this.top - 2.5);
    f.lineBetween(0, BOTTOM + 2.5, VIEW_W, BOTTOM + 2.5);
  }

  /** Lays the blocks out top to bottom; returns the height used. */
  private render(blocks: Block[]): number {
    let y = this.top + 4;
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
    return y - this.top;
  }

  private scrollBy(d: number): void {
    this.scroll += d;
    this.applyScroll();
  }

  private applyScroll(): void {
    const view = BOTTOM - this.top;
    const max = Math.max(0, this.contentH - view + 6);
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, max);
    this.content.y = -Math.round(this.scroll);
    const g = this.bar;
    g.clear();
    if (max <= 0) return;
    const h = Math.max(16, (view * view) / (this.contentH + 6));
    const y = this.top + ((view - h) * this.scroll) / max;
    g.fillStyle(COLOR.inkSoft, 1);
    g.fillRect(VIEW_W - 8, this.top, 4, view);
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
