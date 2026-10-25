import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, MAX_LEVEL, SCENES, VIEW_H, VIEW_W } from '../constants';
import { formatTime, hasteFactor } from '../core/progression';
import { sfx } from '../core/sfx';
import { Button, Menu, drawPanel, onKey, text } from '../ui/widgets';
import { leaveSession } from '../net/flow';
import type { BuildEntry } from '../core/events';
import type { GameScene } from './GameScene';

/**
 * Resume, Restart, Quit to title, plus a look at the current build and stats.
 * In co-op the run keeps going underneath (it cannot pause for everyone) and there is no restart.
 */
export class PauseScene extends Phaser.Scene {
  constructor() {
    super(SCENES.pause);
  }

  create(): void {
    const run = this.scene.get(SCENES.game) as GameScene;
    this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x0a0610, 0.6).setOrigin(0);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);

    const px = 110;
    const pw = 420;
    const ph = 292;
    const py = Math.round((VIEW_H - ph) / 2);
    const g = this.add.graphics();
    drawPanel(g, px, py, pw, ph);
    text(this, VIEW_W / 2, py + 22, run.coop ? 'MENU' : 'PAUSED', { scale: 3, origin: [0.5, 0.5], color: COLOR.gold });
    text(this, VIEW_W / 2, py + 44, `${formatTime(run.runTime)} · LEVEL ${run.level} · ${run.kills} KILLS`, {
      origin: [0.5, 0.5],
      color: COLOR.textDim,
    });

    const resume = () => {
      this.scene.stop();
      if (!run.coop) this.scene.resume(SCENES.game);
    };
    const bx = px + 20;
    const openWiki = () => {
      this.scene.pause();
      this.scene.launch(SCENES.wiki, { from: 'pause' });
    };
    const buttons = run.coop
      ? [
          new Button(this, bx, py + 70, 150, 24, 'RESUME', resume),
          new Button(this, bx, py + 102, 150, 24, 'WIKI', openWiki),
          new Button(this, bx, py + 134, 150, 24, run.mode === 'host' ? 'END GAME' : 'LEAVE GAME', () =>
            leaveSession(this.game, run.net),
          ),
        ]
      : [
          new Button(this, bx, py + 70, 150, 24, 'RESUME', resume),
          new Button(this, bx, py + 102, 150, 24, 'RESTART', () => this.scene.start(SCENES.game, {})),
          new Button(this, bx, py + 134, 150, 24, 'WIKI', openWiki),
          new Button(this, bx, py + 166, 150, 24, 'QUIT TO TITLE', () => {
            this.scene.stop(SCENES.ui);
            this.scene.stop(SCENES.game);
            this.scene.start(SCENES.title);
          }),
        ];
    if (run.coop) {
      text(this, bx, py + 168, 'THE RUN KEEPS GOING', { color: COLOR.textDim });
      text(this, bx, py + 180, 'WHILE THIS MENU IS OPEN', { color: COLOR.textDim });
    }
    new Menu(this, buttons);
    onKey(this, 'keydown-ESC', resume);
    onKey(this, 'keydown-P', resume);

    // Build: weapons and items with levels, then modifications and powerups (wrapping, 9 per row).
    const listX = px + 20;
    let ly = py + 200;
    text(this, listX, ly, 'BUILD', { color: COLOR.textDim });
    ly += 12;
    const icon = (e: BuildEntry, x: number, y: number) => {
      this.add.image(x, y, ATLAS, e.icon).setOrigin(0);
      text(this, x + 16, y + 16, String(e.level), { origin: [1, 0], color: e.level >= (e.max ?? MAX_LEVEL) ? COLOR.gold : COLOR.text });
    };
    [...run.buildWeapons(), ...run.buildItems()].forEach((e, i) => icon(e, listX + i * 19, ly));
    [...run.buildMods(), ...run.buildPowerups()].forEach((e, i) => icon(e, listX + (i % 9) * 19, ly + 22 + Math.floor(i / 9) * 22));

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
      ['REGEN', `${run.player.regenPerSecond.toFixed(1)}/S`],
      ['ARMOR', `${s.armor}`],
      ['DAMAGE TAKEN', pct(s.damageTaken)],
      ['PICKUP RADIUS', `${Math.round(s.pickupRadius)}`],
      ['DAMAGE', pct(s.damageMult)],
      ['COOLDOWN', pct(s.cooldownMult)],
      ['ABILITY HASTE', `${Math.round(s.abilityHaste)} (-${Math.round((1 - hasteFactor(s.abilityHaste)) * 100)}%)`],
      ['CRIT CHANCE', `${Math.round(run.player.critChance * 100)}% (×${s.critDamage})`],
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
