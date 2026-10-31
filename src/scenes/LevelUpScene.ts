import Phaser from 'phaser';
import { ATLAS, FONT, FONT_SIZE, FONT_SMALL, FONT_SMALL_SIZE } from '../art/textures';
import { COLOR, SCENES, VIEW_H, VIEW_W } from '../constants';
import { EV } from '../core/events';
import { sfx } from '../core/sfx';
import { Button, drawPanel, onKey, text } from '../ui/widgets';
import type { Choice, GameScene } from './GameScene';

const CARD_W = 192;
const CARD_H = 172;
const GAP = 12;
/** Card text: px in from the sides, px kept clear at the bottom (level pips), and the name's height. */
const TEXT_PAD = 9;
const TEXT_BOTTOM = 20;
const NAME_H = 11;
/**
 * Where things sit on a card (px below its top): the icon's middle and scale, the name, the kind and the description.
 * When a description does not fit the roomy layout, every card of the offer uses the compact one (a smaller icon
 * and the text moved up), so the cards stay alike.
 */
interface CardLayout {
  iconY: number;
  iconScale: number;
  nameY: number;
  kindY: number;
  textY: number;
}
const ROOMY: CardLayout = { iconY: 40, iconScale: 3, nameY: 72, kindY: 84, textY: 102 };
const COMPACT: CardLayout = { iconY: 24, iconScale: 2, nameY: 44, kindY: 56, textY: 72 };
/**
 * Font sizes tried, largest first, until a text fits its box. Always the main font (the small one only has digits);
 * below its native size glyphs lose pixel rows, so this is a last resort after the compact layout.
 */
const TEXT_SIZES = [FONT_SIZE, 8, 7, 6];
const INPUT_GUARD_MS = 250;
const KIND_LABELS: Record<Choice['kind'], string> = {
  weapon: 'WEAPON',
  item: 'ITEM',
  mod: 'MODIFICATION',
  powerup: 'POWERUP',
  heal: 'HEAL',
};

interface Card {
  choice: Choice;
  root: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
  zone: Phaser.GameObjects.Zone;
  x: number;
  y: number;
}

/**
 * Game paused, three upgrade cards over a dimmed playfield. Queued level-ups are shown one after another.
 * In co-op every player picks their own cards at the same time; the run is held until all are done.
 */
export class LevelUpScene extends Phaser.Scene {
  private run!: GameScene;
  private cards: Card[] = [];
  private selected = 0;
  private readyAt = 0;
  private busy = false;
  private subtitle!: Phaser.GameObjects.BitmapText;
  private hint!: Phaser.GameObjects.BitmapText;
  private closed = false;
  private shownOnce = false;
  private rerollButton!: Button;

  constructor() {
    super(SCENES.levelUp);
  }

  create(): void {
    this.run = this.scene.get(SCENES.game) as GameScene;
    this.cards = [];
    this.busy = false;
    this.closed = false;
    this.shownOnce = false;
    this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x0a0610, 0.55).setOrigin(0);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);
    const title = text(this, VIEW_W / 2, 44, 'LEVEL UP!', { scale: 3, origin: [0.5, 0.5], color: COLOR.gold });
    this.tweens.add({ targets: title, scale: { from: 1.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    this.subtitle = text(this, VIEW_W / 2, 70, '', { origin: [0.5, 0.5], color: COLOR.textDim });
    this.hint = text(this, VIEW_W / 2, VIEW_H - 22, 'PRESS 1 2 3 OR CLICK A CARD', { origin: [0.5, 0.5], color: COLOR.textDim });
    this.rerollButton = new Button(this, VIEW_W / 2 - 80, 276, 160, 20, '', () => this.reroll());
    this.rerollButton.setVisible(false);
    onKey(this, 'keydown-R', () => this.reroll());

    onKey(this, 'keydown-ONE', () => this.choose(0));
    onKey(this, 'keydown-TWO', () => this.choose(1));
    onKey(this, 'keydown-THREE', () => this.choose(2));
    onKey(this, 'keydown-NUMPAD_ONE', () => this.choose(0));
    onKey(this, 'keydown-NUMPAD_TWO', () => this.choose(1));
    onKey(this, 'keydown-NUMPAD_THREE', () => this.choose(2));
    onKey(this, 'keydown-LEFT', () => this.select(this.selected - 1, true));
    onKey(this, 'keydown-A', () => this.select(this.selected - 1, true));
    onKey(this, 'keydown-RIGHT', () => this.select(this.selected + 1, true));
    onKey(this, 'keydown-D', () => this.select(this.selected + 1, true));
    onKey(this, 'keydown-ENTER', () => this.choose(this.selected));
    onKey(this, 'keydown-SPACE', () => this.choose(this.selected));

    const ev = this.run.events;
    const listeners: [string, (...a: any[]) => void][] = [
      [EV.levelUpOffer, (reroll?: boolean) => this.showOffer(reroll === true)],
      [EV.levelUpWaiting, () => this.showWaiting()],
      [EV.levelUpOver, () => this.close()],
    ];
    for (const [name, fn] of listeners) ev.on(name, fn);
    this.events.once('shutdown', () => {
      for (const [name, fn] of listeners) ev.off(name, fn);
    });

    if (this.run.offer) this.showOffer();
    else this.showWaiting();
  }

  private clearCards(): void {
    for (const c of this.cards) {
      c.root.destroy();
      c.zone.destroy();
    }
    this.cards = [];
  }

  private showOffer(reroll = false): void {
    const offer = this.run.offer;
    if (!offer || this.closed) return;
    if (this.shownOnce && !reroll) sfx.play('levelup');
    this.shownOnce = true;
    this.showChoices(offer.choices, offer.pending);
    const left = offer.rerolls;
    this.rerollButton.label.setText(left > 0 ? `REROLL (R) · ${left} LEFT` : 'NO REROLLS LEFT');
    this.rerollButton.setVisible(true);
    if (left <= 0) this.rerollButton.zone.disableInteractive();
    this.rerollButton.label.setAlpha(left > 0 ? 1 : 0.5);
  }

  /** Replaces all three cards (5 rerolls per player per run). */
  private reroll(): void {
    const offer = this.run.offer;
    if (this.busy || this.closed || !offer || offer.rerolls <= 0 || this.time.now < this.readyAt) return;
    sfx.unlock();
    sfx.play('select');
    this.readyAt = this.time.now + INPUT_GUARD_MS;
    this.run.rerollOffer();
  }

  /** Co-op: this player is done (or has nothing to pick); teammates are still choosing. */
  private showWaiting(): void {
    if (this.closed || this.run.offer) return;
    this.clearCards();
    this.hint.setVisible(false);
    this.rerollButton.setVisible(false);
    this.subtitle.setText(this.run.coop ? 'WAITING FOR TEAMMATES TO CHOOSE...' : '');
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.scene.stop();
    if (!this.run.coop) this.scene.resume(SCENES.game);
  }

  private showChoices(choices: Choice[], pending: number): void {
    this.clearCards();
    this.hint.setVisible(true);
    this.selected = 0;
    this.readyAt = this.time.now + INPUT_GUARD_MS;
    this.subtitle.setText(`LEVEL ${this.run.level - pending + 1}${pending > 1 ? `  (+${pending - 1} MORE)` : ''} · CHOOSE ONE`);

    const total = choices.length * CARD_W + (choices.length - 1) * GAP;
    const x0 = Math.round((VIEW_W - total) / 2);
    const y = 92;
    const layout = choices.every((c) => this.fits(c.text, ROOMY)) ? ROOMY : COMPACT;
    choices.forEach((choice, i) => {
      const x = x0 + i * (CARD_W + GAP);
      const card = this.makeCard(choice, i, x, y, layout);
      this.cards.push(card);
      card.root.setAlpha(0).setY(18);
      this.tweens.add({ targets: card.root, alpha: 1, y: 0, delay: i * 70, duration: 220, ease: 'Quad.easeOut' });
    });
    this.select(0, false);
  }

  /**
   * Centred text from (x, y) down, wrapped to `w` px, at the largest of TEXT_SIZES that keeps it within `h` px (the
   * smallest when even that does not).
   */
  /** True when `str` fits a card's description box in `layout` at the font's native size. */
  private fits(str: string, layout: CardLayout): boolean {
    const t = this.add.bitmapText(0, 0, FONT, str.toUpperCase(), FONT_SIZE).setMaxWidth(CARD_W - 2 * TEXT_PAD);
    const ok = t.height <= CARD_H - TEXT_BOTTOM - layout.textY;
    t.destroy();
    return ok;
  }

  private fitText(x: number, y: number, str: string, w: number, h: number, color: number): Phaser.GameObjects.BitmapText {
    const t = this.add.bitmapText(x, y, FONT, str, FONT_SIZE).setOrigin(0.5, 0).setTint(color);
    t.align = 1;
    for (const size of TEXT_SIZES) {
      t.setFontSize(size).setMaxWidth(w);
      if (t.height <= h && t.width <= w) break;
    }
    return t;
  }

  private makeCard(choice: Choice, index: number, x: number, y: number, layout: CardLayout): Card {
    const root = this.add.container(0, 0);
    const frame = this.add.graphics();
    root.add(frame);

    root.add(text(this, x + 7, y + 6, String(index + 1), { color: COLOR.textDim }));
    if (choice.kind !== 'heal') {
      const tag = choice.isNew ? 'NEW!' : `LV ${choice.level}`;
      root.add(text(this, x + CARD_W - 7, y + 6, tag, { origin: [1, 0], color: choice.isNew ? COLOR.gold : COLOR.text }));
    }
    const icon = this.add.image(x + CARD_W / 2, y + layout.iconY, ATLAS, choice.icon).setScale(layout.iconScale);
    root.add(icon);
    this.tweens.add({ targets: icon, y: y + layout.iconY - layout.iconScale, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
    root.add(this.fitText(x + CARD_W / 2, y + layout.nameY, choice.name.toUpperCase(), CARD_W - 2 * TEXT_PAD, NAME_H, COLOR.gold));
    const kind = KIND_LABELS[choice.kind];
    root.add(text(this, x + CARD_W / 2, y + layout.kindY, kind, { origin: [0.5, 0], color: COLOR.textDim }));
    const textH = CARD_H - TEXT_BOTTOM - layout.textY;
    root.add(this.fitText(x + CARD_W / 2, y + layout.textY, choice.text.toUpperCase(), CARD_W - 2 * TEXT_PAD, textH, COLOR.text));

    if (choice.kind !== 'heal') {
      // Level pips: owned levels white, the one this card grants in gold. Powerups (20 levels) get smaller pips.
      const max = choice.maxLevel;
      const pip = max > 5 ? 5 : 8;
      const gap = max > 5 ? 2 : 3;
      const px0 = x + CARD_W / 2 - (max * (pip + gap) - gap) / 2;
      const pips = this.add.graphics();
      for (let l = 1; l <= max; l++) {
        const px = px0 + (l - 1) * (pip + gap);
        const py = y + CARD_H - 8 - pip;
        pips.fillStyle(COLOR.ink, 1);
        pips.fillRect(px - 1, py - 1, pip + 2, pip + 2);
        const color = l < choice.level ? COLOR.text : l === choice.level ? COLOR.gold : 0x3a3149;
        pips.fillStyle(color, 1);
        pips.fillRect(px, py, pip, pip);
      }
      root.add(pips);
    } else {
      root.add(
        this.add
          .bitmapText(x + CARD_W / 2, y + CARD_H - 12, FONT_SMALL, '+30', FONT_SMALL_SIZE)
          .setOrigin(0.5, 1)
          .setTint(COLOR.good)
          .setScale(2),
      );
    }

    const zone = this.add.zone(x, y, CARD_W, CARD_H).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => this.select(index, true));
    zone.on('pointerup', () => this.choose(index));
    const card: Card = { choice, root, frame, zone, x, y };
    this.drawCard(card, false);
    return card;
  }

  private drawCard(card: Card, on: boolean): void {
    const g = card.frame;
    g.clear();
    drawPanel(g, card.x, card.y, CARD_W, CARD_H, on ? COLOR.gold : COLOR.panelEdge, on ? 0x2a1f3c : COLOR.panel, 0.97);
    if (on) {
      g.lineStyle(1, COLOR.goldDark, 1);
      g.strokeRect(card.x + 2.5, card.y + 2.5, CARD_W - 5, CARD_H - 5);
    }
  }

  private select(i: number, sound: boolean): void {
    if (this.cards.length === 0) return;
    const n = this.cards.length;
    const next = ((i % n) + n) % n;
    if (sound && next !== this.selected) sfx.play('hover');
    this.selected = next;
    this.cards.forEach((c, j) => this.drawCard(c, j === next));
  }

  private choose(i: number): void {
    if (this.busy || i < 0 || i >= this.cards.length || this.time.now < this.readyAt) return;
    this.busy = true;
    sfx.unlock();
    sfx.play('select');
    const card = this.cards[i];
    this.select(i, false);
    const flash = this.add.rectangle(card.x, card.y, CARD_W, CARD_H, 0xffffff, 0.7).setOrigin(0);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 160,
      onComplete: () => {
        flash.destroy();
        this.busy = false;
        // The run answers with the next offer, a wait, or the end of the level-up (see create).
        this.run.chooseCard(i);
        if (!this.run.offer) this.showWaiting();
      },
    });
  }
}
