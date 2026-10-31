import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, MAX_LEVEL, PLAYER_COLORS, SCENES, VIEW_H, VIEW_W } from '../constants';
import type { BuildEntry, PartyMember, RunSummary } from '../core/events';
import { formatTime } from '../core/progression';
import { sfx } from '../core/sfx';
import { characterDef } from '../data';
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

/** 1234 -> 1234, 12345 -> 12.3K, 1234567 -> 1.2M. Decimals only below 100. */
function short(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v < 100 && !Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v));
}

/**
 * End of the run: time, level and kills, then the party screen. One row per player with their
 * damage, DPS, kills and survival numbers; below it, the selected player's weapons (and ultimate)
 * with level, damage, DPS, kills and share of their damage, then their items, modifications and powerups.
 */
export class GameOverScene extends Phaser.Scene {
  private summary!: RunSummary;
  private selected = 0;
  private rowBg!: Phaser.GameObjects.Graphics;
  private detail!: Phaser.GameObjects.Container;

  constructor() {
    super(SCENES.gameOver);
  }

  create(summary: RunSummary): void {
    this.summary = summary;
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
    const colW = 110;
    const sx0 = VIEW_W / 2 - (colW * stats.length) / 2;
    stats.forEach(([k, v], i) => {
      const cx = sx0 + colW * (i + 0.5);
      text(this, cx, PY + 52, k, { origin: [0.5, 0], color: COLOR.textDim });
      text(this, cx, PY + 62, v, { scale: 2, origin: [0.5, 0], color: COLOR.text });
    });

    this.drawParty();
    this.detail = this.add.container(0, 0);
    this.selected = Math.max(0, summary.party.findIndex((m) => m.slot === summary.mySlot));
    this.select(this.selected, false);

    text(this, PX + PW - 8, PY + PH - 6, `SEED ${summary.seed}`, { origin: [1, 1], color: 0x5a4f73 });
    if (summary.party.length > 1) {
      text(this, PX + 8, PY + PH - 6, 'UP/DOWN OR CLICK: PLAYER', { origin: [0, 1], color: 0x5a4f73 });
    }
    for (const k of ['UP', 'W']) onKey(this, `keydown-${k}`, () => this.select(this.selected - 1, true));
    for (const k of ['DOWN', 'S']) onKey(this, `keydown-${k}`, () => this.select(this.selected + 1, true));

    const by = PY + PH - 36;
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
    text(this, LEFT, PARTY_Y - 14, 'PARTY', { color: COLOR.gold });
    this.rowBg = this.add.graphics();
    let x = LEFT;
    for (const c of PARTY_COLS) {
      text(this, x, PARTY_Y, c.label, { color: COLOR.textDim });
      x += c.w;
    }
    const line = this.add.graphics();
    line.lineStyle(1, COLOR.panelEdge, 1);
    line.lineBetween(LEFT, PARTY_Y + 10.5, PX + PW - 14, PARTY_Y + 10.5);
    party.forEach((m, i) => {
      const y = PARTY_Y + 13 + i * ROW_H;
      let cx = LEFT;
      PARTY_COLS.forEach((c, k) => {
        const color = k === 0 ? (this.summary.coopPlayers !== undefined ? PLAYER_COLORS[m.slot] : COLOR.gold) : COLOR.text;
        // Players who left are dimmed; their numbers stop where they left.
        text(this, cx, y, c.value(m), { color }).setAlpha(m.left ? 0.45 : 1);
        cx += c.w;
      });
      const zone = this.add.zone(LEFT - 4, y - 1, PW - 20, ROW_H).setOrigin(0).setInteractive({ useHandCursor: true });
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
      this.rowBg.fillRect(LEFT - 4, PARTY_Y + 12 + next * ROW_H, PW - 20, ROW_H);
    }
    this.drawDetail(this.summary.party[next]);
  }

  /** The selected player's weapons, ultimate, items, modifications and powerups. */
  private drawDetail(m: PartyMember): void {
    const d = this.detail;
    d.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (d.add(o), o);
    let y = PARTY_Y + 18 + Math.max(1, this.summary.party.length) * ROW_H;
    const cols = { lv: LEFT + 190, damage: LEFT + 250, dps: LEFT + 320, kills: LEFT + 380, share: LEFT + 440 };
    add(text(this, LEFT, y, `${m.name}'S WEAPONS`, { color: COLOR.gold }));
    for (const [k, x] of Object.entries(cols)) add(text(this, x, y, k === 'lv' ? 'LEVEL' : k.toUpperCase(), { color: COLOR.textDim }));
    y += 12;
    const total = Math.max(1, m.stats.damage);
    for (const w of m.weapons) {
      add(this.add.image(LEFT, y, ATLAS, w.icon).setOrigin(0));
      add(text(this, LEFT + 20, y + 4, w.name.toUpperCase(), { color: w.ultimate ? COLOR.gold : COLOR.text }));
      const lv = w.ultimate ? 'ULT' : w.passive ? 'PASSIVE' : `LV ${w.level}`;
      add(text(this, cols.lv, y + 4, lv, { color: w.ultimate || w.level >= MAX_LEVEL ? COLOR.gold : COLOR.text }));
      add(text(this, cols.damage, y + 4, short(w.damage), { color: COLOR.gold }));
      add(text(this, cols.dps, y + 4, short(w.dps), { color: COLOR.text }));
      add(text(this, cols.kills, y + 4, String(w.kills), { color: COLOR.text }));
      add(text(this, cols.share, y + 4, `${Math.round((w.damage / total) * 100)}%`, { color: COLOR.textDim }));
      y += 17;
    }
    y += 2;
    add(text(this, LEFT, y + 4, 'ITEMS', { color: COLOR.textDim }));
    if (m.items.length === 0) add(text(this, LEFT + 44, y + 4, 'NONE', { color: COLOR.textDim }));
    m.items.forEach((it, i) => {
      const x = LEFT + 44 + i * 86;
      add(this.add.image(x, y, ATLAS, it.icon).setOrigin(0));
      add(text(this, x + 20, y + 4, `${it.name.toUpperCase()} ${it.level}`, { color: it.level >= (it.max ?? MAX_LEVEL) ? COLOR.gold : COLOR.text }));
    });
    add(text(this, PX + PW - 14, y + 4, `EXP ${short(m.stats.exp)} · REROLLS ${m.stats.rerolls ?? 0}`, { origin: [1, 0], color: COLOR.textDim }));

    // Modifications and powerups: icon and level only (there can be many).
    y += 18;
    let x = LEFT;
    const icons = (label: string, list: BuildEntry[]) => {
      x += add(text(this, x, y + 4, label, { color: COLOR.textDim })).width + 8;
      if (list.length === 0) x += add(text(this, x, y + 4, 'NONE', { color: COLOR.textDim })).width + 8;
      for (const e of list) {
        add(this.add.image(x, y, ATLAS, e.icon).setOrigin(0));
        add(text(this, x + 17, y + 4, String(e.level), { color: e.level >= (e.max ?? MAX_LEVEL) ? COLOR.gold : COLOR.text }));
        x += 30;
      }
      x += 10;
    };
    icons('MODS', m.mods ?? []);
    icons('POWERUPS', m.powerups ?? []);
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
