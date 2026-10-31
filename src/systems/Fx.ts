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
/** Critical strike numbers: colour and scale. */
const CRIT_TINT = 0xff7ad9;
const CRIT_SCALE = 2;
/** Freezing fields and beams that can show at once (the oldest is reused). */
const MAX_VORTICES = 40;
const MAX_BEAMS = 24;
/** Virulent Chain's ink blobs: how many fly at once (the oldest is reused), px/s, the shortest and longest flight in
 * seconds, how high (px) the arc rises per px flown, and the ink's colours. */
const MAX_BLOBS = 32;
const BLOB_SPEED = 320;
const BLOB_MIN = 0.12;
const BLOB_MAX = 0.6;
const BLOB_ARC = 0.12;
const INK = 0x120c18;
const INK_SHINE = 0x4a3a5e;
/** Seconds a field takes to swirl open and to fade at the end. */
const VORTEX_FADE = 0.25;

interface EchoRing {
  x: number;
  y: number;
  r: number;
  color: number;
  life: number;
}

/** A field drawn for `dur` seconds: a swirling freezing vortex, or a spider web. */
interface Vortex {
  x: number;
  y: number;
  r: number;
  color: number;
  age: number;
  dur: number;
  spin: number;
  web: boolean;
}

/** Web fields: spokes, and rings of thread between them. */
const WEB_SPOKES = 8;
const WEB_RINGS = 3;

/** An ink blob flying in an arc from (x1, y1) to (x2, y2) over `dur` seconds (Virulent Chain). */
interface Blob {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  age: number;
  dur: number;
}

/** A lingering beam, bright when it fires and fading over `dur` seconds. */
interface BeamFx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: number;
  age: number;
  dur: number;
}

/** Juice: floating damage numbers, death puffs, rings. All pooled. */
export class Fx {
  private numbers: DamageNumber[] = [];
  private cursor = 0;
  private emitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();
  private echoes: EchoRing[] = [];
  private echoCursor = 0;
  private echoGfx: Phaser.GameObjects.Graphics;
  private vortices: Vortex[] = [];
  private vortexCursor = 0;
  private vortexGfx: Phaser.GameObjects.Graphics;
  private beams: BeamFx[] = [];
  private beamCursor = 0;
  private blobs: Blob[] = [];
  private blobCursor = 0;
  private beamGfx: Phaser.GameObjects.Graphics;
  private time = 0;
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
    // Fields lie on the ground under the units; beams cross over them.
    this.vortexGfx = scene.add.graphics().setDepth(DEPTH.aura);
    for (let i = 0; i < MAX_VORTICES; i++) this.vortices.push({ x: 0, y: 0, r: 0, color: 0, age: 0, dur: 0, spin: 1, web: false });
    this.beamGfx = scene.add.graphics().setDepth(DEPTH.slash);
    for (let i = 0; i < MAX_BEAMS; i++) this.beams.push({ x1: 0, y1: 0, x2: 0, y2: 0, width: 0, color: 0, age: 0, dur: 0 });
    for (let i = 0; i < MAX_BLOBS; i++) this.blobs.push({ x1: 0, y1: 0, x2: 0, y2: 0, age: 0, dur: 0 });
  }

  /** A field at (x, y) of `radius` px that lasts `dur` seconds: a swirling freezing vortex, or a spider web. */
  vortex(x: number, y: number, radius: number, dur: number, color: number, style: 'swirl' | 'web' = 'swirl'): void {
    const web = style === 'web';
    const [rx, ry, rr, rd] = [Math.round(x), Math.round(y), Math.round(radius), Math.round(dur * 100) / 100];
    this.relay?.(web ? ['v', rx, ry, rr, rd, color, 1] : ['v', rx, ry, rr, rd, color]);
    const v = this.vortices[this.vortexCursor];
    this.vortexCursor = (this.vortexCursor + 1) % MAX_VORTICES;
    v.x = x;
    v.y = y;
    v.r = radius;
    v.color = color;
    v.age = 0;
    v.dur = dur;
    v.web = web;
    // Each field turns its own way at a slightly different speed (visual only, so Math.random is fine).
    v.spin = (Math.random() < 0.5 ? -1 : 1) * (2.2 + Math.random() * 0.8);
  }

  /** A beam from (x1, y1) to (x2, y2), `width` px wide, lingering for `dur` seconds. */
  beam(x1: number, y1: number, x2: number, y2: number, width: number, dur: number, color: number): void {
    this.relay?.(['z', Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2), Math.round(width), Math.round(dur * 100) / 100, color]);
    const b = this.beams[this.beamCursor];
    this.beamCursor = (this.beamCursor + 1) % MAX_BEAMS;
    b.x1 = x1;
    b.y1 = y1;
    b.x2 = x2;
    b.y2 = y2;
    b.width = width;
    b.color = color;
    b.age = 0;
    b.dur = dur;
  }

  /** A small blob of ink lobbed from (x1, y1) to (x2, y2) (Virulent Chain moving stacks on). */
  inkBlob(x1: number, y1: number, x2: number, y2: number): void {
    this.relay?.(['i', Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]);
    const b = this.blobs[this.blobCursor];
    this.blobCursor = (this.blobCursor + 1) % MAX_BLOBS;
    b.x1 = x1;
    b.y1 = y1;
    b.x2 = x2;
    b.y2 = y2;
    b.age = 0;
    b.dur = Phaser.Math.Clamp(Math.hypot(x2 - x1, y2 - y1) / BLOB_SPEED, BLOB_MIN, BLOB_MAX);
  }

  /** A pulsing warning circle of `radius` px for `dur` seconds (a boss winding up an attack there). */
  warn(x: number, y: number, radius: number, dur: number, color: number): void {
    this.relay?.(['c', Math.round(x), Math.round(y), Math.round(radius), Math.round(dur * 100) / 100, color]);
    const g = this.scene.add.graphics().setDepth(DEPTH.aura);
    const state = { k: 0 };
    const draw = () => {
      const pulse = 0.5 + 0.5 * Math.sin(state.k * Math.PI * 8);
      g.clear();
      g.fillStyle(color, 0.08 + 0.1 * state.k);
      g.fillCircle(x, y, radius);
      g.fillStyle(color, 0.15 + 0.15 * pulse);
      g.fillCircle(x, y, radius * state.k);
      g.lineStyle(2, color, 0.5 + 0.4 * pulse);
      g.strokeCircle(x, y, radius);
    };
    draw();
    this.scene.tweens.add({ targets: state, k: 1, duration: dur * 1000, onUpdate: draw, onComplete: () => g.destroy() });
  }

  /** A cold crystal burst: a pale flash filling `radius` px, a frosty ring and ice shards flying out. */
  frost(x: number, y: number, radius: number, color: number): void {
    this.relay?.(['k', Math.round(x), Math.round(y), Math.round(radius), color]);
    const g = this.scene.add.graphics().setDepth(DEPTH.fx);
    const state = { k: 0 };
    const spikes = 7;
    const turn = Math.random() * Math.PI * 2;
    const draw = () => {
      const a = 1 - state.k;
      g.clear();
      g.fillStyle(0xffffff, 0.3 * a * a);
      g.fillCircle(x, y, radius * (0.35 + 0.25 * state.k));
      g.fillStyle(color, 0.22 * a);
      g.fillCircle(x, y, radius * (0.75 + 0.25 * state.k));
      g.lineStyle(1, 0xffffff, 0.8 * a);
      g.strokeCircle(x, y, radius * (0.8 + 0.2 * state.k));
      // Ice shards: thin diamonds pointing out from the centre.
      const reach = radius * (0.45 + 0.55 * Math.min(1, state.k * 2));
      for (let i = 0; i < spikes; i++) {
        const ang = turn + (i * Math.PI * 2) / spikes;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        const w = 2.2;
        g.fillStyle(i % 2 ? color : 0xffffff, 0.85 * a);
        g.fillTriangle(x + cs * reach, y + sn * reach, x - sn * w + cs * reach * 0.35, y + cs * w + sn * reach * 0.35, x + sn * w + cs * reach * 0.35, y - cs * w + sn * reach * 0.35);
      }
    };
    draw();
    this.scene.tweens.add({ targets: state, k: 1, duration: 320, ease: 'Quad.easeOut', onUpdate: draw, onComplete: () => g.destroy() });
    this.emitter(0xffffff).explode(5, x, y);
    this.emitter(color).explode(6, x, y);
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

  /** `style`: 0 a normal hit, 1 a big hit (gold), 2 a critical strike (pink and larger). */
  damageNumber(x: number, y: number, value: number, style: 0 | 1 | 2 = 0): void {
    this.relay?.(['n', Math.round(x), Math.round(y), Math.round(value), style]);
    const tint = style === 2 ? CRIT_TINT : style === 1 ? 0xffd24a : 0xffffff;
    this.number(x, y, String(Math.max(1, Math.round(value))), tint, style === 2 ? CRIT_SCALE : 1);
  }

  /** A word floating up like a damage number (BLOCK: a rare enemy ignored a hit; BREAK: its bubble broke). */
  label(x: number, y: number, word: string, color: number): void {
    this.relay?.(['t', Math.round(x), Math.round(y), word, color]);
    this.number(x, y, word, color);
  }

  /** Green "+N" over a player that healed. */
  healNumber(x: number, y: number, value: number): void {
    this.relay?.(['g', Math.round(x), Math.round(y), Math.round(value)]);
    this.number(x, y, `+${Math.max(1, Math.round(value))}`, 0x7be38a);
  }

  private number(x: number, y: number, label: string, tint: number, scale = 1): void {
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
      .setScale(scale)
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

    this.time += dt;
    this.drawVortices(dt);
    this.drawBeams(dt);
    this.drawBlobs(dt);
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

  /** Freezing fields: a pale disc with a frosty rim and spiral arms turning around the centre. */
  private drawVortices(dt: number): void {
    const g = this.vortexGfx;
    g.clear();
    for (const v of this.vortices) {
      if (v.age >= v.dur) continue;
      v.age += dt;
      if (v.age >= v.dur) continue;
      const fade = Math.min(1, v.age / VORTEX_FADE, (v.dur - v.age) / VORTEX_FADE);
      const r = v.r * (0.6 + 0.4 * Math.min(1, v.age / VORTEX_FADE));
      if (v.web) {
        this.drawWeb(g, v, r, fade);
        continue;
      }
      g.fillStyle(v.color, 0.14 * fade);
      g.fillCircle(v.x, v.y, r);
      g.fillStyle(0xffffff, 0.06 * fade);
      g.fillCircle(v.x, v.y, r * 0.45);
      g.lineStyle(1, v.color, 0.55 * fade);
      g.strokeCircle(v.x, v.y, r);
      // Spiral arms: each starts at the centre and curls outward; the whole set turns over time.
      const arms = 4;
      const turn = v.spin * v.age;
      const steps = 10;
      for (let i = 0; i < arms; i++) {
        const a0 = turn + (i * Math.PI * 2) / arms;
        g.lineStyle(i % 2 ? 1 : 2, i % 2 ? 0xffffff : v.color, (i % 2 ? 0.5 : 0.65) * fade);
        g.beginPath();
        for (let j = 0; j <= steps; j++) {
          const k = j / steps;
          const a = a0 + Math.sign(v.spin) * k * 2.4;
          const rr = r * (0.12 + 0.86 * k);
          const px = v.x + Math.cos(a) * rr;
          const py = v.y + Math.sin(a) * rr;
          if (j === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.strokePath();
      }
      // A few frost motes riding the swirl.
      for (let i = 0; i < 3; i++) {
        const a = -turn * 1.3 + (i * Math.PI * 2) / 3;
        const rr = r * (0.35 + 0.25 * Math.sin(this.time * 3 + i));
        g.fillStyle(0xffffff, 0.8 * fade);
        g.fillRect(Math.round(v.x + Math.cos(a) * rr), Math.round(v.y + Math.sin(a) * rr), 1, 1);
      }
    }
  }

  /** A web field: a faint disc, spokes from the centre and rings of thread that sag between them, shimmering. */
  private drawWeb(g: Phaser.GameObjects.Graphics, v: Vortex, r: number, fade: number): void {
    const shimmer = 0.5 + 0.5 * Math.sin(this.time * 4 + v.x);
    g.fillStyle(v.color, 0.1 * fade);
    g.fillCircle(v.x, v.y, r);
    g.lineStyle(1, v.color, 0.7 * fade);
    for (let i = 0; i < WEB_SPOKES; i++) {
      const a = v.spin * 0.1 + (i * Math.PI * 2) / WEB_SPOKES;
      g.lineBetween(v.x, v.y, v.x + Math.cos(a) * r, v.y + Math.sin(a) * r);
    }
    for (let k = 1; k <= WEB_RINGS; k++) {
      const rr = (r * k) / WEB_RINGS;
      g.lineStyle(1, k === WEB_RINGS ? v.color : 0xffffff, (0.35 + 0.3 * shimmer) * fade);
      g.beginPath();
      for (let i = 0; i <= WEB_SPOKES; i++) {
        const a = v.spin * 0.1 + (i * Math.PI * 2) / WEB_SPOKES;
        const px = v.x + Math.cos(a) * rr;
        const py = v.y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else {
          // Each thread sags toward the centre halfway between two spokes.
          const m = a - Math.PI / WEB_SPOKES;
          g.lineTo(v.x + Math.cos(m) * rr * 0.86, v.y + Math.sin(m) * rr * 0.86);
          g.lineTo(px, py);
        }
      }
      g.strokePath();
    }
  }

  /** Ink blobs: a dark drop with a dull shine and two droplets trailing it, arcing up and landing in a tiny splat. */
  private drawBlobs(dt: number): void {
    const g = this.beamGfx;
    for (const b of this.blobs) {
      if (b.age >= b.dur) continue;
      b.age += dt;
      const k = Math.min(1, b.age / b.dur);
      const lift = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) * BLOB_ARC;
      const at = (t: number) => [b.x1 + (b.x2 - b.x1) * t, b.y1 + (b.y2 - b.y1) * t - Math.sin(t * Math.PI) * lift];
      if (k >= 1) {
        g.fillStyle(INK, 0.6);
        g.fillEllipse(b.x2, b.y2 + 2, 7, 3);
        continue;
      }
      for (const [lag, r] of [[0.16, 1], [0.08, 1.5]] as const) {
        const [tx, ty] = at(Math.max(0, k - lag));
        g.fillStyle(INK, 0.7);
        g.fillCircle(tx, ty, r);
      }
      const [x, y] = at(k);
      g.fillStyle(INK, 0.95);
      g.fillCircle(x, y, 2.5);
      g.fillStyle(INK_SHINE, 0.9);
      g.fillRect(Math.round(x - 1), Math.round(y - 2), 1, 1);
    }
  }

  /** Beams: a wide soft glow, a bright core and a white centre line, fading as they linger. */
  private drawBeams(dt: number): void {
    const g = this.beamGfx;
    g.clear();
    for (const b of this.beams) {
      if (b.age >= b.dur) continue;
      b.age += dt;
      if (b.age >= b.dur) continue;
      const k = b.age / b.dur;
      const a = k < 0.15 ? 1 : 1 - (k - 0.15) / 0.85;
      const flare = k < 0.15 ? 1 + (0.15 - k) * 4 : 1;
      g.lineStyle(b.width * 2.2 * flare, b.color, 0.18 * a);
      g.lineBetween(b.x1, b.y1, b.x2, b.y2);
      g.lineStyle(b.width * flare, b.color, 0.6 * a);
      g.lineBetween(b.x1, b.y1, b.x2, b.y2);
      g.lineStyle(Math.max(1, b.width * 0.3), 0xffffff, 0.9 * a);
      g.lineBetween(b.x1, b.y1, b.x2, b.y2);
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
