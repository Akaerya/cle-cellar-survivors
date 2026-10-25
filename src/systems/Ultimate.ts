import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { ARENA_SIZE, COLOR, DEPTH } from '../constants';
import type { UltimateDef } from '../data/types';
import type { Player } from '../entities/Player';
import type { GameScene } from '../scenes/GameScene';
import type { WeaponInstance } from './Weapons';

const DEG = Math.PI / 180;
/** Banana Storm: bananas drawn whirling around the caster while it lasts. */
const STORM_ORBITERS = 6;
const STORM_RADIUS = 26;
/** Pet: where it hovers relative to its owner (behind and above), and how quickly it catches up. */
const PET_BEHIND = 16;
const PET_ABOVE = 18;
const PET_EASE = 6;
/** Dome: seconds it takes to grow to full size, and to fade out at the end. */
const DOME_GROW = 0.3;
const DOME_FADE = 0.4;
/** Dome: beams start and end this far inside the edge (so they read as crossing the dome). */
const BEAM_EDGE = 2;

/**
 * One player's ultimate (Q). The host (or solo game) casts it and fires its projectiles; joiners
 * get the timers from snapshots and only draw the visuals. The cooldown counts from the cast.
 * Kinds: `storm` spirals projectiles out of the caster, `pet` summons a pet that shoots, and `dome` raises a dome
 * where it was cast that fires beams across itself and bounces the caster's projectiles off its edge.
 */
export class Ultimate {
  /** Fires the projectiles and keeps the damage and kill count for the party screen. */
  readonly attack: WeaponInstance;
  /** Seconds until it can be cast again. */
  cooldownLeft = 0;
  /** Seconds the effect has left (0 when it is not running). */
  activeLeft = 0;
  /** Seconds of crit refund the cooldown can still take before the next cast (see `refundFloor`). */
  refundable = 0;
  private timer = 0;
  private spin = 0;
  private orbiters: Phaser.GameObjects.Sprite[] = [];
  private gfx: Phaser.GameObjects.Graphics;
  private pet: Phaser.GameObjects.Sprite | null = null;
  private petX = 0;
  private petY = 0;
  private bob = 0;
  /** Dome: where it was cast, and its facet lines (x1, y1, x2, y2 in units of the radius; visual only). */
  private domeX = 0;
  private domeY = 0;
  private facets: number[] = [];
  private domeGfx: Phaser.GameObjects.Graphics | null = null;

  constructor(
    private game: GameScene,
    readonly owner: Player,
    readonly def: UltimateDef,
  ) {
    this.attack = owner.weapons.instance(def.attack);
    this.gfx = game.add.graphics().setDepth(DEPTH.aura);
  }

  get active(): boolean {
    return this.activeLeft > 0;
  }

  get ready(): boolean {
    return this.cooldownLeft <= 0;
  }

  /** Host and solo: starts the effect if it is off cooldown. */
  cast(): boolean {
    const p = this.owner;
    if (!this.ready || !p.alive) return false;
    this.cooldownLeft = this.def.cooldown;
    this.refundable = p.weapons.refundShare() * this.def.cooldown;
    this.activeLeft = this.def.duration;
    this.timer = 0;
    this.started();
    if (this.def.kind === 'dome') this.game.relay(['d', p.slot, Math.round(this.domeX), Math.round(this.domeY)]);
    p.runStats.ultCasts++;
    this.game.fx.ring(p.x, p.y, COLOR.gold, 90, 600);
    this.game.playSfx('ultimate', p.x, p.y);
    this.game.banner(this.game.coop ? `${p.displayName}: ${this.def.name.toUpperCase()}!` : `${this.def.name.toUpperCase()}!`, COLOR.gold);
    return true;
  }

  /** The dome while it is up (dome ultimates): centre and radius. Projectiles of the caster ricochet off its edge. */
  dome(): { x: number; y: number; r: number } | null {
    if (this.def.kind !== 'dome' || !this.active || !this.owner.alive) return null;
    return { x: this.domeX, y: this.domeY, r: this.def.radius ?? 0 };
  }

  /** Joiners: the host says where the dome was cast. */
  setDome(x: number, y: number): void {
    this.domeX = x;
    this.domeY = y;
  }

  /** Counts the timers down; `firing` (host, owner alive, run playing) also shoots. */
  update(dt: number, firing: boolean): void {
    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    if (this.activeLeft > 0) {
      this.activeLeft = Math.max(0, this.activeLeft - dt);
      if (this.activeLeft === 0) this.ended();
    }
    this.draw(dt);
    if (firing && this.active && this.owner.alive) this.fire(dt);
  }

  private fire(dt: number): void {
    const p = this.owner;
    this.timer -= dt;
    while (this.timer <= 0) {
      this.timer += this.def.interval;
      if (this.def.kind === 'storm') {
        const n = Math.max(1, this.def.count);
        for (let i = 0; i < n; i++) p.weapons.shoot(this.attack, p.x, p.y - 2, this.spin + (i * Math.PI * 2) / n);
        this.spin += (this.def.spin ?? 0) * DEG * this.def.interval;
        this.game.playSfx('throw', p.x, p.y);
      } else if (this.def.kind === 'dome') {
        // Beams across the dome in random straight lines: from one point on the edge to another at least 90 degrees round.
        const rng = this.game.rng;
        const r = (this.def.radius ?? 0) - BEAM_EDGE;
        for (let i = 0; i < Math.max(1, this.def.count); i++) {
          const a = rng.angle();
          const b = a + Math.PI + rng.range(-Math.PI / 2, Math.PI / 2);
          p.weapons.beam(
            this.attack,
            this.domeX + Math.cos(a) * r,
            this.domeY + Math.sin(a) * r,
            this.domeX + Math.cos(b) * r,
            this.domeY + Math.sin(b) * r,
          );
        }
      } else {
        const target = this.game.enemies.nearest(this.petX, this.petY, this.attack.stats.range);
        if (!target) continue;
        const angle = Math.atan2(target.y - this.petY, target.x - this.petX);
        for (let i = 0; i < Math.max(1, this.def.count); i++) p.weapons.shoot(this.attack, this.petX, this.petY, angle);
        this.game.playSfx('zap', this.petX, this.petY);
      }
    }
  }

  private draw(dt: number): void {
    const p = this.owner;
    const show = this.active && p.alive;
    this.gfx.clear();
    if (this.def.kind === 'dome') {
      this.drawDome(show);
      return;
    }
    if (this.def.kind === 'storm') {
      while (this.orbiters.length < STORM_ORBITERS) {
        this.orbiters.push(this.game.add.sprite(p.x, p.y, ATLAS, 'banana_0').play('banana-spin').setDepth(DEPTH.projectiles).setVisible(false));
      }
      this.bob += dt;
      for (let i = 0; i < this.orbiters.length; i++) {
        const s = this.orbiters[i];
        s.setVisible(show);
        if (!show) continue;
        const a = this.bob * 4 + (i * Math.PI * 2) / STORM_ORBITERS;
        const r = STORM_RADIUS + Math.sin(this.bob * 6 + i) * 4;
        s.setPosition(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.8);
      }
      if (show) {
        this.gfx.lineStyle(1, COLOR.gold, 0.35);
        this.gfx.strokeCircle(p.x, p.y, STORM_RADIUS + 6);
        this.gfx.fillStyle(COLOR.gold, 0.05);
        this.gfx.fillCircle(p.x, p.y, STORM_RADIUS + 6);
      }
      return;
    }
    // Pet: follows its owner from behind, bobbing, and faces the way the owner faces.
    if (!this.pet) this.pet = this.game.add.sprite(p.x, p.y, ATLAS, 'drake_0').play('drake-fly').setVisible(false);
    this.pet.setVisible(show);
    if (!show) return;
    this.bob += dt;
    const side = p.facing.x < 0 ? 1 : -1;
    const tx = p.x + side * PET_BEHIND;
    const ty = p.y - PET_ABOVE;
    const k = 1 - Math.exp(-dt * PET_EASE);
    this.petX += (tx - this.petX) * k;
    this.petY += (ty - this.petY) * k;
    this.pet
      .setPosition(Math.round(this.petX), Math.round(this.petY + Math.sin(this.bob * 5) * 2))
      .setFlipX(side > 0)
      .setDepth(DEPTH.units + (this.petY + PET_ABOVE) / ARENA_SIZE + 0.001);
  }

  /**
   * A light pink dome, see-through so everything inside stays readable: a faint fill that thickens toward the rim,
   * faint crystal facets that shimmer, a soft rim and a highlight.
   */
  private drawDome(show: boolean): void {
    if (!this.domeGfx) this.domeGfx = this.game.add.graphics().setDepth(DEPTH.dome);
    const g = this.domeGfx;
    g.clear();
    if (!show) return;
    const age = this.def.duration - this.activeLeft;
    const grow = Math.min(1, age / DOME_GROW);
    const a = Math.min(1, this.activeLeft / DOME_FADE);
    const R = (this.def.radius ?? 0) * (0.2 + 0.8 * (1 - (1 - grow) * (1 - grow)));
    const x = this.domeX;
    const y = this.domeY;
    const color = this.def.color ?? 0xffb8e6;
    const shimmer = 0.5 + 0.5 * Math.sin(age * 2.4);
    g.fillStyle(color, 0.06 * a);
    g.fillCircle(x, y, R);
    g.lineStyle(R * 0.16, color, 0.07 * a);
    g.strokeCircle(x, y, R * 0.92);
    g.lineStyle(1, 0xffffff, (0.07 + 0.06 * shimmer) * a);
    for (let i = 0; i < this.facets.length; i += 4) {
      g.lineBetween(x + this.facets[i] * R, y + this.facets[i + 1] * R, x + this.facets[i + 2] * R, y + this.facets[i + 3] * R);
    }
    g.lineStyle(2, color, 0.5 * a);
    g.strokeCircle(x, y, R);
    g.lineStyle(1, 0xffffff, (0.25 + 0.15 * shimmer) * a);
    g.strokeCircle(x, y, R - 2);
    g.lineStyle(2, 0xffffff, 0.22 * a);
    g.beginPath();
    g.arc(x, y, R * 0.8, Math.PI * 1.1, Math.PI * 1.38);
    g.strokePath();
  }

  /** Dome facets: points on the rim and inside, each inner point joined to its nearest neighbours (visual only). */
  private buildFacets(): void {
    const pts: [number, number][] = [];
    const rim = 12;
    for (let i = 0; i < rim; i++) {
      const a = ((i + (Math.random() - 0.5) * 0.5) * Math.PI * 2) / rim;
      pts.push([Math.cos(a), Math.sin(a)]);
    }
    const inner: [number, number][] = [];
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.7;
      inner.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    pts.push(...inner);
    const seen = new Set<string>();
    this.facets = [];
    inner.forEach((p, i) => {
      const me = rim + i;
      const near = pts
        .map((q, j) => ({ j, d: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 }))
        .filter((o) => o.j !== me)
        .sort((m, n) => m.d - n.d)
        .slice(0, 3);
      for (const o of near) {
        const key = me < o.j ? `${me}-${o.j}` : `${o.j}-${me}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.facets.push(p[0], p[1], pts[o.j][0], pts[o.j][1]);
      }
    });
  }

  /** The effect just began (cast here, or seen in a snapshot on a joiner). */
  private started(): void {
    this.petX = this.owner.x;
    this.petY = this.owner.y - PET_ABOVE;
    this.spin = 0;
    if (this.def.kind === 'dome') {
      this.domeX = this.owner.x;
      this.domeY = this.owner.y;
      this.buildFacets();
    }
  }

  private ended(): void {
    if (this.pet?.visible) this.game.fx.sparkle(this.pet.x, this.pet.y, 0x5ab0ff);
  }

  /** Joiners: timers from the host. */
  sync(cooldownLeft: number, activeLeft: number): void {
    if (activeLeft > 0 && !this.active) this.started();
    this.cooldownLeft = cooldownLeft;
    this.activeLeft = activeLeft;
  }

  /** Ends the effect early (owner fell, run over). The cooldown keeps counting. */
  stop(): void {
    this.activeLeft = 0;
    for (const s of this.orbiters) s.setVisible(false);
    this.pet?.setVisible(false);
    this.gfx.clear();
    this.domeGfx?.clear();
  }

  /** Player left: removes the visuals for good. */
  destroy(): void {
    this.stop();
    for (const s of this.orbiters) s.destroy();
    this.orbiters.length = 0;
    this.pet?.destroy();
    this.pet = null;
    this.gfx.destroy();
    this.domeGfx?.destroy();
    this.domeGfx = null;
  }
}
