import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, SCENES, VIEW_H, VIEW_W } from '../constants';
import type { RunSummary } from '../core/events';
import { formatTime } from '../core/progression';
import { Button, Menu, drawPanel, onKey, text } from '../ui/widgets';

/** Time survived, level, kills, and every weapon and item with its level. */
export class GameOverScene extends Phaser.Scene {
  constructor() {
    super(SCENES.gameOver);
  }

  create(summary: RunSummary): void {
    const win = summary.victory;
    const dim = this.add.rectangle(0, 0, VIEW_W, VIEW_H, win ? 0x2a2010 : 0x12030a, 0).setOrigin(0);
    this.tweens.add({ targets: dim, fillAlpha: 0.72, duration: 500 });
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);

    const px = 140;
    const py = 28;
    const pw = 360;
    const ph = 304;
    const g = this.add.graphics();
    drawPanel(g, px, py, pw, ph, win ? COLOR.gold : COLOR.panelEdge);

    const title = text(this, VIEW_W / 2, py + 24, win ? 'YOU SURVIVED' : 'YOU DIED', {
      scale: 3,
      origin: [0.5, 0.5],
      color: win ? COLOR.gold : COLOR.bad,
    });
    this.tweens.add({ targets: title, scale: { from: 1.4, to: 1 }, duration: 380, ease: 'Back.easeOut' });
    text(this, VIEW_W / 2, py + 46, win ? 'DAWN BROKE OVER THE GRAVEYARD' : 'THE NIGHT CLAIMED ANOTHER MONKEY', {
      origin: [0.5, 0.5],
      color: COLOR.textDim,
    });

    // Headline numbers.
    const stats: [string, string][] = [
      ['TIME', formatTime(summary.time)],
      ['LEVEL', String(summary.level)],
      ['KILLS', String(summary.kills)],
    ];
    stats.forEach(([k, v], i) => {
      const cx = px + 60 + i * 120;
      text(this, cx, py + 64, k, { origin: [0.5, 0], color: COLOR.textDim });
      text(this, cx, py + 76, v, { scale: 2, origin: [0.5, 0], color: COLOR.text });
    });

    // Build list.
    let y = py + 108;
    text(this, px + 20, y, 'WEAPONS', { color: COLOR.textDim });
    text(this, px + pw - 20, y, 'DAMAGE', { origin: [1, 0], color: COLOR.textDim });
    y += 13;
    for (const w of summary.weapons) {
      this.add.image(px + 20, y, ATLAS, w.icon).setOrigin(0);
      text(this, px + 42, y + 4, w.name.toUpperCase(), { color: COLOR.text });
      text(this, px + 200, y + 4, `LV ${w.level}`, { color: w.level >= 5 ? COLOR.gold : COLOR.text });
      text(this, px + pw - 20, y + 4, String(w.damage ?? 0), { origin: [1, 0], color: COLOR.gold });
      y += 18;
    }
    y += 4;
    text(this, px + 20, y, 'ITEMS', { color: COLOR.textDim });
    y += 13;
    if (summary.items.length === 0) {
      text(this, px + 20, y + 4, 'NONE', { color: COLOR.textDim });
    }
    summary.items.forEach((it, i) => {
      const x = px + 20 + i * 82;
      this.add.image(x, y, ATLAS, it.icon).setOrigin(0);
      text(this, x + 20, y + 4, `${it.name.toUpperCase()} ${it.level}`, { color: it.level >= 5 ? COLOR.gold : COLOR.text });
    });

    text(this, px + pw - 8, py + ph - 8, `SEED ${summary.seed}`, { origin: [1, 1], color: 0x5a4f73 });

    const restart = () => this.scene.start(SCENES.game, {});
    const toTitle = () => {
      this.scene.stop(SCENES.game);
      this.scene.start(SCENES.title);
    };
    const by = py + ph - 40;
    const buttons = [
      new Button(this, VIEW_W / 2 - 132, by, 124, 24, 'RESTART (R)', restart),
      new Button(this, VIEW_W / 2 + 8, by, 124, 24, 'TITLE (T)', toTitle),
    ];
    new Menu(this, buttons, true);
    onKey(this, 'keydown-R', restart);
    onKey(this, 'keydown-T', toTitle);
  }
}
