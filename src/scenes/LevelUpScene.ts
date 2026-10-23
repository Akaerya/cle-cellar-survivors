import Phaser from 'phaser';
import { ATLAS, FONT_SMALL, FONT_SMALL_SIZE } from '../art/textures';
import { COLOR, MAX_LEVEL, SCENES, VIEW_H, VIEW_W } from '../constants';
import { sfx } from '../core/sfx';
import { drawPanel, onKey, text } from '../ui/widgets';
import type { Choice, GameScene } from './GameScene';

const CARD_W = 176;
const CARD_H = 172;
const GAP = 12;
const INPUT_GUARD_MS = 250;

interface Card {
  choice: Choice;
  root: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
  zone: Phaser.GameObjects.Zone;
  x: number;
  y: number;
}

/** Game paused, three upgrade cards over a dimmed playfield. Queued level-ups are shown one after another. */
export class LevelUpScene extends Phaser.Scene {
  private run!: GameScene;
  private cards: Card[] = [];
  private selected = 0;
  private readyAt = 0;
  private busy = false;
  private subtitle!: Phaser.GameObjects.BitmapText;

  constructor() {
    super(SCENES.levelUp);
  }

  create(): void {
    this.run = this.scene.get(SCENES.game) as GameScene;
    this.cards = [];
    this.busy = false;
    this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x0a0610, 0.55).setOrigin(0);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);
    const title = text(this, VIEW_W / 2, 44, 'LEVEL UP!', { scale: 3, origin: [0.5, 0.5], color: COLOR.gold });
    this.tweens.add({ targets: title, scale: { from: 1.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    this.subtitle = text(this, VIEW_W / 2, 70, '', { origin: [0.5, 0.5], color: COLOR.textDim });
    text(this, VIEW_W / 2, VIEW_H - 22, 'PRESS 1 2 3 OR CLICK A CARD', { origin: [0.5, 0.5], color: COLOR.textDim });

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

    this.showChoices(this.run.rollChoices());
  }

  private showChoices(choices: Choice[]): void {
    for (const c of this.cards) {
      c.root.destroy();
      c.zone.destroy();
    }
    this.cards = [];
    this.selected = 0;
    this.readyAt = this.time.now + INPUT_GUARD_MS;
    const pending = this.run.pendingLevelUps;
    this.subtitle.setText(`LEVEL ${this.run.level - pending + 1}${pending > 1 ? `  (+${pending - 1} MORE)` : ''} · CHOOSE ONE`);

    const total = choices.length * CARD_W + (choices.length - 1) * GAP;
    const x0 = Math.round((VIEW_W - total) / 2);
    const y = 92;
    choices.forEach((choice, i) => {
      const x = x0 + i * (CARD_W + GAP);
      const card = this.makeCard(choice, i, x, y);
      this.cards.push(card);
      card.root.setAlpha(0).setY(18);
      this.tweens.add({ targets: card.root, alpha: 1, y: 0, delay: i * 70, duration: 220, ease: 'Quad.easeOut' });
    });
    this.select(0, false);
  }

  private makeCard(choice: Choice, index: number, x: number, y: number): Card {
    const root = this.add.container(0, 0);
    const frame = this.add.graphics();
    root.add(frame);

    root.add(text(this, x + 7, y + 6, String(index + 1), { color: COLOR.textDim }));
    if (choice.kind !== 'heal') {
      const tag = choice.isNew ? 'NEW!' : `LV ${choice.level}`;
      root.add(text(this, x + CARD_W - 7, y + 6, tag, { origin: [1, 0], color: choice.isNew ? COLOR.gold : COLOR.text }));
    }
    const icon = this.add.image(x + CARD_W / 2, y + 40, ATLAS, choice.icon).setScale(3);
    root.add(icon);
    this.tweens.add({ targets: icon, y: y + 37, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
    root.add(text(this, x + CARD_W / 2, y + 72, choice.name.toUpperCase(), { origin: [0.5, 0], color: COLOR.gold }));
    const kind = choice.kind === 'weapon' ? 'WEAPON' : choice.kind === 'item' ? 'ITEM' : 'HEAL';
    root.add(text(this, x + CARD_W / 2, y + 84, kind, { origin: [0.5, 0], color: COLOR.textDim }));
    root.add(
      text(this, x + CARD_W / 2, y + 102, choice.text.toUpperCase(), {
        origin: [0.5, 0],
        align: 1,
        maxWidth: CARD_W - 18,
        color: COLOR.text,
      }),
    );

    if (choice.kind !== 'heal') {
      // Level pips: owned levels white, the one this card grants in gold.
      const pip = 8;
      const px0 = x + CARD_W / 2 - (MAX_LEVEL * (pip + 3) - 3) / 2;
      const pips = this.add.graphics();
      for (let l = 1; l <= MAX_LEVEL; l++) {
        const px = px0 + (l - 1) * (pip + 3);
        const py = y + CARD_H - 16;
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
        this.run.applyChoice(card.choice);
        this.busy = false;
        if (this.run.pendingLevelUps > 0) {
          sfx.play('levelup');
          this.showChoices(this.run.rollChoices());
        } else {
          this.scene.stop();
          this.scene.resume(SCENES.game);
        }
      },
    });
  }
}
