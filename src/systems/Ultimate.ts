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

/**
 * One player's ultimate (Q). The host (or solo game) casts it and fires its projectiles; joiners
 * get the timers from snapshots and only draw the visuals. The cooldown counts from the cast.
 */
export class Ultimate {
  /** Fires the projectiles and keeps the damage and kill count for the party screen. */
  readonly attack: WeaponInstance;
  /** Seconds until it can be cast again. */
  cooldownLeft = 0;
  /** Seconds the effect has left (0 when it is not running). */
  activeLeft = 0;
  private timer = 0;
  private spin = 0;
  private orbiters: Phaser.GameObjects.Sprite[] = [];
  private gfx: Phaser.GameObjects.Graphics;
  private pet: Phaser.GameObjects.Sprite | null = null;
  private petX = 0;
  private petY = 0;
  private bob = 0;

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
    this.activeLeft = this.def.duration;
    this.timer = 0;
    this.started();
    p.runStats.ultCasts++;
    this.game.fx.ring(p.x, p.y, COLOR.gold, 90, 600);
    this.game.playSfx('ultimate', p.x, p.y);
    this.game.banner(this.game.coop ? `${p.displayName}: ${this.def.name.toUpperCase()}!` : `${this.def.name.toUpperCase()}!`, COLOR.gold);
    return true;
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

  /** The effect just began (cast here, or seen in a snapshot on a joiner). */
  private started(): void {
    this.petX = this.owner.x;
    this.petY = this.owner.y - PET_ABOVE;
    this.spin = 0;
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
  }

  /** Player left: removes the visuals for good. */
  destroy(): void {
    this.stop();
    for (const s of this.orbiters) s.destroy();
    this.orbiters.length = 0;
    this.pet?.destroy();
    this.pet = null;
    this.gfx.destroy();
  }
}
