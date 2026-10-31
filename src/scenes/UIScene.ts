import Phaser from 'phaser';
import { ATLAS, FONT_SMALL, FONT_SMALL_SIZE } from '../art/textures';
import { COLOR, MAX_ITEMS, MAX_LEVEL, MAX_WEAPONS, PLAYER_COLORS, RUN_SECONDS, SCENES, VIEW_H, VIEW_W } from '../constants';
import { DEBUG_EV, EV, type BuildEntry } from '../core/events';
import { formatTime } from '../core/progression';
import type { Player } from '../entities/Player';
import { Button, drawPanel, text } from '../ui/widgets';
import type { GameScene } from './GameScene';

/** Own ultimate box under the build rows, the passive box and buff line under it, then the teammate list. */
const ULT_Y = 53;
const ULT_SIZE = 24;
const PASSIVE_Y = 84;
const PASSIVE_H = 20;
const BUFFS_Y = 107;
const TEAM_Y = 118;
const TEAM_ROW = 22;
/** px between the slot rows and the modifications / powerups beside them. */
const EXTRA_GAP = 6;

/** An ultimate icon that greys out with a countdown while on cooldown. */
interface UltBadge {
  icon: Phaser.GameObjects.Image;
  num: Phaser.GameObjects.BitmapText;
}

/** Boss HP bars at the top of the screen: first bar's y, px between bars, width, and how many fit. */
const BOSS_BAR_Y = 33;
const BOSS_BAR_STEP = 20;
const BOSS_BAR_W = 220;
const MAX_BOSS_BARS = 2;

/** HUD drawn in its own scene on top of the Game scene, so it stays fixed while the camera moves. */
export class UIScene extends Phaser.Scene {
  private run!: GameScene;
  private expBar!: Phaser.GameObjects.Graphics;
  private levelText!: Phaser.GameObjects.BitmapText;
  private timerText!: Phaser.GameObjects.BitmapText;
  /** Boss HP bars under the timer (up to MAX_BOSS_BARS), each with its name. */
  private bossGfx!: Phaser.GameObjects.Graphics;
  private bossNames: Phaser.GameObjects.BitmapText[] = [];
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
  private teamUlts = new Map<number, UltBadge>();
  private ultGfx!: Phaser.GameObjects.Graphics;
  private ultBadge!: UltBadge;
  private ultStatus!: Phaser.GameObjects.BitmapText;
  private passiveIcon: Phaser.GameObjects.Image | null = null;
  private passiveStatus!: Phaser.GameObjects.BitmapText;
  private buffs!: Phaser.GameObjects.BitmapText;
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
    this.bossGfx = this.add.graphics();
    this.bossNames = Array.from({ length: MAX_BOSS_BARS }, (_, i) =>
      text(this, VIEW_W / 2, BOSS_BAR_Y + i * BOSS_BAR_STEP, '', { origin: [0.5, 0] }).setVisible(false),
    );
    this.add.image(VIEW_W - 6, 18, ATLAS, 'icon_skull').setOrigin(1, 0.5);
    this.killText = text(this, VIEW_W - 18, 14, '0', { origin: [1, 0] });
    this.build = this.add.container(0, 0);

    this.banner = text(this, VIEW_W / 2, 92, '', { scale: 2, origin: [0.5, 0.5] }).setAlpha(0);
    this.hurt = this.add.image(0, 0, 'hurt-vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H).setAlpha(0);

    const hint = text(this, VIEW_W / 2, VIEW_H - 14, 'WASD / ARROWS MOVE · Q ULTIMATE · ESC PAUSE · M MUTE · F3 DEBUG', {
      origin: [0.5, 0],
      color: COLOR.textDim,
    });
    this.tweens.add({ targets: hint, alpha: 0, delay: 7000, duration: 1200 });

    this.buildDebugPanel();

    // Own ultimate (Q) under the build.
    const me = this.run.player;
    this.ultGfx = this.add.graphics();
    this.ultBadge = this.ultBadgeFor(me, 4 + ULT_SIZE / 2, ULT_Y + ULT_SIZE / 2);
    text(this, 4 + ULT_SIZE + 5, ULT_Y + 2, `${me.ultimate.def.name.toUpperCase()} (Q)`, { color: COLOR.text });
    this.ultStatus = text(this, 4 + ULT_SIZE + 5, ULT_Y + 13, '', { color: COLOR.textDim });

    // Own passive under it, then a line with the buffs and charges running (Aegis, charges, amplification).
    const passive = me.passive.def;
    this.passiveIcon = passive ? this.add.image(4 + ULT_SIZE / 2, PASSIVE_Y + PASSIVE_H / 2, ATLAS, passive.icon) : null;
    if (passive) text(this, 4 + ULT_SIZE + 5, PASSIVE_Y + 1, `${passive.name.toUpperCase()} (PASSIVE)`, { color: COLOR.text });
    this.passiveStatus = text(this, 4 + ULT_SIZE + 5, PASSIVE_Y + 11, '', { color: COLOR.textDim });
    this.buffs = text(this, 4, BUFFS_Y, '', { color: COLOR.gold });

    // Co-op: teammates' ultimate, name and HP under it, and arrows at the screen edge pointing at them.
    this.team = this.add.graphics();
    this.teamLabels.clear();
    this.teamUlts.clear();
    this.deathsText = null;
    if (this.run.coop) {
      this.deathsText = text(this, VIEW_W - 4, 26, '', { origin: [1, 0], color: COLOR.textDim });
      let y = TEAM_Y;
      for (const p of this.run.players) {
        if (!p || p === this.run.player) continue;
        this.teamUlts.set(p.slot, this.ultBadgeFor(p, 4 + 9, y + 9));
        this.teamLabels.set(p.slot, text(this, 26, y + 1, '', { color: PLAYER_COLORS[p.slot] }));
        y += TEAM_ROW;
      }
    }

    this.exp = { exp: snap.exp, need: snap.need, level: snap.level };
    this.drawExp();
    this.onTime(snap.time);
    this.onKills(snap.kills);
    this.onBuild(snap.weapons, snap.items, snap.mods, snap.powerups);
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
      [EV.buildChanged, (w: BuildEntry[], i: BuildEntry[], m: BuildEntry[], pu: BuildEntry[]) => this.onBuild(w, i, m, pu)],
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
    this.drawBosses();
    if (this.expFlash > 0) {
      this.expFlash = Math.max(0, this.expFlash - delta / 400);
      this.drawExp();
    }
    this.drawUltimate();
    if (this.run.coop) this.drawTeam();
  }

  /** One wide bar per living boss under the timer: name and title, then HP in the boss's colour. */
  private drawBosses(): void {
    const g = this.bossGfx;
    g.clear();
    const bars = this.run.bossBars;
    this.bossNames.forEach((t, i) => {
      const b = bars[i];
      t.setVisible(!!b);
      if (!b) return;
      const y = BOSS_BAR_Y + i * BOSS_BAR_STEP;
      t.setText(`${b.def.name.toUpperCase()} · ${b.def.boss?.title ?? ''}`).setTint(b.def.boss?.color ?? COLOR.bad);
      const x = Math.round(VIEW_W / 2 - BOSS_BAR_W / 2);
      g.fillStyle(COLOR.ink, 1);
      g.fillRect(x - 1, y + 9, BOSS_BAR_W + 2, 7);
      g.fillStyle(COLOR.hpDark, 1);
      g.fillRect(x, y + 10, BOSS_BAR_W, 5);
      g.fillStyle(b.def.boss?.color ?? COLOR.hp, 1);
      g.fillRect(x, y + 10, Math.ceil(BOSS_BAR_W * b.frac), 5);
      g.fillStyle(0xffffff, 0.35);
      g.fillRect(x, y + 10, Math.ceil(BOSS_BAR_W * b.frac), 1);
    });
  }

  private ultBadgeFor(p: Player, cx: number, cy: number): UltBadge {
    return {
      icon: this.add.image(cx, cy, ATLAS, p.ultimate.def.icon),
      num: text(this, cx + 1, cy + 1, '', { origin: [0.5, 0.5], color: COLOR.white }),
    };
  }

  /** Colour icon when ready or running; greyed out with the seconds left while on cooldown. */
  private updateBadge(b: UltBadge, p: Player): void {
    const u = p.ultimate;
    const cooling = !u.ready && !u.active;
    b.icon.setFrame(cooling || p.gone ? `${u.def.icon}_grey` : u.def.icon);
    b.num.setText(cooling && !p.gone ? String(Math.ceil(u.cooldownLeft)) : '');
  }

  private drawUltimate(): void {
    const p = this.run.player;
    const u = p.ultimate;
    const g = this.ultGfx;
    const x = 4;
    const y = ULT_Y;
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 140);
    g.clear();
    g.fillStyle(COLOR.ink, 0.85);
    g.fillRect(x, y, ULT_SIZE, ULT_SIZE);
    const edge = u.active ? COLOR.gold : u.ready ? COLOR.good : COLOR.panelEdge;
    g.lineStyle(1, edge, u.active || u.ready ? 0.6 + 0.4 * pulse : 1);
    g.strokeRect(x + 0.5, y + 0.5, ULT_SIZE - 1, ULT_SIZE - 1);
    if (u.active) {
      // Time the effect has left, as a bar under the box.
      g.fillStyle(COLOR.ink, 1);
      g.fillRect(x, y + ULT_SIZE + 1, ULT_SIZE, 3);
      g.fillStyle(COLOR.gold, 1);
      g.fillRect(x, y + ULT_SIZE + 1, Math.ceil(ULT_SIZE * Math.min(1, u.activeLeft / u.activeTotal)), 3);
    }
    this.updateBadge(this.ultBadge, p);
    const status = !p.alive
      ? 'DOWN'
      : u.active
        ? `ACTIVE ${Math.ceil(u.activeLeft)}S`
        : u.ready
          ? 'READY'
          : `${Math.ceil(u.cooldownLeft)}S`;
    this.ultStatus.setText(status).setTint(u.active ? COLOR.gold : u.ready && p.alive ? COLOR.good : COLOR.textDim);
    this.drawPassive(p);
  }

  /** Passive box (green edge when ready, greyed while it recharges), its status, and the buff line under it. */
  private drawPassive(p: Player): void {
    const d = p.passive.def;
    const s = p.status();
    const g = this.ultGfx;
    if (d) {
      const cooling = s.passiveCd > 0;
      g.fillStyle(COLOR.ink, 0.85);
      g.fillRect(4, PASSIVE_Y, ULT_SIZE, PASSIVE_H);
      g.lineStyle(1, cooling || !p.alive ? COLOR.panelEdge : COLOR.good, 1);
      g.strokeRect(4.5, PASSIVE_Y + 0.5, ULT_SIZE - 1, PASSIVE_H - 1);
      this.passiveIcon?.setAlpha(cooling || !p.alive ? 0.4 : 1);
      let status: string;
      if (d.kind === 'dodge') status = `${Math.round(d.chance * 100)}% DODGE`;
      else if (d.kind === 'growth') status = `${s.stacks} STACKS · NEXT IN ${Math.ceil(d.every - (this.run.runTime % d.every))}S`;
      else if (d.kind === 'pets') {
        status = s.stacks >= d.max ? `${s.stacks} BUNNIES · FULL` : `${s.stacks} BUNNIES · NEXT IN ${Math.ceil(d.every - (this.run.runTime % d.every))}S`;
      }
      else status = cooling ? `${Math.ceil(s.passiveCd)}S` : 'READY';
      this.passiveStatus.setText(status).setTint(cooling ? COLOR.textDim : COLOR.good);
    }
    const parts: string[] = [];
    if (s.aegis > 0) parts.push(`AEGIS ${s.aegis}`);
    if (s.shadow > 0) parts.push(`SHADOW ${s.shadow}`);
    if (s.brutal > 0) parts.push(`BRUTAL ${s.brutal}`);
    if (s.siphon > 0) parts.push(`SIPHON ${s.siphon}`);
    if (s.vicissitude > 0) parts.push(`VICISSITUDE ${s.vicissitude}`);
    if (s.amp > 0) parts.push(`+${Math.round(s.amp * 100)}% DMG ${Math.ceil(s.ampLeft)}S`);
    this.buffs.setText(p.alive ? parts.join(' · ') : '');
  }

  private drawTeam(): void {
    const g = this.team;
    g.clear();
    let y = TEAM_Y;
    const view = this.run.cameras.main.worldView;
    this.deathsText?.setText(`TEAM DEATHS ${this.run.teamDeaths}`).setTint(this.run.teamDeaths > 0 ? COLOR.bad : COLOR.textDim);
    for (const p of this.run.players) {
      if (!p || p === this.run.player) continue;
      const label = this.teamLabels.get(p.slot);
      const badge = this.teamUlts.get(p.slot);
      if (!label || !badge) continue;
      const color = PLAYER_COLORS[p.slot];
      label.setText(`${p.displayName}${p.gone ? ' LEFT' : p.dead ? ' DOWN' : ''}`).setAlpha(p.alive ? 1 : 0.5);
      // Ultimate badge: box, then the icon (grey with a countdown on cooldown, gold edge while running).
      const u = p.ultimate;
      g.fillStyle(COLOR.ink, 0.85);
      g.fillRect(4, y, 18, 18);
      g.lineStyle(1, u.active ? COLOR.gold : u.ready && p.alive ? COLOR.good : COLOR.panelEdge, 1);
      g.strokeRect(4.5, y + 0.5, 17, 17);
      this.updateBadge(badge, p);
      badge.icon.setAlpha(p.alive ? 1 : 0.5);
      if (p.alive) {
        const w = 40;
        const frac = Phaser.Math.Clamp(p.hp / p.stats.maxHp, 0, 1);
        g.fillStyle(COLOR.ink, 1);
        g.fillRect(25, y + 11, w + 2, 5);
        g.fillStyle(COLOR.hpDark, 1);
        g.fillRect(26, y + 12, w, 3);
        g.fillStyle(COLOR.hp, 1);
        g.fillRect(26, y + 12, Math.ceil(w * frac), 3);

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
      y += TEAM_ROW;
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

  /**
   * Top left: weapon slots, item slots under them, and to the right of each row the modifications
   * (next to the weapons) and generic powerups (next to the items), which take no slots.
   */
  private onBuild(weapons: BuildEntry[], items: BuildEntry[], mods: BuildEntry[] = [], powerups: BuildEntry[] = []): void {
    this.build.removeAll(true);
    const slot = (x: number, y: number, e: BuildEntry | undefined) => {
      const g = this.add.graphics();
      g.fillStyle(COLOR.ink, 0.85);
      g.fillRect(x, y, 18, 18);
      g.lineStyle(1, e ? COLOR.panelEdge : 0x3a3149, 1);
      g.strokeRect(x + 0.5, y + 0.5, 17, 17);
      this.build.add(g);
      if (!e) return;
      this.build.add(this.add.image(x + 1, y + 1, ATLAS, e.icon).setOrigin(0));
      const lv = this.add
        .bitmapText(x + 18, y + 19, FONT_SMALL, String(e.level), FONT_SMALL_SIZE)
        .setOrigin(1, 1)
        .setTint(e.level >= (e.max ?? MAX_LEVEL) ? COLOR.gold : COLOR.white);
      this.build.add(lv);
    };
    const row = (list: BuildEntry[], slots: number, y: number) => {
      for (let i = 0; i < slots; i++) slot(4 + i * 19, y, list[i]);
    };
    const extras = (list: BuildEntry[], slots: number, y: number) => {
      const x0 = 4 + slots * 19 + EXTRA_GAP;
      list.forEach((e, i) => slot(x0 + i * 19, y, e));
    };
    row(weapons, MAX_WEAPONS, 13);
    row(items, MAX_ITEMS, 33);
    extras(mods, MAX_WEAPONS, 13);
    extras(powerups, MAX_ITEMS, 33);
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
    const y = VIEW_H - 170;
    const w = 168;
    const h = 164;
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
      ['ULT READY', DEBUG_EV.ultReady],
      ['BOSS', DEBUG_EV.boss],
      ['RARE', DEBUG_EV.rare],
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
