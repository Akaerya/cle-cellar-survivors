import Phaser from 'phaser';
import { ATLAS, FONT_SMALL, FONT_SMALL_SIZE } from '../art/textures';
import { DEPTH } from '../constants';
import type { FxEvent } from '../net/protocol';

interface DamageNumber {
  text: Phaser.GameObjects.BitmapText;
  life: number;
  vy: number;
}

const NUMBER_LIFE = 0.55;
const MAX_NUMBERS = 90;

/** Juice: floating damage numbers, death puffs, rings. All pooled. */
export class Fx {
  private numbers: DamageNumber[] = [];
  private cursor = 0;
  private emitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();
  activeNumbers = 0;
  /** Co-op host: every effect is also handed here to be replayed on the joiners' screens. */
  relay: ((ev: FxEvent) => void) | null = null;

  constructor(private scene: Phaser.Scene) {
    for (let i = 0; i < MAX_NUMBERS; i++) {
      const t = scene.add
        .bitmapText(0, 0, FONT_SMALL, '', FONT_SMALL_SIZE)
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.numbers)
        .setVisible(false);
      this.numbers.push({ text: t, life: 0, vy: 0 });
    }
  }

  damageNumber(x: number, y: number, value: number, big = false): void {
    this.relay?.(['n', Math.round(x), Math.round(y), Math.round(value), big ? 1 : 0]);
    // Reuse the oldest slot when the pool is full.
    let n: DamageNumber | null = null;
    for (let i = 0; i < MAX_NUMBERS; i++) {
      const c = this.numbers[(this.cursor + i) % MAX_NUMBERS];
      if (c.life <= 0) {
        n = c;
        this.cursor = (this.cursor + i + 1) % MAX_NUMBERS;
        break;
      }
    }
    if (!n) {
      n = this.numbers[this.cursor];
      this.cursor = (this.cursor + 1) % MAX_NUMBERS;
    }
    n.life = NUMBER_LIFE;
    n.vy = -38 - Math.random() * 10;
    n.text
      .setText(String(Math.max(1, Math.round(value))))
      .setPosition(Math.round(x + (Math.random() * 6 - 3)), Math.round(y - 6))
      .setTint(big ? 0xffd24a : 0xffffff)
      .setAlpha(1)
      .setVisible(true);
  }

  update(dt: number): void {
    let active = 0;
    for (const n of this.numbers) {
      if (n.life <= 0) continue;
      n.life -= dt;
      if (n.life <= 0) {
        n.text.setVisible(false);
        continue;
      }
      active++;
      n.vy += 90 * dt;
      n.text.y += n.vy * dt;
      if (n.life < 0.2) n.text.setAlpha(n.life / 0.2);
    }
    this.activeNumbers = active;
  }

  private emitter(color: number): Phaser.GameObjects.Particles.ParticleEmitter {
    let e = this.emitters.get(color);
    if (!e) {
      e = this.scene.add.particles(0, 0, ATLAS, {
        frame: 'px',
        speed: { min: 20, max: 70 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 220, max: 420 },
        scale: { start: 1, end: 0 },
        alpha: { start: 1, end: 0.2 },
        tint: color,
        emitting: false,
      });
      e.setDepth(DEPTH.fx);
      this.emitters.set(color, e);
    }
    return e;
  }

  puff(x: number, y: number, color: number, count = 8): void {
    this.relay?.(['p', Math.round(x), Math.round(y), color, count]);
    this.emitter(color).explode(count, x, y);
    this.emitter(0x2c2338).explode(Math.ceil(count / 3), x, y);
  }

  sparkle(x: number, y: number, color: number): void {
    this.emitter(color).explode(3, x, y);
  }

  /** Expanding ring, e.g. on level up. */
  ring(x: number, y: number, color: number, radius: number, duration = 400): void {
    this.relay?.(['r', Math.round(x), Math.round(y), color, radius, duration]);
    const g = this.scene.add.graphics().setDepth(DEPTH.fx);
    const state = { r: 4, a: 1 };
    this.scene.tweens.add({
      targets: state,
      r: radius,
      a: 0,
      duration,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        g.clear();
        g.lineStyle(2, color, state.a);
        g.strokeCircle(x, y, state.r);
      },
      onComplete: () => g.destroy(),
    });
  }
}
