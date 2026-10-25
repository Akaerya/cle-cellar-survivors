import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { DEPTH } from '../constants';
import { ENEMY_MODIFIERS, MAX_SOUL_WISPS, RARE_TIERS, enemyModifier } from '../data';
import type { EnemyModifierDef } from '../data/types';
import type { Player } from '../entities/Player';

/** What RareVisuals needs to draw one rare enemy: the enemy itself on the host, its mirror sprite on joiners. */
export interface RareView {
  sprite: Phaser.GameObjects.Sprite;
  /** Collision radius in px: looks sit around the body. */
  radius: number;
  /** Bit i set: has ENEMY_MODIFIERS[i]. */
  mask: number;
  /** Enrage, 0..1. */
  enrage: number;
  souls: number;
}

/** The border: four copies of the sprite, one px out on each side, behind it. */
const OUTLINE = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
/** Tiers from the most modifiers down: an enemy wears the colour of the first tier it reaches. */
const TIERS = [...RARE_TIERS].sort((a, b) => b.modifiers - a.modifiers);
const ASTRAL = enemyModifier('astral_touched');

/**
 * Draws rare enemies the same way on the host and on joiners, from RareViews: a 1 px border in the colour of their
 * tier (how many modifiers they have) and, for the modifiers that have one, a look of their own. An enemy with
 * several of those shows them all. Also draws the Astral Chains on the local player. Purely visual: Math.random
 * and the clock are fine here.
 */
export class RareVisuals {
  /** Rings on the ground (auras) and things above the units (motes, spikes, wisps, bubbles). */
  private under: Phaser.GameObjects.Graphics;
  private over: Phaser.GameObjects.Graphics;
  private borders = new Map<Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite[]>();
  private spare: Phaser.GameObjects.Sprite[][] = [];
  private seen = new Set<Phaser.GameObjects.Sprite>();
  /** A random phase per sprite, so a pack of rare enemies does not move in lockstep. */
  private phase = new WeakMap<Phaser.GameObjects.Sprite, number>();
  private t = 0;

  constructor(private scene: Phaser.Scene) {
    this.under = scene.add.graphics().setDepth(DEPTH.aura);
    this.over = scene.add.graphics().setDepth(DEPTH.units + 1.5);
  }

  update(dt: number, views: readonly RareView[], local: Player): void {
    this.t += dt;
    this.under.clear();
    this.over.clear();
    this.seen.clear();
    for (const v of views) {
      if (!v.sprite.visible) continue;
      this.seen.add(v.sprite);
      this.border(v);
      for (let i = 0; i < ENEMY_MODIFIERS.length; i++) if (v.mask & (1 << i)) this.look(ENEMY_MODIFIERS[i], v);
    }
    for (const [s, set] of this.borders) {
      if (this.seen.has(s)) continue;
      for (const b of set) b.setVisible(false);
      this.borders.delete(s);
      this.spare.push(set);
    }
    this.chains(local);
  }

  private border(v: RareView): void {
    const s = v.sprite;
    let set = this.borders.get(s);
    if (!set) {
      set = this.spare.pop() ?? OUTLINE.map(() => this.scene.add.sprite(0, 0, ATLAS, 'px'));
      this.borders.set(s, set);
    }
    const color = tierColor(countBits(v.mask));
    for (let i = 0; i < OUTLINE.length; i++) {
      set[i]
        .setTexture(ATLAS, s.frame.name)
        .setPosition(s.x + OUTLINE[i][0], s.y + OUTLINE[i][1])
        .setFlipX(s.flipX)
        .setScale(s.scaleX, s.scaleY)
        .setDepth(s.depth - 1e-5)
        .setAlpha(s.alpha)
        .setTint(color)
        .setTintMode(Phaser.TintModes.FILL)
        .setVisible(true);
    }
  }

  private phaseOf(s: Phaser.GameObjects.Sprite): number {
    let p = this.phase.get(s);
    if (p === undefined) {
      p = Math.random() * Math.PI * 2;
      this.phase.set(s, p);
    }
    return p;
  }

  /** One modifier's look. Modifiers without a case have none (the border still shows the enemy is rare). */
  private look(m: EnemyModifierDef, v: RareView): void {
    const s = v.sprite;
    const x = s.x;
    const y = s.y;
    const r = v.radius;
    const a = s.alpha;
    const t = this.t;
    const ph = this.phaseOf(s);
    const u = this.under;
    const o = this.over;
    switch (m.id) {
      case 'astral_touched': {
        // Three void motes circling the body.
        for (let i = 0; i < 3; i++) {
          const ang = t * 2.4 + ph + (i * Math.PI * 2) / 3;
          const px = Math.round(x + Math.cos(ang) * (r + 5));
          const py = Math.round(y + Math.sin(ang) * (r + 5) * 0.6);
          o.fillStyle(m.color, 0.9 * a);
          o.fillRect(px - 1, py - 1, 3, 3);
          o.fillStyle(0xffffff, 0.8 * a);
          o.fillRect(px, py, 1, 1);
        }
        break;
      }
      case 'invulnerability': {
        // The reach of Intervention: a gold ring.
        u.fillStyle(m.color, 0.05);
        u.fillCircle(x, y, m.radius);
        u.lineStyle(1, m.color, 0.4 + 0.15 * Math.sin(t * 3 + ph));
        u.strokeCircle(x, y, m.radius);
        break;
      }
      case 'enrage': {
        if (v.enrage <= 0) break;
        // A red glow that grows with missing HP, and sparks rising off it.
        u.fillStyle(m.color, 0.12 + 0.35 * v.enrage);
        u.fillCircle(x, y + 2, r + 3 + 2 * v.enrage * Math.sin(t * 9 + ph));
        const n = 1 + Math.round(3 * v.enrage);
        for (let i = 0; i < n; i++) {
          const k = (t * 1.6 + ph + i / n) % 1;
          o.fillStyle(m.color, (1 - k) * a);
          o.fillRect(Math.round(x + (((i * 7) % 5) / 4 - 0.5) * r * 1.4), Math.round(y - r * 0.4 - k * 12), 1, 2);
        }
        break;
      }
      case 'caustic_ground': {
        // Acid dripping off it.
        for (let i = 0; i < 2; i++) {
          const k = (t * 1.1 + ph + i * 0.5) % 1;
          o.fillStyle(m.color, (1 - k) * 0.9 * a);
          o.fillRect(Math.round(x + (i ? 0.45 : -0.35) * r), Math.round(y + r * 0.3 + k * (r + 4)), 1, 2);
        }
        break;
      }
      case 'crystalline': {
        // Crystal shards slowly circling it.
        for (let i = 0; i < 3; i++) {
          const ang = -t * 1.2 + ph + (i * Math.PI * 2) / 3;
          const px = Math.round(x + Math.cos(ang) * (r + 6));
          const py = Math.round(y + Math.sin(ang) * (r + 6) * 0.6);
          o.fillStyle(m.color, 0.95 * a);
          o.fillRect(px, py - 2, 1, 5);
          o.fillRect(px - 1, py - 1, 3, 3);
          o.fillStyle(0xffffff, 0.9 * a);
          o.fillRect(px, py - 1, 1, 1);
        }
        break;
      }
      case 'empower_allies': {
        // The aura's reach, with a pulse rolling out to it.
        u.fillStyle(m.color, 0.04);
        u.fillCircle(x, y, m.radius);
        u.lineStyle(1, m.color, 0.35);
        u.strokeCircle(x, y, m.radius);
        const k = (t * 0.7 + ph) % 1;
        u.lineStyle(1, m.color, 0.4 * (1 - k));
        u.strokeCircle(x, y, r + (m.radius - r) * k);
        break;
      }
      case 'thorns': {
        // A ring of short spikes.
        o.lineStyle(1, m.color, 0.95 * a);
        for (let i = 0; i < 8; i++) {
          const ang = ph + t * 0.6 + (i * Math.PI) / 4;
          const c = Math.cos(ang);
          const sn = Math.sin(ang);
          o.lineBetween(x + c * (r + 1), y + sn * (r + 1), x + c * (r + 4), y + sn * (r + 4));
        }
        break;
      }
      case 'soul_absorption': {
        // A wisp per soul (one faint one before the first).
        const n = Math.min(MAX_SOUL_WISPS, Math.max(1, v.souls));
        for (let i = 0; i < n; i++) {
          const ang = -t * 1.8 + ph + (i * Math.PI * 2) / n;
          const px = x + Math.cos(ang) * (r + 8);
          const py = y - 2 + Math.sin(ang) * (r + 8) * 0.5;
          o.fillStyle(m.color, (v.souls > 0 ? 0.85 : 0.35) * a);
          o.fillCircle(px, py, 1.5);
          o.fillStyle(0xffffff, (v.souls > 0 ? 0.9 : 0.3) * a);
          o.fillRect(Math.round(px), Math.round(py), 1, 1);
        }
        break;
      }
      case 'spirit_walker': {
        // A faint dashed ring: anything that dies inside comes back once.
        u.lineStyle(1, m.color, 0.28);
        const dashes = 18;
        for (let i = 0; i < dashes; i++) {
          const a0 = ph + t * 0.25 + (i * Math.PI * 2) / dashes;
          u.beginPath();
          u.arc(x, y, m.radius, a0, a0 + Math.PI / dashes);
          u.strokePath();
        }
        break;
      }
      case 'temporal_shield': {
        // A bubble: hits from outside it do nothing.
        o.fillStyle(m.color, 0.07);
        o.fillCircle(x, y, m.radius);
        o.lineStyle(1, m.color, 0.45 + 0.2 * Math.sin(t * 4 + ph));
        o.strokeCircle(x, y, m.radius);
        o.lineStyle(1, 0xffffff, 0.35);
        o.beginPath();
        o.arc(x, y, m.radius - 3, Math.PI * 1.1, Math.PI * 1.45);
        o.strokePath();
        break;
      }
    }
  }

  /** The local player's Astral Chains: a violet ring at their feet with a link per stack. */
  private chains(p: Player): void {
    const n = p.chains.length;
    if (n === 0 || !p.visible) return;
    const x = p.x;
    const y = p.y + 8;
    this.under.lineStyle(1, ASTRAL.color, 0.6);
    this.under.strokeEllipse(x, y, 20, 7);
    for (let i = 0; i < n; i++) {
      const ang = this.t * 3 + (i * Math.PI * 2) / n;
      const px = Math.round(x + Math.cos(ang) * 10);
      const py = Math.round(y + Math.sin(ang) * 3.5);
      this.over.fillStyle(ASTRAL.color, 0.95);
      this.over.fillRect(px - 1, py - 1, 3, 2);
      this.over.fillStyle(0xffffff, 0.8);
      this.over.fillRect(px, py - 1, 1, 1);
    }
  }
}

function countBits(mask: number): number {
  let n = 0;
  for (let m = mask >>> 0; m !== 0; m &= m - 1) n++;
  return n;
}

function tierColor(modifiers: number): number {
  for (const t of TIERS) if (modifiers >= t.modifiers) return t.color;
  return TIERS[TIERS.length - 1].color;
}
