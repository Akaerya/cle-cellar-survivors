import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, SCENES, VIEW_H, VIEW_W } from '../constants';
import { loadProfile, saveProfile } from '../core/profile';
import { sfx } from '../core/sfx';
import { CHARACTERS, ultimateDef, weaponDef } from '../data';
import { netSession } from '../net/Net';
import { Button, drawPanel, onKey, text } from '../ui/widgets';

/** Cards are as wide as fits (up to CARD_MAX_W) with every character side by side. */
const CARD_MAX_W = 250;
const CARD_H = 252;
const GAP = 12;
const MARGIN = 10;
const CARD_Y = 46;

interface Card {
  frame: Phaser.GameObjects.Graphics;
  sprite: Phaser.GameObjects.Sprite;
  x: number;
}

/**
 * Pick who to play as. From the title it starts a solo run; from the co-op lobby it saves the
 * choice, tells the host, and goes back to the lobby.
 */
export class CharacterSelectScene extends Phaser.Scene {
  private from: 'title' | 'lobby' = 'title';
  private cards: Card[] = [];
  private index = 0;
  private leaving = false;
  private cardW = CARD_MAX_W;

  constructor() {
    super(SCENES.select);
  }

  create(data?: { from?: 'title' | 'lobby' }): void {
    this.from = data?.from ?? 'title';
    this.leaving = false;
    this.cards = [];
    const profile = loadProfile();
    this.index = Math.max(0, CHARACTERS.findIndex((c) => c.id === profile.character));

    this.cameras.main.setBackgroundColor(0x120d18);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);
    text(this, VIEW_W / 2, 24, 'CHOOSE YOUR CHARACTER', { scale: 2, origin: [0.5, 0.5], color: COLOR.gold });

    const n = CHARACTERS.length;
    const CARD_W = Math.min(CARD_MAX_W, Math.floor((VIEW_W - 2 * MARGIN - (n - 1) * GAP) / n));
    this.cardW = CARD_W;
    const total = n * CARD_W + (n - 1) * GAP;
    const x0 = Math.round((VIEW_W - total) / 2);
    CHARACTERS.forEach((c, i) => {
      const x = x0 + i * (CARD_W + GAP);
      const cx = x + CARD_W / 2;
      const frame = this.add.graphics();
      this.add.image(cx, CARD_Y + 96, ATLAS, 'shadow_l').setScale(1.4);
      const sprite = this.add.sprite(cx, CARD_Y + 58, ATLAS, c.firstFrame).setScale(4).play(`${c.anim}-idle`);
      text(this, cx, CARD_Y + 114, c.name.toUpperCase(), { scale: 2, origin: [0.5, 0.5], color: COLOR.text });
      text(this, cx, CARD_Y + 131, c.title, { origin: [0.5, 0.5], color: COLOR.gold });
      text(this, cx, CARD_Y + 142, c.description.toUpperCase(), { origin: [0.5, 0], color: COLOR.textDim, maxWidth: CARD_W - 20, align: 1 });

      // Descriptions may wrap to three lines; everything below starts after that.
      const lx = x + 12;
      const start = weaponDef(c.startingWeapon);
      this.add.image(lx, CARD_Y + 175, ATLAS, start.icon).setOrigin(0);
      text(this, lx + 20, CARD_Y + 175, 'STARTS WITH', { color: COLOR.textDim });
      text(this, lx + 20, CARD_Y + 184, start.name.toUpperCase(), { color: COLOR.text });

      const ult = ultimateDef(c.ultimate);
      this.add.image(lx, CARD_Y + 198, ATLAS, ult.icon).setOrigin(0);
      text(this, lx + 20, CARD_Y + 196, 'ULTIMATE (Q)', { color: COLOR.textDim });
      text(this, lx + 20, CARD_Y + 205, ult.name.toUpperCase(), { color: COLOR.text, maxWidth: CARD_W - 36 });
      text(this, lx + 20, CARD_Y + 214, `${ult.duration}S · ${ult.cooldown}S COOLDOWN`, { color: COLOR.textDim });

      text(this, lx, CARD_Y + 232, 'KIT', { color: COLOR.textDim });
      c.weapons.forEach((id, k) => this.add.image(lx + 22 + k * 19, CARD_Y + 228, ATLAS, weaponDef(id).icon).setOrigin(0));

      const zone = this.add.zone(x, CARD_Y, CARD_W, CARD_H).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.select(i));
      zone.on('pointerup', () => (this.index === i ? this.confirm() : this.select(i)));
      this.cards.push({ frame, sprite, x });
    });

    const confirmLabel = this.from === 'title' ? 'PLAY (ENTER)' : 'CHOOSE (ENTER)';
    new Button(this, VIEW_W / 2 - 132, 306, 124, 24, confirmLabel, () => this.confirm());
    new Button(this, VIEW_W / 2 + 8, 306, 124, 24, 'BACK (ESC)', () => this.back());
    text(this, VIEW_W / 2, 342, 'LEFT / RIGHT TO CHOOSE · Q CASTS YOUR ULTIMATE IN A RUN', { origin: [0.5, 0.5], color: COLOR.textDim });

    for (const k of ['LEFT', 'A']) onKey(this, `keydown-${k}`, () => this.select(this.index - 1, true));
    for (const k of ['RIGHT', 'D']) onKey(this, `keydown-${k}`, () => this.select(this.index + 1, true));
    onKey(this, 'keydown-ENTER', () => this.confirm());
    onKey(this, 'keydown-SPACE', () => this.confirm());
    onKey(this, 'keydown-ESC', () => this.back());

    this.select(this.index);
    this.cameras.main.fadeIn(250, 18, 13, 24);
  }

  private select(i: number, sound = false): void {
    const n = CHARACTERS.length;
    const next = ((i % n) + n) % n;
    if (sound && next !== this.index) sfx.play('hover');
    this.index = next;
    this.cards.forEach((c, j) => {
      const on = j === this.index;
      c.frame.clear();
      drawPanel(c.frame, c.x, CARD_Y, this.cardW, CARD_H, on ? COLOR.gold : COLOR.panelEdge, on ? 0x2a1f3c : COLOR.panel, on ? 0.96 : 0.8);
      c.sprite.setAlpha(on ? 1 : 0.6);
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
