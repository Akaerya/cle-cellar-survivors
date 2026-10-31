import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, SCENES, VIEW_H, VIEW_W } from '../constants';
import { loadProfile, saveProfile } from '../core/profile';
import { sfx } from '../core/sfx';
import { CHARACTERS, passiveDef, ultimateDef, weaponDef } from '../data';
import { netSession } from '../net/Net';
import { Button, drawPanel, onKey, text } from '../ui/widgets';

/**
 * Accordion: the chosen card is FULL_W wide with everything on it; the others share what is left (at most FULL_W)
 * and show the character, its name and its kit.
 */
const FULL_W = 238;
const CARD_H = 258;
const GAP = 8;
const MARGIN = 6;
const CARD_Y = 42;
/** px between the starting weapon, ultimate and passive rows. */
const ROW_GAP = 3;
/** The character is drawn this many times its size, its middle this many px below the top of the card. */
const SPRITE_SCALE = 2;
const SPRITE_Y = 34;
/** px below the top of the card of the name, the title and the description. */
const NAME_Y = 64;
const TITLE_Y = 79;
const DESC_Y = 88;
/** Folded cards: px below the top of the card of the kit icons (two per row), the ultimate and passive icons. */
const FOLDED_KIT_Y = 82;
const FOLDED_ICON_STEP = 19;

interface Card {
  /** Everything on the card, moved as one when the cards make room for the chosen one. */
  box: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  zone: Phaser.GameObjects.Zone;
  /** Shown while chosen, and while folded. */
  full: Phaser.GameObjects.Container;
  folded: Phaser.GameObjects.Container;
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
  /** Width of every card but the chosen one. */
  private foldedW = FULL_W;

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
    this.foldedW = n > 1 ? Math.min(FULL_W, Math.floor((VIEW_W - 2 * MARGIN - FULL_W - (n - 1) * GAP) / (n - 1))) : FULL_W;
    CHARACTERS.forEach((c, i) => {
      const box = this.add.container(0, 0);
      const frame = this.add.graphics();
      const shadow = this.add.image(0, CARD_Y + SPRITE_Y + 10 * SPRITE_SCALE - 2, ATLAS, 'shadow_l');
      const sprite = this.add.sprite(0, CARD_Y + SPRITE_Y, ATLAS, c.firstFrame).setScale(SPRITE_SCALE).play(`${c.anim}-idle`);
      const full = this.add.container(0, 0);
      const folded = this.add.container(0, 0);
      const zone = this.add.zone(0, CARD_Y, FULL_W, CARD_H).setOrigin(0).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.select(i));
      zone.on('pointerup', () => (this.index === i ? this.confirm() : this.select(i)));
      box.add([frame, shadow, sprite, full, folded, zone]);

      // Chosen: name, title, description, then rows flowing down, each as tall as its text wraps: starting
      // weapon, ultimate, passive. The kit sits at the bottom.
      const cx = FULL_W / 2;
      full.add(text(this, cx, CARD_Y + NAME_Y, c.name.toUpperCase(), { scale: 2, origin: [0.5, 0.5], color: COLOR.text }));
      full.add(text(this, cx, CARD_Y + TITLE_Y, c.title, { origin: [0.5, 0.5], color: COLOR.gold }));
      const desc = text(this, cx, CARD_Y + DESC_Y, c.description.toUpperCase(), { origin: [0.5, 0], color: COLOR.textDim, maxWidth: FULL_W - 16, align: 1 });
      full.add(desc);
      const lx = 8;
      const tw = FULL_W - 28;
      let y = CARD_Y + DESC_Y + desc.height + ROW_GAP + 2;
      const row = (icon: string, name: string, note: string) => {
        full.add(this.add.image(lx, y + 1, ATLAS, icon).setOrigin(0));
        const t = text(this, lx + 20, y, name.toUpperCase(), { color: COLOR.text, maxWidth: tw });
        const n = text(this, lx + 20, y + t.height, note, { color: COLOR.textDim, maxWidth: tw });
        full.add([t, n]);
        y += Math.max(18, t.height + n.height) + ROW_GAP;
      };
      const start = weaponDef(c.startingWeapon);
      row(start.icon, start.name, 'STARTING WEAPON');
      const ult = ultimateDef(c.ultimate);
      row(ult.icon, ult.name, `ULTIMATE (Q) · ${ult.cooldown}S`);
      const pd = c.passive ? passiveDef(c.passive) : null;
      if (pd) row(pd.icon, pd.name, 'PASSIVE');
      const kitY = CARD_Y + CARD_H - 22;
      full.add(text(this, lx, kitY + 4, 'KIT', { color: COLOR.textDim }));
      c.weapons.forEach((id, k) => full.add(this.add.image(lx + 22 + k * 19, kitY, ATLAS, weaponDef(id).icon).setOrigin(0)));

      // Folded: the name, the kit two icons a row, then the ultimate and passive.
      const fx = this.foldedW / 2;
      folded.add(text(this, fx, CARD_Y + NAME_Y, c.name.toUpperCase(), { origin: [0.5, 0.5], color: COLOR.text }));
      const icons = [...c.weapons.map((id) => weaponDef(id).icon), ult.icon, ...(pd ? [pd.icon] : [])];
      icons.forEach((icon, k) => {
        const col = k % 2;
        const line = Math.floor(k / 2) + (k >= c.weapons.length ? 0.5 : 0);
        folded.add(this.add.image(fx + (col - 0.5) * FOLDED_ICON_STEP, CARD_Y + FOLDED_KIT_Y + line * FOLDED_ICON_STEP, ATLAS, icon).setOrigin(0.5, 0));
      });
      this.cards.push({ box, frame, sprite, shadow, zone, full, folded });
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

  /** Chooses card `i` (wrapping around): it unfolds, and the others fold up beside it. */
  private select(i: number, sound = false): void {
    const n = CHARACTERS.length;
    const next = ((i % n) + n) % n;
    if (sound && next !== this.index) sfx.play('hover');
    this.index = next;
    const total = FULL_W + (n - 1) * (this.foldedW + GAP);
    let x = Math.round((VIEW_W - total) / 2);
    this.cards.forEach((c, j) => {
      const on = j === this.index;
      const w = on ? FULL_W : this.foldedW;
      c.box.x = x;
      c.frame.clear();
      drawPanel(c.frame, 0, CARD_Y, w, CARD_H, on ? COLOR.gold : COLOR.panelEdge, on ? 0x2a1f3c : COLOR.panel, on ? 0.96 : 0.8);
      c.sprite.setX(w / 2).setAlpha(on ? 1 : 0.6);
      c.shadow.setX(w / 2);
      c.full.setVisible(on);
      c.folded.setVisible(!on);
      c.zone.setSize(w, CARD_H);
      x += w + GAP;
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
