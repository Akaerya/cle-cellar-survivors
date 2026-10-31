import { COLOR } from '../constants';
import type { OwnedItem } from '../core/progression';
import { REVIVE } from '../data/coop';
import type { ItemDef, PassiveDef } from '../data/types';
import type { Player } from '../entities/Player';
import type { GameScene } from '../scenes/GameScene';
import type { WeaponInstance } from './Weapons';

/** Colours of the passives' effects: dodges, Death Defied, Dragonborn stacks. */
const DODGE_COLOR = 0xc8b8ff;
const DEFY_COLOR = 0xffb8e6;
const GROWTH_COLOR = 0x5ab0ff;
const PETS_COLOR = 0x8fc8ff;

/**
 * One character's passive (data/passives.ts). The host (or solo game) runs it: Shroud dodges hits, Ragebaiter stands
 * the character back up, Dragonborn adds a stack of stats every minute, Death Defied turns a hit that would leave
 * the character low into healing, Warren counts the character's bunnies (its stacks; systems/Pets.ts runs them) and
 * Plunder hands the character's Weapons the ailment every hit puts on enemies.
 * Joiners get the cooldown and stacks from snapshots, for the HUD.
 */
export class Passive {
  /** Seconds until it can trigger again (Ragebaiter, Death Defied). */
  cooldownLeft = 0;
  /** Dragonborn stacks. */
  stacks = 0;
  /** Death Defied: seconds of healing left, and HP healed per second meanwhile. */
  private mendLeft = 0;
  private mendRate = 0;
  /** Dragonborn: one stack's stat changes as an item, so they add up with items and powerups (see computeStats). */
  private readonly growthItem: ItemDef | null;
  /** Plunder: the ailment's weapon instance, which owns its stacks (the owner's Weapons puts them on every hit). */
  readonly ailment: WeaponInstance | null;

  constructor(
    private game: GameScene,
    readonly owner: Player,
    readonly def: PassiveDef | null,
  ) {
    this.growthItem =
      def?.kind === 'growth' ? { id: def.id, name: def.name, description: def.description, icon: def.icon, perLevel: def.perStack, levelText: '' } : null;
    this.ailment = def?.kind === 'ailment' ? owner.weapons.instance(def.attack) : null;
    owner.weapons.ailment = this.ailment;
  }

  get ready(): boolean {
    return this.cooldownLeft <= 0;
  }

  /** Host: the cooldown, healing over time, and Dragonborn stacks from the run clock. */
  update(dt: number, runTime: number): void {
    const p = this.owner;
    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    if (this.mendLeft > 0) {
      const t = Math.min(dt, this.mendLeft);
      this.mendLeft -= t;
      if (p.alive) p.heal(this.mendRate * t);
    }
    const d = this.def;
    if (d?.kind === 'pets') {
      // Warren: the bunnies the owner has by now (systems/Pets.ts brings the pack in line).
      const n = Math.min(d.max, d.start + Math.floor(runTime / d.every));
      if (n !== this.stacks) {
        if (this.stacks > 0 && p.alive) this.game.fx.label(p.x, p.y - 16, `${d.name} ${n}`, PETS_COLOR);
        this.stacks = n;
      }
    }
    if (d?.kind === 'growth') {
      const n = Math.floor(runTime / d.every);
      if (n !== this.stacks) {
        this.stacks = n;
        p.recomputeStats();
        if (p === this.game.player) this.game.onPlayerHealed(p);
        if (p.alive && n > 0) {
          this.game.fx.ring(p.x, p.y, GROWTH_COLOR, 40, 500);
          this.game.fx.label(p.x, p.y - 16, `${d.name} ${n}`, GROWTH_COLOR);
        }
      }
    }
  }

  /** Stats the passive adds on top of items and powerups (Dragonborn stacks). */
  statSources(): OwnedItem[] {
    return this.growthItem && this.stacks > 0 ? [{ def: this.growthItem, level: this.stacks }] : [];
  }

  /** Shroud: true when the hit is dodged. */
  dodge(): boolean {
    const d = this.def;
    if (d?.kind !== 'dodge' || this.game.rng.float() >= d.chance) return false;
    const p = this.owner;
    this.game.fx.label(p.x, p.y - 12, 'DODGE', DODGE_COLOR);
    return true;
  }

  /**
   * Death Defied: `dmg` is about to be taken. True when it would leave the owner below the threshold and the passive
   * is ready: the damage is not taken, and healing over time starts instead.
   */
  defy(dmg: number): boolean {
    const d = this.def;
    const p = this.owner;
    if (d?.kind !== 'reprieve' || !this.ready || p.god || p.hp - dmg >= d.below * p.stats.maxHp) return false;
    this.cooldownLeft = d.cooldown;
    this.mendLeft = d.over;
    this.mendRate = (d.heal * p.stats.maxHp) / d.over;
    const fx = this.game.fx;
    fx.ring(p.x, p.y, DEFY_COLOR, 50, 600);
    fx.label(p.x, p.y - 16, d.name, DEFY_COLOR);
    this.game.playSfx('revive', p.x, p.y);
    return true;
  }

  /**
   * Ragebaiter: the owner just reached 0 HP. True when it stands right back up, invulnerable as after a co-op revive;
   * a banner tells everyone to put a random other player in the bin (`fallback` when nobody else is in the run).
   */
  rebirth(): boolean {
    const d = this.def;
    const p = this.owner;
    if (d?.kind !== 'rebirth' || !this.ready) return false;
    this.cooldownLeft = d.cooldown;
    p.hp = Math.max(1, Math.round(p.stats.maxHp * d.hp));
    // Standing back up is a revive: the same invulnerability as a co-op revive.
    p.grantInvuln(REVIVE.invulnSeconds);
    const others = this.game.players.filter((q) => q && q !== p && !q.gone);
    const name = others.length > 0 ? this.game.rng.pick(others).displayName : d.fallback;
    this.game.banner(`PUT ${name.toUpperCase()} IN THE BIN!`, COLOR.gold);
    this.game.fx.ring(p.x, p.y, COLOR.gold, 60, 500);
    this.game.fx.puff(p.x, p.y, 0xf7d84a, 14);
    this.game.playSfx('revive', p.x, p.y);
    return true;
  }

  /** Joiners: the host's numbers. */
  sync(cooldownLeft: number, stacks: number): void {
    this.cooldownLeft = cooldownLeft;
    this.stacks = stacks;
  }

  /** Healing over time stops (fallen, run over). */
  stop(): void {
    this.mendLeft = 0;
  }
}
