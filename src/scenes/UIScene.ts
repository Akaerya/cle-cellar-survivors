import Phaser from 'phaser';
import { ATLAS, FONT_SMALL, FONT_SMALL_SIZE } from '../art/textures';
import { COLOR, MAX_ITEMS, MAX_LEVEL, MAX_WEAPONS, PLAYER_COLORS, RUN_SECONDS, SCENES, VIEW_H, VIEW_W } from '../constants';
import { DEBUG_EV, EV, type BuildEntry } from '../core/events';
import { formatTime } from '../core/progression';
import { Button, drawPanel, text } from '../ui/widgets';
import type { GameScene } from './GameScene';

/** HUD drawn in its own scene on top of the Game scene, so it stays fixed while the camera moves. */
export class UIScene extends Phaser.Scene {
  private run!: GameScene;
  private expBar!: Phaser.GameObjects.Graphics;
  private levelText!: Phaser.GameObjects.BitmapText;
  private timerText!: Phaser.GameObjects.BitmapText;
  private killText!: Phaser.GameObjects.BitmapText;
  private build!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.BitmapText;
  private hurt!: Phaser.GameObjects.Image;
  private debugPanel!: Phaser.GameObjects.Container;
  private debugText!: Phaser.GameObjects.BitmapText;
  private debugButtons: Button[] = [];
  private expFlash = 0;
  private team!: Phaser.GameObjects.Graphics;
  private teamLabels = new Map<number, Phaser.GameObjects.BitmapText>();
  private deathsText: Phaser.GameObjects.BitmapText | null = null;
  private exp = { exp: 0, need: 5, level: 1 };

  constructor() {
    super(SCENES.ui);
  }

  create(): void {
    this.run = this.scene.get(SCENES.game) as GameScene;
    const snap = this.run.hudSnapshot();

    this.expBar = this.add.graphics();
    this.levelText = text(this, VIEW_W - 4, 1, '', { origin: [1, 0] });
    this.timerText = text(this, VIEW_W / 2, 13, '00:00', { scale: 2, origin: [0.5, 0] });
    this.add.image(VIEW_W - 6, 18, ATLAS, 'icon_skull').setOrigin(1, 0.5);
    this.killText = text(this, VIEW_W - 18, 14, '0', { origin: [1, 0] });
    this.build = this.add.container(0, 0);

    this.banner = text(this, VIEW_W / 2, 92, '', { scale: 2, origin: [0.5, 0.5] }).setAlpha(0);
    this.hurt = this.add.image(0, 0, 'hurt-vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H).setAlpha(0);

    const hint = text(this, VIEW_W / 2, VIEW_H - 14, 'WASD / ARROWS MOVE · ESC PAUSE · M MUTE · F3 DEBUG', {
      origin: [0.5, 0],
      color: COLOR.textDim,
    });
    this.tweens.add({ targets: hint, alpha: 0, delay: 7000, duration: 1200 });

    this.buildDebugPanel();

    // Co-op: teammates' HP under the build, and arrows at the screen edge pointing at them.
    this.team = this.add.graphics();
    this.teamLabels.clear();
    this.deathsText = null;
    if (this.run.coop) {
      this.deathsText = text(this, VIEW_W - 4, 26, '', { origin: [1, 0], color: COLOR.textDim });
      for (const p of this.run.players) {
        if (!p || p === this.run.player) continue;
        this.teamLabels.set(p.slot, text(this, 4, 0, '', { color: PLAYER_COLORS[p.slot] }));
      }
    }

    this.exp = { exp: snap.exp, need: snap.need, level: snap.level };
    this.drawExp();
    this.onTime(snap.time);
    this.onKills(snap.kills);
    this.onBuild(snap.weapons, snap.items);
    this.onDebugState(snap.debug);

    const ev = this.run.events;
    const listeners: [string, (...a: any[]) => void][] = [
      [EV.expChanged, (exp: number, need: number, level: number) => {
        this.exp = { exp, need, level };
        this.drawExp();
      }],
      [EV.levelUp, () => (this.expFlash = 1)],
      [EV.timeChanged, (t: number) => this.onTime(t)],
      [EV.killsChanged, (k: number) => this.onKills(k)],
      [EV.buildChanged, (w: BuildEntry[], i: BuildEntry[]) => this.onBuild(w, i)],
      [EV.playerHurt, () => this.onHurt()],
      [EV.banner, (t: string, c: number) => this.showBanner(t, c)],
      [EV.debugState, (on: boolean) => this.onDebugState(on)],
      [EV.debugStats, (s: Record<string, unknown>) => this.onDebugStats(s)],
    ];
    for (const [name, fn] of listeners) ev.on(name, fn);
    this.events.once('shutdown', () => {
      for (const [name, fn] of listeners) ev.off(name, fn);
    });
  }

  update(_t: number, delta: number): void {
    if (this.expFlash > 0) {
      this.expFlash = Math.max(0, this.expFlash - delta / 400);
      this.drawExp();
    }
    if (this.run.coop) this.drawTeam();
  }

  private drawTeam(): void {
    const g = this.team;
    g.clear();
    let y = 56;
    const view = this.run.cameras.main.worldView;
    this.deathsText?.setText(`TEAM DEATHS ${this.run.teamDeaths}`).setTint(this.run.teamDeaths > 0 ? COLOR.bad : COLOR.textDim);
    for (const p of this.run.players) {
      if (!p || p === this.run.player) continue;
      const label = this.teamLabels.get(p.slot);
      if (!label) continue;
      const color = PLAYER_COLORS[p.slot];
      label.setY(y).setText(`P${p.slot + 1}${p.gone ? ' LEFT' : p.dead ? ' DOWN' : ''}`).setAlpha(p.alive ? 1 : 0.5);
      if (p.alive) {
        const w = 40;
        const frac = Phaser.Math.Clamp(p.hp / p.stats.maxHp, 0, 1);
        g.fillStyle(COLOR.ink, 1);
        g.fillRect(21, y + 1, w + 2, 5);
        g.fillStyle(COLOR.hpDark, 1);
        g.fillRect(22, y + 2, w, 3);
        g.fillStyle(COLOR.hp, 1);
        g.fillRect(22, y + 2, Math.ceil(w * frac), 3);

        // Off-screen: an arrow on the edge of the screen in the teammate's colour.
        if (!view.contains(p.x, p.y)) {
          const cx = view.centerX;
          const cy = view.centerY;
          const dx = p.x - cx;
          const dy = p.y - cy;
          const m = 10;
          const k = Math.min((VIEW_W / 2 - m) / Math.abs(dx || 1e-6), (VIEW_H / 2 - m) / Math.abs(dy || 1e-6));
          const ax = VIEW_W / 2 + dx * k;
          const ay = VIEW_H / 2 + dy * k;
          const a = Math.atan2(dy, dx);
          const pt = (r: number, da: number) => ({ x: ax + Math.cos(a + da) * r, y: ay + Math.sin(a + da) * r });
          const tip = pt(6, 0);
          const l = pt(5, 2.4);
          const r = pt(5, -2.4);
          g.fillStyle(COLOR.ink, 1);
          g.fillTriangle(tip.x + 1, tip.y + 1, l.x + 1, l.y + 1, r.x + 1, r.y + 1);
          g.fillStyle(color, 1);
          g.fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
        }
      }
      y += 10;
    }
  }

  private drawExp(): void {
    const g = this.expBar;
    const frac = Phaser.Math.Clamp(this.exp.exp / this.exp.need, 0, 1);
    g.clear();
    g.fillStyle(COLOR.ink, 1);
    g.fillRect(0, 0, VIEW_W, 10);
    g.fillStyle(0x161021, 1);
    g.fillRect(1, 1, VIEW_W - 2, 8);
    const w = Math.round((VIEW_W - 2) * frac);
    g.fillStyle(COLOR.exp, 1);
    g.fillRect(1, 1, w, 8);
    g.fillStyle(COLOR.expHi, 1);
    g.fillRect(1, 1, w, 2);
    if (this.expFlash > 0) {
      g.fillStyle(0xffffff, this.expFlash * 0.8);
      g.fillRect(1, 1, VIEW_W - 2, 8);
    }
    this.levelText.setText(`LV ${this.exp.level}`);
  }

  private onTime(t: number): void {
    this.timerText.setText(formatTime(t));
    this.timerText.setTint(t >= RUN_SECONDS - 60 ? COLOR.gold : COLOR.text);
  }

  private onKills(k: number): void {
    this.killText.setText(String(k));
  }

  private onBuild(weapons: BuildEntry[], items: BuildEntry[]): void {
    this.build.removeAll(true);
    const row = (list: BuildEntry[], slots: number, y: number) => {
      for (let i = 0; i < slots; i++) {
        const x = 4 + i * 19;
        const g = this.add.graphics();
        g.fillStyle(COLOR.ink, 0.85);
        g.fillRect(x, y, 18, 18);
        g.lineStyle(1, list[i] ? COLOR.panelEdge : 0x3a3149, 1);
        g.strokeRect(x + 0.5, y + 0.5, 17, 17);
        this.build.add(g);
        const e = list[i];
        if (!e) continue;
        this.build.add(this.add.image(x + 1, y + 1, ATLAS, e.icon).setOrigin(0));
        const lv = this.add
          .bitmapText(x + 18, y + 19, FONT_SMALL, String(e.level), FONT_SMALL_SIZE)
          .setOrigin(1, 1)
          .setTint(e.level >= MAX_LEVEL ? COLOR.gold : COLOR.white);
        this.build.add(lv);
      }
    };
    row(weapons, MAX_WEAPONS, 13);
    row(items, MAX_ITEMS, 33);
  }

  private onHurt(): void {
    this.tweens.killTweensOf(this.hurt);
    this.hurt.setAlpha(0.45);
    this.tweens.add({ targets: this.hurt, alpha: 0, duration: 380, ease: 'Quad.easeOut' });
  }

  private showBanner(t: string, color: number): void {
    this.tweens.killTweensOf(this.banner);
    this.banner.setText(t).setTint(color).setAlpha(1).setScale(1.25);
    this.tweens.add({ targets: this.banner, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.banner, alpha: 0, delay: 1800, duration: 600 });
  }

  // ---------------------------------------------------------------- debug overlay (F3)

  private buildDebugPanel(): void {
    const x = 4;
    const y = VIEW_H - 132;
    const w = 168;
    const h = 126;
    this.debugPanel = this.add.container(0, 0);
    const g = this.add.graphics();
    drawPanel(g, x, y, w, h, COLOR.panelEdge, COLOR.ink, 0.85);
    this.debugPanel.add(g);
    this.debugPanel.add(text(this, x + 6, y + 5, 'DEBUG (F3)', { color: COLOR.gold }));
    this.debugText = text(this, x + 6, y + 17, '', { color: COLOR.text });
    this.debugPanel.add(this.debugText);
    const ev = this.run.events;
    const defs: [string, string][] = [
      ['+50 FOES', DEBUG_EV.spawn],
      ['+1 LEVEL', DEBUG_EV.addExp],
      ['+1 MIN', DEBUG_EV.skipMinute],
      ['GOD', DEBUG_EV.god],
    ];
    this.debugButtons = defs.map(([label, name], i) => {
      const bx = x + 6 + (i % 2) * 80;
      const by = y + 84 + Math.floor(i / 2) * 19;
      return new Button(this, bx, by, 76, 16, label, () => ev.emit(name));
    });
    this.debugPanel.setVisible(false);
  }

  private onDebugState(on: boolean): void {
    this.debugPanel.setVisible(on);
    for (const b of this.debugButtons) b.setVisible(on);
  }

  private onDebugStats(s: Record<string, unknown>): void {
    this.debugText.setText(
      [
        `FPS ${s.fps}`,
        `ENEMIES ${s.enemies} / TARGET ${s.target}`,
        `PROJECTILES ${s.projectiles}  GEMS ${s.gems}`,
        `NUMBERS ${s.numbers}  BODIES ${s.bodies}`,
        `MINUTE ${s.minute}  SEED ${s.seed}`,
        `GOD MODE ${s.god ? 'ON' : 'OFF'}`,
      ].join('\n'),
    );
  }
}
