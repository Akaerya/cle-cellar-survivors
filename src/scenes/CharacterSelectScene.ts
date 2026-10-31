import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, SCENES, VIEW_H, VIEW_W } from '../constants';
import { loadProfile, saveProfile } from '../core/profile';
import { sfx } from '../core/sfx';
import { CHARACTERS, passiveDef, ultimateDef, weaponDef } from '../data';
import { netSession } from '../net/Net';
import { Button, drawPanel, onKey, text } from '../ui/widgets';

/** Portraits: one small box per character in a row (wrapping onto more rows when there are many). */
const PORTRAIT_W = 52;
const PORTRAIT_H = 58;
const PORTRAIT_GAP = 6;
const PORTRAIT_Y = 40;
const PORTRAITS_PER_ROW = 10;
/** The selected character's details, under the portraits. */
const DETAIL_X = 16;
const DETAIL_W = VIEW_W - 32;
const DETAIL_BOTTOM = 298;
/** Width of the detail panel's left column (the character, its name and title). */
const DETAIL_LEFT_W = 132;
/** px between the rows of the detail panel's right column. */
const ROW_GAP = 5;
/** px between kit entries, and how many fit on one line. */
const KIT_W = 200;
const KIT_PER_ROW = 2;

interface Portrait {
  frame: Phaser.GameObjects.Graphics;
  sprite: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
}

/**
 * Pick who to play as: a portrait per character, and under them the selected character's details (description,
 * starting weapon, ultimate, passive and kit). Clicking a portrait (or LEFT / RIGHT) selects it; clicking it again,
 * ENTER or PLAY confirms. From the title it starts a solo run; from the co-op lobby it saves the choice, tells the
 * host, and goes back to the lobby.
 */
export class CharacterSelectScene extends Phaser.Scene {
  private from: 'title' | 'lobby' = 'title';
  private portraits: Portrait[] = [];
  private detail!: Phaser.GameObjects.Container;
  private detailY = 0;
  private index = 0;
  private hover = -1;
  private leaving = false;

  constructor() {
    super(SCENES.select);
  }

  create(data?: { from?: 'title' | 'lobby' }): void {
    this.from = data?.from ?? 'title';
    this.leaving = false;
    this.portraits = [];
    this.hover = -1;
    const profile = loadProfile();
    this.index = Math.max(0, CHARACTERS.findIndex((c) => c.id === profile.character));

    this.cameras.main.setBackgroundColor(0x120d18);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);
    text(this, VIEW_W / 2, 20, 'CHOOSE YOUR CHARACTER', { scale: 2, origin: [0.5, 0.5], color: COLOR.gold });

    const n = CHARACTERS.length;
    const rows = Math.ceil(n / PORTRAITS_PER_ROW);
    CHARACTERS.forEach((c, i) => {
      const row = Math.floor(i / PORTRAITS_PER_ROW);
      const inRow = Math.min(PORTRAITS_PER_ROW, n - row * PORTRAITS_PER_ROW);
      const rowW = inRow * PORTRAIT_W + (inRow - 1) * PORTRAIT_GAP;
      const x = Math.round((VIEW_W - rowW) / 2) + (i % PORTRAITS_PER_ROW) * (PORTRAIT_W + PORTRAIT_GAP);
      const y = PORTRAIT_Y + row * (PORTRAIT_H + PORTRAIT_GAP);
      const cx = x + PORTRAIT_W / 2;
      const frame = this.add.graphics();
      const sprite = this.add.sprite(cx, y + 24, ATLAS, c.firstFrame).setScale(2).play(`${c.anim}-idle`);
      text(this, cx, y + PORTRAIT_H - 8, c.name.toUpperCase(), { origin: [0.5, 0.5], color: COLOR.text });
      const zone = this.add.zone(x, y, PORTRAIT_W, PORTRAIT_H).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.setHover(i));
      zone.on('pointerout', () => this.setHover(-1));
      zone.on('pointerup', () => (this.index === i ? this.confirm() : this.select(i, true)));
      this.portraits.push({ frame, sprite, x, y });
    });

    this.detailY = PORTRAIT_Y + rows * (PORTRAIT_H + PORTRAIT_GAP) + 2;
    const panel = this.add.graphics();
    drawPanel(panel, DETAIL_X, this.detailY, DETAIL_W, DETAIL_BOTTOM - this.detailY, COLOR.panelEdge, COLOR.panel, 0.9);
    this.detail = this.add.container(0, 0);

    const confirmLabel = this.from === 'title' ? 'PLAY (ENTER)' : 'CHOOSE (ENTER)';
    new Button(this, VIEW_W / 2 - 132, 306, 124, 24, confirmLabel, () => this.confirm());
    new Button(this, VIEW_W / 2 + 8, 306, 124, 24, 'BACK (ESC)', () => this.back());
    text(this, VIEW_W / 2, 342, 'CLICK OR LEFT / RIGHT TO SEE A CHARACTER · CLICK AGAIN OR ENTER TO PICK', { origin: [0.5, 0.5], color: COLOR.textDim });

    for (const k of ['LEFT', 'A']) onKey(this, `keydown-${k}`, () => this.select(this.index - 1, true));
    for (const k of ['RIGHT', 'D']) onKey(this, `keydown-${k}`, () => this.select(this.index + 1, true));
    onKey(this, 'keydown-ENTER', () => this.confirm());
    onKey(this, 'keydown-SPACE', () => this.confirm());
    onKey(this, 'keydown-ESC', () => this.back());

    this.select(this.index);
    this.cameras.main.fadeIn(250, 18, 13, 24);
  }

  private setHover(i: number): void {
    this.hover = i;
    this.drawPortraits();
  }

  private select(i: number, sound = false): void {
    const n = CHARACTERS.length;
    const next = ((i % n) + n) % n;
    if (sound && next !== this.index) sfx.play('hover');
    this.index = next;
    this.drawPortraits();
    this.drawDetail();
  }

  /** Selected: gold edge and lit; hovered: a lighter edge; the rest dimmed. */
  private drawPortraits(): void {
    this.portraits.forEach((p, j) => {
      const on = j === this.index;
      const hot = j === this.hover;
      const edge = on ? COLOR.gold : hot ? COLOR.panelHi : COLOR.panelEdge;
      p.frame.clear();
      drawPanel(p.frame, p.x, p.y, PORTRAIT_W, PORTRAIT_H, edge, on ? 0x2a1f3c : COLOR.panel, on ? 0.96 : 0.8);
      p.sprite.setAlpha(on || hot ? 1 : 0.55);
    });
  }

  /** The selected character: art, name and title on the left; description, abilities and kit on the right. */
  private drawDetail(): void {
    const d = this.detail;
    d.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (d.add(o), o);
    const c = CHARACTERS[this.index];
    const top = this.detailY;
    const lcx = DETAIL_X + DETAIL_LEFT_W / 2;
    add(this.add.image(lcx, top + 76, ATLAS, 'shadow_l').setScale(1.5));
    add(this.add.sprite(lcx, top + 46, ATLAS, c.firstFrame).setScale(3).play(`${c.anim}-idle`));
    add(text(this, lcx, top + 98, c.name.toUpperCase(), { scale: 2, origin: [0.5, 0.5], color: COLOR.text }));
    add(text(this, lcx, top + 110, c.title, { origin: [0.5, 0], color: COLOR.gold, maxWidth: DETAIL_LEFT_W - 12, align: 1 }));

    const x = DETAIL_X + DETAIL_LEFT_W;
    const w = DETAIL_W - DETAIL_LEFT_W - 10;
    let y = top + 8;
    y += add(text(this, x, y, c.description.toUpperCase(), { color: COLOR.textDim, maxWidth: w })).height + ROW_GAP + 2;
    const row = (icon: string, name: string, note: string, about: string) => {
      add(this.add.image(x, y, ATLAS, icon).setOrigin(0));
      const head = add(text(this, x + 20, y, name.toUpperCase(), { color: COLOR.text }));
      add(text(this, x + 20 + head.width + 6, y, note, { color: COLOR.gold }));
      const body = add(text(this, x + 20, y + 10, about.toUpperCase(), { color: COLOR.textDim, maxWidth: w - 20 }));
      y += Math.max(18, 10 + body.height) + ROW_GAP;
    };
    const start = weaponDef(c.startingWeapon);
    row(start.icon, start.name, 'STARTING WEAPON', start.description);
    const ult = ultimateDef(c.ultimate);
    row(ult.icon, ult.name, `ULTIMATE (Q) · ${ult.cooldown}S`, ult.description);
    if (c.passive) {
      const pd = passiveDef(c.passive);
      row(pd.icon, pd.name, 'PASSIVE', pd.description);
    }
    add(text(this, x, y + 4, 'KIT', { color: COLOR.textDim }));
    c.weapons.forEach((id, k) => {
      const def = weaponDef(id);
      const kx = x + 24 + (k % KIT_PER_ROW) * KIT_W;
      const ky = y + Math.floor(k / KIT_PER_ROW) * 18;
      add(this.add.image(kx, ky, ATLAS, def.icon).setOrigin(0));
      add(text(this, kx + 19, ky + 4, def.name.toUpperCase(), { color: COLOR.text }));
    });
  }

  private confirm(): void {
    if (this.leaving) return;
    this.leaving = true;
    sfx.unlock();
    sfx.play('select');
    const profile = { ...loadProfile(), character: CHARACTERS[this.index].id };
    saveProfile(profile);
    if (this.from === 'lobby') {
      const s = netSession();
      if (!s) {
        this.scene.start(SCENES.title);
        return;
      }
      s.setMyProfile(profile);
      this.scene.start(SCENES.lobby, { mode: 'resume' });
      return;
    }
    this.cameras.main.fadeOut(260, 18, 13, 24);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(SCENES.game, {}));
  }

  private back(): void {
    if (this.leaving) return;
    this.leaving = true;
    sfx.play('pause');
    if (this.from === 'lobby' && netSession()) this.scene.start(SCENES.lobby, { mode: 'resume' });
    else this.scene.start(SCENES.title);
  }
}
