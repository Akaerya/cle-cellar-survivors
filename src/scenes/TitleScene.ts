import Phaser from 'phaser';
import { ATLAS, TILESET, TILESET_MARGIN, TILESET_SPACING, TILE_INDEX } from '../art/textures';
import { COLOR, SCENES, TILE, VIEW_H, VIEW_W } from '../constants';
import { sfx } from '../core/sfx';
import { Button, Menu, text } from '../ui/widgets';

/** Game name, Start button, one-line controls hint. */
export class TitleScene extends Phaser.Scene {
  private bats: { s: Phaser.GameObjects.Sprite; vx: number; base: number; amp: number; ph: number }[] = [];
  private starting = false;

  constructor() {
    super(SCENES.title);
  }

  create(data?: { message?: string }): void {
    this.starting = false;
    this.cameras.main.setBackgroundColor(0x120d18);
    this.buildBackdrop();

    // Moon
    const moon = this.add.graphics();
    moon.fillStyle(0xf3e9c6, 0.06);
    moon.fillCircle(530, 64, 52);
    moon.fillStyle(0xf3e9c6, 0.1);
    moon.fillCircle(530, 64, 42);
    moon.fillStyle(0xf3e9c6, 1);
    moon.fillCircle(530, 64, 32);
    moon.fillStyle(0xd9cda4, 1);
    moon.fillCircle(520, 56, 6);
    moon.fillCircle(541, 74, 8);
    moon.fillCircle(537, 50, 3);

    // Bats crossing the sky
    this.bats = [];
    for (let i = 0; i < 7; i++) {
      const s = this.add.sprite(Math.random() * VIEW_W, 0, ATLAS, 'bat_0').play({ key: 'bat-fly', startFrame: i % 4 });
      const scale = 1 + (i % 2);
      s.setScale(scale);
      this.bats.push({ s, vx: (25 + Math.random() * 30) * (i % 2 ? 1 : -1), base: 30 + Math.random() * 120, amp: 6 + Math.random() * 10, ph: Math.random() * 6 });
    }

    const shadowT = text(this, VIEW_W / 2 + 3, 63, 'BANANA', { scale: 5, origin: [0.5, 0.5], color: 0x000000 }).setAlpha(0.5);
    const t1 = text(this, VIEW_W / 2, 60, 'BANANA', { scale: 5, origin: [0.5, 0.5], color: COLOR.gold });
    const t2 = text(this, VIEW_W / 2, 108, 'NOCTURNE', { scale: 4, origin: [0.5, 0.5], color: 0xc9b8ee });
    text(this, VIEW_W / 2, 138, 'SURVIVE THE NIGHT. THROW BANANAS. WAIT FOR DAWN.', { origin: [0.5, 0.5], color: COLOR.textDim });
    this.tweens.add({ targets: [t1, shadowT], y: '-=3', yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: t2, alpha: 0.75, yoyo: true, repeat: -1, duration: 1800, ease: 'Sine.easeInOut' });

    // The monkey, with a ring of enemies peeking in
    this.add.image(VIEW_W / 2, 222, ATLAS, 'shadow_l').setScale(1.2);
    this.add.sprite(VIEW_W / 2, 196, ATLAS, 'monkey_idle_0').setScale(3).play('monkey-idle');
    const foes: [string, number, number, boolean][] = [
      ['zombie-walk', 214, 206, false],
      ['ghoul-run', 160, 214, false],
      ['brute-walk', 452, 200, true],
      ['zombie-walk', 400, 216, true],
    ];
    for (const [anim, x, y, flip] of foes) {
      this.add.sprite(x, y, ATLAS).play(anim).setScale(2).setFlipX(flip).setAlpha(0.9);
    }

    const bw = 108;
    const bx = VIEW_W / 2 - bw * 2 - 12;
    const buttons = [
      new Button(this, bx, 258, bw, 26, 'SOLO', () => this.startRun()),
      new Button(this, bx + bw + 8, 258, bw, 26, 'HOST CO-OP', () => this.toLobby('host')),
      new Button(this, bx + (bw + 8) * 2, 258, bw, 26, 'JOIN CO-OP', () => this.toLobby('join')),
      new Button(this, bx + (bw + 8) * 3, 258, bw, 26, 'WIKI', () => this.scene.start(SCENES.wiki, { from: 'title' })),
    ];
    new Menu(this, buttons, true);
    if (data?.message) {
      text(this, VIEW_W / 2, 244, data.message, { origin: [0.5, 0.5], color: COLOR.bad });
    }
    text(this, VIEW_W / 2, 304, 'MOVE WITH WASD OR ARROW KEYS. YOUR WEAPONS FIRE ON THEIR OWN.', {
      origin: [0.5, 0.5],
      color: COLOR.text,
    });
    text(this, VIEW_W / 2, 318, 'ESC PAUSES · M MUTES', { origin: [0.5, 0.5], color: COLOR.textDim });
    text(this, 6, VIEW_H - 4, 'MVP BUILD', { origin: [0, 1], color: 0x5a4f73 });

    this.cameras.main.fadeIn(400, 18, 13, 24);
  }

  update(_t: number, delta: number): void {
    const dt = delta / 1000;
    for (const b of this.bats) {
      b.ph += dt * 3;
      b.s.x += b.vx * dt;
      b.s.y = b.base + Math.sin(b.ph) * b.amp;
      b.s.setFlipX(b.vx < 0);
      if (b.s.x < -20) b.s.x = VIEW_W + 20;
      if (b.s.x > VIEW_W + 20) b.s.x = -20;
    }
  }

  private toLobby(mode: 'host' | 'join'): void {
    if (this.starting) return;
    this.starting = true;
    sfx.unlock();
    this.scene.start(SCENES.lobby, { mode });
  }

  private startRun(): void {
    if (this.starting) return;
    this.starting = true;
    sfx.unlock();
    this.cameras.main.fadeOut(260, 18, 13, 24);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(SCENES.game, {}));
  }

  /** A small graveyard tilemap behind the title. */
  private buildBackdrop(): void {
    const cols = Math.ceil(VIEW_W / TILE) + 1;
    const rows = Math.ceil(VIEW_H / TILE) + 1;
    const map = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: cols, height: rows });
    const ts = map.addTilesetImage('tiles', TILESET, TILE, TILE, TILESET_MARGIN, TILESET_SPACING)!;
    const floor = map.createBlankLayer('floor', ts)!;
    const decor = map.createBlankLayer('decor', ts)!;
    const T = TILE_INDEX;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const earth = (Math.sin(x * 0.35) + Math.cos(y * 0.5 + x * 0.1)) > 0.4;
        floor.putTileAt(earth ? (Math.random() < 0.25 ? T.earth_b : T.earth_a) : [T.floor_a, T.floor_b, T.floor_c][Math.floor(Math.random() * 3)], x, y);
        const r = Math.random();
        if (y > 13 && r < 0.09) decor.putTileAt([T.grave_round, T.grave_cross, T.grave_broken][Math.floor(Math.random() * 3)], x, y);
        else if (r < 0.06) decor.putTileAt(earth ? T.grass_a : T.crack, x, y);
      }
    }
    this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x0a0610, 0.45).setOrigin(0);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);
  }
}
