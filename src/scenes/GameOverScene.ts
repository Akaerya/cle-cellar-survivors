import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, MAX_LEVEL, PLAYER_COLORS, SCENES, VIEW_H, VIEW_W } from '../constants';
import type { BuildEntry, PartyMember, RunSummary, WeaponReport } from '../core/events';
import { formatTime } from '../core/progression';
import { sfx } from '../core/sfx';
import { CURIO_TIERS, characterDef } from '../data';
import { hostStartRun, hostToLobby, leaveSession } from '../net/flow';
import { netSession } from '../net/Net';
import { Button, Menu, drawPanel, onKey, text } from '../ui/widgets';

const PX = 20;
const PY = 8;
const PW = VIEW_W - 40;
const PH = VIEW_H - 16;
const LEFT = PX + 14;
const PARTY_Y = 106;
const ROW_H = 12;
/**
 * Parties larger than this get the compact layout: the headline numbers on one line, and shorter party rows,
 * so up to MAX_PLAYERS rows still leave room for the scrolling detail below.
 */
const ROOMY_PARTY = 4;
const COMPACT_PARTY_Y = 86;
const COMPACT_ROW_H = 11;
/** Detail rows (they scroll): weapon row, weapon column labels, section header, icon row, gap between sections. */
const WEAPON_ROW_H = 17;
const WEAPON_HEAD_H = 11;
const SECTION_H = 14;
const ICON_ROW_H = 18;
const SECTION_GAP = 6;
/** Curios per row, and px per modification or powerup icon. */
const CURIO_COLS = 3;
const ICON_CELL_W = 30;
/** Px between the SHARE % and its bar. */
const SHARE_BAR_GAP = 34;
/** Px scrolled per wheel unit, and per arrow or page key press. */
const WHEEL_SCROLL = 0.4;
const KEY_SCROLL = WEAPON_ROW_H * 2;

/** Party table columns: label, width in px, value. */
const PARTY_COLS: { label: string; w: number; value: (m: PartyMember) => string }[] = [
  { label: 'PLAYER', w: 78, value: (m) => m.name },
  { label: 'CHARACTER', w: 62, value: (m) => characterDef(m.character).name.toUpperCase() },
  { label: 'DAMAGE', w: 52, value: (m) => short(m.stats.damage) },
  { label: 'DPS', w: 40, value: (m) => short(m.dps) },
  { label: 'KILLS', w: 40, value: (m) => String(m.stats.kills) },
  { label: 'TAKEN', w: 44, value: (m) => short(m.stats.taken) },
  { label: 'HEALED', w: 48, value: (m) => short(m.stats.healed) },
  { label: 'BLOCKS', w: 46, value: (m) => String(m.stats.blocks) },
  { label: 'DEATHS', w: 46, value: (m) => String(m.stats.deaths) },
  { label: 'REVIVES', w: 50, value: (m) => String(m.stats.revives) },
  { label: 'ULTS', w: 38, value: (m) => String(m.stats.ultCasts) },
  { label: 'CRITS', w: 38, value: (m) => short(m.stats.crits ?? 0) },
];

/** LEVEL column of a weapon row: ULT, PASSIVE (a passive's pets) or the weapon's level. */
function levelLabel(w: WeaponReport): string {
  return w.ultimate ? 'ULT' : w.passive ? 'PASSIVE' : w.curio ? 'CURIO' : `LV ${w.level}`;
}

/** 1234 -> 1234, 12345 -> 12.3K, 1234567 -> 1.2M. Decimals only below 100. */
function short(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v < 100 && !Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v));
}

/** Cuts a text short with a '.' until it is at most `max` px wide. */
function fitText(t: Phaser.GameObjects.BitmapText, label: string, max: number): void {
  let n = label.length;
  while (t.width > max && n > 1) t.setText(`${label.slice(0, --n)}.`);
}

/**
 * End of the run: time, level and kills, then the party screen. One row per player with their
 * damage, DPS, kills and survival numbers; below it, the selected player's weapons (and ultimate)
 * with level, damage, DPS, kills and share of their damage (curios that dealt damage too), then their curios,
 * modifications and powerups. The detail scrolls (wheel, keys, drag) when it does not fit above the buttons.
 */
export class GameOverScene extends Phaser.Scene {
  private summary!: RunSummary;
  private selected = 0;
  private rowBg!: Phaser.GameObjects.Graphics;
  /** The selected player's detail rows, at their y in the scrolled content. */
  private rows: { c: Phaser.GameObjects.Container; y: number; h: number }[] = [];
  private contentH = 0;
  private scroll = 0;
  /** Bottom of the scroll area: just above the buttons. */
  private viewBottom = 0;
  private bar!: Phaser.GameObjects.Graphics;
  private scrollHint!: Phaser.GameObjects.BitmapText;
  private tipBg!: Phaser.GameObjects.Graphics;
  private tipText!: Phaser.GameObjects.BitmapText;
  /** Large party: the compact layout (see ROOMY_PARTY). */
  private compact = false;
  private partyY = PARTY_Y;
  private rowH = ROW_H;

  constructor() {
    super(SCENES.gameOver);
  }

  create(summary: RunSummary): void {
    this.summary = summary;
    this.compact = summary.party.length > ROOMY_PARTY;
    this.partyY = this.compact ? COMPACT_PARTY_Y : PARTY_Y;
    this.rowH = this.compact ? COMPACT_ROW_H : ROW_H;
    const win = summary.victory;
    const dim = this.add.rectangle(0, 0, VIEW_W, VIEW_H, win ? 0x2a2010 : 0x12030a, 0).setOrigin(0);
    this.tweens.add({ targets: dim, fillAlpha: 0.8, duration: 500 });
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);

    const g = this.add.graphics();
    drawPanel(g, PX, PY, PW, PH, win ? COLOR.gold : COLOR.panelEdge);

    const title = text(this, VIEW_W / 2, PY + 20, win ? 'YOU SURVIVED' : 'YOU DIED', {
      scale: 3,
      origin: [0.5, 0.5],
      color: win ? COLOR.gold : COLOR.bad,
    });
    this.tweens.add({ targets: title, scale: { from: 1.4, to: 1 }, duration: 380, ease: 'Back.easeOut' });
    const coop = summary.coopPlayers !== undefined;
    const sub = coop
      ? `CO-OP · ${summary.coopPlayers} PLAYERS · ${win ? 'DAWN BROKE' : 'THE NIGHT WON'}`
      : win
        ? 'DAWN BROKE OVER THE GRAVEYARD'
        : 'THE NIGHT CLAIMED ANOTHER SURVIVOR';
    text(this, VIEW_W / 2, PY + 40, sub, { origin: [0.5, 0.5], color: COLOR.textDim });

    // Headline numbers.
    const stats: [string, string][] = [
      ['TIME', formatTime(summary.time)],
      ['LEVEL', String(summary.level)],
      ['KILLS', String(summary.kills)],
    ];
    if (summary.teamDeaths !== undefined) stats.push(['TEAM DEATHS', String(summary.teamDeaths)]);
    if (this.compact) {
      text(this, VIEW_W / 2, PY + 52, stats.map(([k, v]) => `${k} ${v}`).join(' · '), { origin: [0.5, 0], color: COLOR.text });
    }
    const colW = 110;
    const sx0 = VIEW_W / 2 - (colW * stats.length) / 2;
    if (!this.compact) stats.forEach(([k, v], i) => {
      const cx = sx0 + colW * (i + 0.5);
      text(this, cx, PY + 52, k, { origin: [0.5, 0], color: COLOR.textDim });
      text(this, cx, PY + 62, v, { scale: 2, origin: [0.5, 0], color: COLOR.text });
    });

    const by = PY + PH - 36;
    this.viewBottom = by - 6;
    this.drawParty();
    this.bar = this.add.graphics().setDepth(1);
    this.tipBg = this.add.graphics().setDepth(10).setVisible(false);
    this.tipText = text(this, 0, 0, '', { color: COLOR.text, depth: 11 }).setVisible(false);
    const hintColor = COLOR.panelEdge;
    text(this, PX + PW - 8, PY + PH - 6, `SEED ${summary.seed}`, { origin: [1, 1], color: hintColor });
    const multi = summary.party.length > 1;
    if (multi) text(this, PX + 8, PY + PH - 6, 'UP/DOWN OR CLICK: PLAYER', { origin: [0, 1], color: hintColor });
    this.scrollHint = text(this, PX + 8, PY + PH - (multi ? 16 : 6), multi ? 'WHEEL/PGUP/PGDN: SCROLL' : 'WHEEL/UP/DOWN: SCROLL', {
      origin: [0, 1],
      color: hintColor,
    });

    this.selected = Math.max(0, summary.party.findIndex((m) => m.slot === summary.mySlot));
    this.select(this.selected, false);

    // Up/down pick a player in a party, and scroll when playing alone.
    const up = () => (multi ? this.select(this.selected - 1, true) : this.scrollBy(-KEY_SCROLL));
    const down = () => (multi ? this.select(this.selected + 1, true) : this.scrollBy(KEY_SCROLL));
    for (const k of ['UP', 'W']) onKey(this, `keydown-${k}`, up);
    for (const k of ['DOWN', 'S']) onKey(this, `keydown-${k}`, down);
    onKey(this, 'keydown-PAGE_UP', () => this.scrollBy(-(this.viewBottom - this.viewTop - KEY_SCROLL)));
    onKey(this, 'keydown-PAGE_DOWN', () => this.scrollBy(this.viewBottom - this.viewTop - KEY_SCROLL));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scrollBy(dy * WHEEL_SCROLL));
    // Touch: drag the rows.
    let dragY: number | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragY = p.y >= this.viewTop && p.y <= this.viewBottom ? p.y : null;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (dragY === null || !p.isDown) return;
      this.scrollBy(dragY - p.y);
      dragY = p.y;
    });
    this.input.on('pointerup', () => (dragY = null));

    const net = coop ? netSession() : null;
    if (net) {
      this.coopButtons(net.isHost, by);
      return;
    }
    const restart = () => this.scene.start(SCENES.game, {});
    const toTitle = () => {
      this.scene.stop(SCENES.game);
      this.scene.start(SCENES.title);
    };
    const buttons = [
      new Button(this, VIEW_W / 2 - 132, by, 124, 22, 'RESTART (R)', restart),
      new Button(this, VIEW_W / 2 + 8, by, 124, 22, 'TITLE (T)', toTitle),
    ];
    new Menu(this, buttons, true);
    onKey(this, 'keydown-R', restart);
    onKey(this, 'keydown-T', toTitle);
  }

  /** One row per player; click a row to see that player's weapons. */
  private drawParty(): void {
    const party = this.summary.party;
    text(this, LEFT, this.partyY - 14, 'PARTY', { color: COLOR.gold });
    this.rowBg = this.add.graphics();
    let x = LEFT;
    for (const c of PARTY_COLS) {
      text(this, x, this.partyY, c.label, { color: COLOR.textDim });
      x += c.w;
    }
    const line = this.add.graphics();
    line.lineStyle(1, COLOR.panelEdge, 1);
    line.lineBetween(LEFT, this.partyY + 10.5, PX + PW - 14, this.partyY + 10.5);
    party.forEach((m, i) => {
      const y = this.partyY + 13 + i * this.rowH;
      let cx = LEFT;
      PARTY_COLS.forEach((c, k) => {
        const color = k === 0 ? (this.summary.coopPlayers !== undefined ? PLAYER_COLORS[m.slot] : COLOR.gold) : COLOR.text;
        // Players who left are dimmed; their numbers stop where they left.
        text(this, cx, y, c.value(m), { color }).setAlpha(m.left ? 0.45 : 1);
        cx += c.w;
      });
      const zone = this.add.zone(LEFT - 4, y - 1, PW - 20, this.rowH).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => this.select(i, true));
    });
  }

  private select(i: number, sound: boolean): void {
    const n = this.summary.party.length;
    if (n === 0) return;
    const next = ((i % n) + n) % n;
    if (sound && next !== this.selected) sfx.play('hover');
    this.selected = next;
    if (n > 1) {
      this.rowBg.clear();
      this.rowBg.fillStyle(COLOR.gold, 0.12);
      this.rowBg.fillRect(LEFT - 4, this.partyY + 12 + next * this.rowH, PW - 20, this.rowH);
    }
    this.drawDetail(this.summary.party[next]);
  }

  /**
   * The selected player's weapons, ultimate and curio damage, then all their curios, modifications and powerups,
   * as rows in the scroll area between the party table and the buttons.
   */
  private drawDetail(m: PartyMember): void {
    for (const r of this.rows) r.c.destroy();
    this.rows = [];
    this.scroll = 0;
    let y = 0;
    const right = PX + PW - 14;
    const row = (h: number) => {
      const c = this.add.container(0, 0);
      this.rows.push({ c, y, h });
      y += h;
      return c;
    };
    const header = (label: string, extra?: string) => {
      const c = row(SECTION_H);
      c.add(text(this, LEFT, 0, label, { color: COLOR.gold }));
      if (extra) c.add(text(this, right, 0, extra, { origin: [1, 0], color: COLOR.textDim }));
      const line = this.add.graphics();
      line.lineStyle(1, COLOR.panelEdge, 1);
      line.lineBetween(LEFT, 10.5, right, 10.5);
      c.add(line);
      return c;
    };
    const none = () => row(ICON_ROW_H).add(text(this, LEFT, 4, 'NONE', { color: COLOR.textDim }));

    // Weapons table, with a bar for each weapon's damage against the best one's.
    const total = Math.max(1, m.stats.damage);
    const best = Math.max(1, ...m.weapons.map((w) => w.damage));
    const tierOf = new Map((m.curios ?? []).map((c) => [c.name, c.level]));
    header(`${m.name}'S WEAPONS`, `EXP ${short(m.stats.exp)} · REROLLS ${m.stats.rerolls ?? 0}`);
    const cols = { lv: LEFT + 190, damage: LEFT + 250, dps: LEFT + 320, kills: LEFT + 380, share: LEFT + 440 };
    const labels = row(WEAPON_HEAD_H);
    for (const [k, x] of Object.entries(cols)) {
      labels.add(text(this, x, 0, k === 'lv' ? 'LEVEL' : k.toUpperCase(), { color: COLOR.textDim }));
    }
    if (m.weapons.length === 0) none();
    m.weapons.forEach((w, i) => {
      const c = row(WEAPON_ROW_H);
      const bg = this.add.graphics();
      if (i % 2 === 0) {
        bg.fillStyle(COLOR.inkSoft, 0.6);
        bg.fillRect(LEFT - 4, 0, right - LEFT + 8, WEAPON_ROW_H);
      }
      const barX = cols.share + SHARE_BAR_GAP;
      const barW = right - barX;
      bg.fillStyle(COLOR.ink, 1);
      bg.fillRect(barX, 7, barW, 3);
      bg.fillStyle(w.ultimate ? COLOR.gold : COLOR.goldDark, 1);
      bg.fillRect(barX, 7, Math.max(1, Math.round((barW * w.damage) / best)), 3);
      c.add(bg);
      const tier = w.curio ? tierOf.get(w.name) : undefined;
      const nameColor = w.ultimate ? COLOR.gold : tier !== undefined ? (CURIO_TIERS[tier]?.color ?? COLOR.text) : COLOR.text;
      c.add(this.add.image(LEFT, 0, ATLAS, w.icon).setOrigin(0));
      c.add(text(this, LEFT + 20, 4, w.name.toUpperCase(), { color: nameColor }));
      c.add(text(this, cols.lv, 4, levelLabel(w), { color: w.ultimate || w.level >= MAX_LEVEL ? COLOR.gold : COLOR.textDim }));
      c.add(text(this, cols.damage, 4, short(w.damage), { color: COLOR.gold }));
      c.add(text(this, cols.dps, 4, short(w.dps), { color: COLOR.text }));
      c.add(text(this, cols.kills, 4, String(w.kills), { color: COLOR.text }));
      c.add(text(this, cols.share, 4, `${Math.round((w.damage / total) * 100)}%`, { color: COLOR.textDim }));
    });

    // Curios: icon and name in their tier's colour, a few to a row.
    y += SECTION_GAP;
    const curios = m.curios ?? [];
    header('CURIOS', curios.length ? String(curios.length) : undefined);
    if (curios.length === 0) none();
    const cellW = (right - LEFT) / CURIO_COLS;
    for (let i = 0; i < curios.length; i += CURIO_COLS) {
      const c = row(ICON_ROW_H);
      curios.slice(i, i + CURIO_COLS).forEach((e, k) => {
        const x = LEFT + k * cellW;
        const label = e.name.toUpperCase();
        c.add(this.add.image(x, 0, ATLAS, e.icon).setOrigin(0));
        const name = text(this, x + 20, 4, label, { color: CURIO_TIERS[e.level]?.color ?? COLOR.text });
        fitText(name, label, cellW - 26);
        c.add(name);
        c.add(this.tipZone(x, cellW - 4, label));
      });
    }

    // Modifications and powerups: icon and level (hover for the name); there can be many.
    const iconGrid = (label: string, list: BuildEntry[]) => {
      y += SECTION_GAP;
      header(label, list.length ? String(list.length) : undefined);
      if (list.length === 0) none();
      const perRow = Math.floor((right - LEFT) / ICON_CELL_W);
      for (let i = 0; i < list.length; i += perRow) {
        const c = row(ICON_ROW_H);
        list.slice(i, i + perRow).forEach((e, k) => {
          const x = LEFT + k * ICON_CELL_W;
          const maxed = e.level >= (e.max ?? MAX_LEVEL);
          c.add(this.add.image(x, 0, ATLAS, e.icon).setOrigin(0));
          c.add(text(this, x + 17, 4, String(e.level), { color: maxed ? COLOR.gold : COLOR.text }));
          c.add(this.tipZone(x, ICON_CELL_W - 2, `${e.name.toUpperCase()} LV ${e.level}`));
        });
      }
    };
    iconGrid('MODIFICATIONS', m.mods ?? []);
    iconGrid('POWERUPS', m.powerups ?? []);

    this.contentH = y;
    this.applyScroll();
  }

  /** Top of the scroll area: just under the party table. */
  private get viewTop(): number {
    return this.partyY + 18 + Math.max(1, this.summary.party.length) * this.rowH;
  }

  /** Hover area in a detail row that shows a name next to the pointer. */
  private tipZone(x: number, w: number, label: string): Phaser.GameObjects.Zone {
    const z = this.add.zone(x, 0, w, ICON_ROW_H - 2).setOrigin(0).setInteractive();
    z.on('pointerover', (p: Phaser.Input.Pointer) => this.showTip(label, p));
    z.on('pointermove', (p: Phaser.Input.Pointer) => this.showTip(label, p));
    z.on('pointerout', () => this.hideTip());
    return z;
  }

  private showTip(label: string, p: Phaser.Input.Pointer): void {
    this.tipText.setText(label);
    const w = this.tipText.width + 8;
    const x = Phaser.Math.Clamp(p.x + 8, PX + 4, PX + PW - 4 - w);
    const y = p.y - 16;
    this.tipText.setPosition(x + 4, y + 3).setVisible(true);
    this.tipBg.clear();
    this.tipBg.fillStyle(COLOR.ink, 0.95);
    this.tipBg.fillRect(x, y, w, 14);
    this.tipBg.lineStyle(1, COLOR.panelEdge, 1);
    this.tipBg.strokeRect(x + 0.5, y + 0.5, w - 1, 13);
    this.tipBg.setVisible(true);
  }

  private hideTip(): void {
    this.tipText.setVisible(false);
    this.tipBg.setVisible(false);
  }

  private scrollBy(d: number): void {
    this.scroll += d;
    this.applyScroll();
  }

  /**
   * Places the detail rows at the scroll offset and hides every row not wholly inside the scroll area (and its
   * hover areas), which stands in for a mask; draws the scroll bar and more-above/below arrows when they do not fit.
   */
  private applyScroll(): void {
    const top = this.viewTop;
    const bottom = this.viewBottom;
    const view = bottom - top;
    const max = Math.max(0, this.contentH - view);
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, max);
    const off = Math.round(this.scroll);
    for (const r of this.rows) {
      const ry = top + r.y - off;
      const shown = ry >= top && ry + r.h <= bottom;
      r.c.setPosition(0, ry).setVisible(shown);
      for (const o of r.c.list) {
        const input = (o as Phaser.GameObjects.Zone).input;
        if (input) input.enabled = shown;
      }
    }
    this.hideTip();
    this.scrollHint.setVisible(max > 0);
    const g = this.bar;
    g.clear();
    if (max <= 0) return;
    const bx = PX + PW - 8;
    const h = Math.max(12, (view * view) / this.contentH);
    g.fillStyle(COLOR.inkSoft, 1);
    g.fillRect(bx, top, 3, view);
    g.fillStyle(COLOR.panelHi, 1);
    g.fillRect(bx, top + ((view - h) * this.scroll) / max, 3, h);
    g.fillStyle(COLOR.gold, 0.8);
    const cx = PX + PW / 2;
    if (off > 0) g.fillTriangle(cx - 4, top + 1, cx + 4, top + 1, cx, top - 3);
    if (off < max) g.fillTriangle(cx - 4, bottom - 1, cx + 4, bottom - 1, cx, bottom + 3);
  }

  /** Co-op: the host decides what happens next; joiners wait for it or leave. */
  private coopButtons(isHost: boolean, by: number): void {
    const leave = () => leaveSession(this.game, netSession());
    if (isHost) {
      const again = () => {
        const s = netSession();
        if (s) hostStartRun(this.game, s);
      };
      const lobby = () => {
        const s = netSession();
        if (s) hostToLobby(this.game, s);
      };
      const w = 104;
      const buttons = [
        new Button(this, VIEW_W / 2 - w * 1.5 - 8, by, w, 22, 'AGAIN (R)', again),
        new Button(this, VIEW_W / 2 - w / 2, by, w, 22, 'LOBBY (L)', lobby),
        new Button(this, VIEW_W / 2 + w / 2 + 8, by, w, 22, 'LEAVE (T)', leave),
      ];
      new Menu(this, buttons, true);
      onKey(this, 'keydown-R', again);
      onKey(this, 'keydown-L', lobby);
      onKey(this, 'keydown-T', leave);
      return;
    }
    const waiting = text(this, VIEW_W / 2 + 70, by + 11, 'WAITING FOR THE HOST...', { origin: [0, 0.5], color: COLOR.textDim });
    this.tweens.add({ targets: waiting, alpha: 0.4, yoyo: true, repeat: -1, duration: 700 });
    const buttons = [new Button(this, VIEW_W / 2 - 62, by, 124, 22, 'LEAVE (T)', leave)];
    new Menu(this, buttons, true);
    onKey(this, 'keydown-T', leave);
  }
}
