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
/** Echo Strike rings: how long one shows, and how many can show at once (the oldest is reused). */
const ECHO_LIFE = 0.25;
const MAX_ECHOES = 64;

interface EchoRing {
  x: number;
  y: number;
  r: number;
  color: number;
  life: number;
}

/** Juice: floating damage numbers, death puffs, rings. All pooled. */
export class Fx {
  private numbers: DamageNumber[] = [];
  private cursor = 0;
  private emitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();
  private echoes: EchoRing[] = [];
  private echoCursor = 0;
  private echoGfx: Phaser.GameObjects.Graphics;
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
    this.echoGfx = scene.add.graphics().setDepth(DEPTH.fx);
    for (let i = 0; i < MAX_ECHOES; i++) this.echoes.push({ x: 0, y: 0, r: 0, color: 0, life: 0 });
  }

  /** Echo Strike going off: a faint ring that swells to `radius` and fades. All echoes share one Graphics. */
  echo(x: number, y: number, radius: number, color: number): void {
    this.relay?.(['e', Math.round(x), Math.round(y), Math.round(radius), color]);
    const ring = this.echoes[this.echoCursor];
    this.echoCursor = (this.echoCursor + 1) % MAX_ECHOES;
    ring.x = x;
    ring.y = y;
    ring.r = radius;
    ring.color = color;
    ring.life = ECHO_LIFE;
  }

  damageNumber(x: number, y: number, value: number, big = false): void {
    this.relay?.(['n', Math.round(x), Math.round(y), Math.round(value), big ? 1 : 0]);
    this.number(x, y, String(Math.max(1, Math.round(value))), big ? 0xffd24a : 0xffffff);
  }

  /** Green "+N" over a player that healed. */
  healNumber(x: number, y: number, value: number): void {
    this.relay?.(['g', Math.round(x), Math.round(y), Math.round(value)]);
    this.number(x, y, `+${Math.max(1, Math.round(value))}`, 0x7be38a);
  }

  private number(x: number, y: number, label: string, tint: number): void {
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
      .setText(label)
      .setPosition(Math.round(x + (Math.random() * 6 - 3)), Math.round(y - 6))
      .setTint(tint)
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

    const g = this.echoGfx;
    g.clear();
    for (const ring of this.echoes) {
      if (ring.life <= 0) continue;
      ring.life -= dt;
      if (ring.life <= 0) continue;
      const k = 1 - ring.life / ECHO_LIFE;
      g.lineStyle(1, ring.color, 0.7 * (1 - k));
      g.strokeCircle(ring.x, ring.y, ring.r * (0.5 + 0.5 * k));
    }
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

  /** A lightning bolt from the sky onto (x, y) with a flash of `radius` px. */
  lightning(x: number, y: number, radius: number, color: number): void {
    this.relay?.(['l', Math.round(x), Math.round(y), Math.round(radius), color]);
    const g = this.scene.add.graphics().setDepth(DEPTH.fx);
    // Bolt path: zig-zag down from above the screen point (visual only, so Math.random is fine).
    const pts: [number, number][] = [];
    const top = y - 120;
    const segs = 7;
    for (let i = 0; i <= segs; i++) {
      const k = i / segs;
      const off = i === segs ? 0 : (Math.random() - 0.5) * 16;
      pts.push([x + off, top + (y - top) * k]);
    }
    const state = { a: 1 };
    const draw = () => {
      g.clear();
      g.fillStyle(color, 0.3 * state.a);
      g.fillCircle(x, y, radius);
      g.lineStyle(4, color, 0.6 * state.a);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts) g.lineTo(px, py);
      g.strokePath();
      g.lineStyle(1, 0xffffff, state.a);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts) g.lineTo(px, py);
      g.strokePath();
      g.lineStyle(1, 0xffffff, 0.7 * state.a);
      g.strokeCircle(x, y, radius * (1.2 - 0.2 * state.a));
    };
    draw();
    this.scene.tweens.add({ targets: state, a: 0, duration: 260, ease: 'Quad.easeIn', onUpdate: draw, onComplete: () => g.destroy() });
    this.emitter(color).explode(5, x, y);
  }

  /** A bomb going off: a bright flash filling `radius` px, a shock ring and some debris. */
  blast(x: number, y: number, radius: number, color: number): void {
    this.relay?.(['x', Math.round(x), Math.round(y), Math.round(radius), color]);
    const g = this.scene.add.graphics().setDepth(DEPTH.fx);
    const state = { k: 0 };
    const draw = () => {
      const a = 1 - state.k;
      g.clear();
      g.fillStyle(0xffffff, 0.35 * a * a);
      g.fillCircle(x, y, radius * (0.4 + 0.3 * state.k));
      g.fillStyle(color, 0.3 * a);
      g.fillCircle(x, y, radius * (0.6 + 0.4 * state.k));
      g.lineStyle(2, color, 0.9 * a);
      g.strokeCircle(x, y, radius * (0.7 + 0.3 * state.k));
    };
    draw();
    this.scene.tweens.add({ targets: state, k: 1, duration: 280, ease: 'Quad.easeOut', onUpdate: draw, onComplete: () => g.destroy() });
    this.emitter(color).explode(8, x, y);
    this.emitter(0x4a2c16).explode(4, x, y);
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
