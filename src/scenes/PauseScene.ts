import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, SCENES, VIEW_H, VIEW_W } from '../constants';
import { formatTime } from '../core/progression';
import { sfx } from '../core/sfx';
import { Button, Menu, drawPanel, onKey, text } from '../ui/widgets';
import type { GameScene } from './GameScene';

/** Resume, Restart, Quit to title, plus a look at the current build and stats. */
export class PauseScene extends Phaser.Scene {
  constructor() {
    super(SCENES.pause);
  }

  create(): void {
    const run = this.scene.get(SCENES.game) as GameScene;
    this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x0a0610, 0.6).setOrigin(0);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);

    const px = 110;
    const py = 54;
    const pw = 420;
    const ph = 252;
    const g = this.add.graphics();
    drawPanel(g, px, py, pw, ph);
    text(this, VIEW_W / 2, py + 22, 'PAUSED', { scale: 3, origin: [0.5, 0.5], color: COLOR.gold });
    text(this, VIEW_W / 2, py + 44, `${formatTime(run.runTime)} · LEVEL ${run.level} · ${run.kills} KILLS`, {
      origin: [0.5, 0.5],
      color: COLOR.textDim,
    });

    const resume = () => {
      this.scene.stop();
      this.scene.resume(SCENES.game);
    };
    const bx = px + 20;
    const buttons = [
      new Button(this, bx, py + 70, 150, 24, 'RESUME', resume),
      new Button(this, bx, py + 102, 150, 24, 'RESTART', () => this.scene.start(SCENES.game, {})),
      new Button(this, bx, py + 134, 150, 24, 'QUIT TO TITLE', () => {
        this.scene.stop(SCENES.ui);
        this.scene.stop(SCENES.game);
        this.scene.start(SCENES.title);
      }),
    ];
    new Menu(this, buttons);
    onKey(this, 'keydown-ESC', resume);
    onKey(this, 'keydown-P', resume);

    // Build: weapons and items with levels.
    const listX = px + 20;
    let ly = py + 172;
    text(this, listX, ly, 'BUILD', { color: COLOR.textDim });
    ly += 12;
    const all = [...run.buildWeapons(), ...run.buildItems()];
    all.forEach((e, i) => {
      const x = listX + i * 19;
      this.add.image(x, ly, ATLAS, e.icon).setOrigin(0);
      text(this, x + 16, ly + 16, String(e.level), { origin: [1, 0], color: e.level >= 5 ? COLOR.gold : COLOR.text });
    });

    // Stats column.
    const s = run.player.stats;
    const sx = px + 200;
    let sy = py + 70;
    text(this, sx, sy, 'STATS', { color: COLOR.textDim });
    sy += 14;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const rows: [string, string][] = [
      ['HP', `${Math.ceil(run.player.hp)} / ${s.maxHp}`],
      ['MOVE SPEED', `${Math.round(s.moveSpeed)}`],
      ['REGEN', `${s.regen.toFixed(1)}/S`],
      ['ARMOR', `${s.armor}`],
      ['PICKUP RADIUS', `${Math.round(s.pickupRadius)}`],
      ['DAMAGE', pct(s.damageMult)],
      ['COOLDOWN', pct(s.cooldownMult)],
      ['AREA', pct(s.areaMult)],
      ['EXP GAIN', pct(s.expMult)],
    ];
    for (const [k, v] of rows) {
      text(this, sx, sy, k, { color: COLOR.text });
      text(this, px + pw - 20, sy, v, { origin: [1, 0], color: COLOR.gold });
      sy += 12;
    }
    sfx.play('pause');
  }
}
