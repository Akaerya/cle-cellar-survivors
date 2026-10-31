import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { ARENA_SIZE, DEPTH, INNER } from '../constants';
import type { PassiveDef, UltimateDef, WeaponDef } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { nextNetId } from '../net/ids';
import type { GameScene } from '../scenes/GameScene';
import type { SummonView, WeaponInstance } from './Weapons';

type PetsPassive = Extract<PassiveDef, { kind: 'pets' }>;

/**
 * Pets wait in a ring around their owner this many px out (plus a little per pet, and their own size), squashed to
 * HOME_FLAT of that up and down, and count as there this close.
 */
const HOME_RADIUS = 26;
const HOME_SPREAD = 2;
const HOME_FLAT = 0.7;
const HOME_CLOSE = 4;
/** Radians per second the ring of waiting spots turns. */
const HOME_TURN = 0.4;
/** Seconds between a pet's looks for a better target. */
const RETARGET = 0.5;
/** When picking targets, an enemy counts this many px further away for every other pet already after it (spreads them out). */
const CROWD_PENALTY = 40;
/** Ranged gear: the pet stops this share of the gear's RANGE from its target. */
const RANGED_STANDOFF = 0.6;
/** px a pet bobs while it hops, and hops per second at full speed. */
const HOP_HEIGHT = 2;
const HOP_RATE = 7;
/** Seconds the cut line of a pet's sword lasts. */
const CUT_SECONDS = 0.12;
/** Pets beyond this many times their leash from the owner jump back to them. */
const LOST_LEASHES = 3;

/** One pet: a bunny of the Warren, or the Giant Bunny while the ultimate runs. */
interface Pet {
  netId: number;
  x: number;
  y: number;
  giant: boolean;
  /** Index into the armory's gear (-1: no gear), and seconds until it swaps. */
  gear: number;
  swapLeft: number;
  /** Seconds until its next attack, and (giant) its next stomp. */
  attackLeft: number;
  stompLeft: number;
  target: Enemy | null;
  targetId: number;
  retarget: number;
  /** Spot in the waiting ring (radians), and the hop animation phase. */
  home: number;
  hop: number;
  flip: boolean;
  moving: boolean;
  sprite: Phaser.GameObjects.Sprite;
}

/**
 * One character's pets (the Warren passive, data/passives.ts kind 'pets'), plus the Giant Bunny while that ultimate
 * runs. The host (or solo game) runs them: each pet waits around its owner, goes after enemies within `aggro` px of
 * the owner (spreading out over several), and attacks the one it reaches with its gear's attack (Bunny Armory) or,
 * without gear, its own headbutt. `petbuff` weapons (Carrot Rations) add damage, attack speed and move speed. The
 * giant gets all of that, `power` times the damage, and stomps around the enemy it reaches. Joiners draw pets from the
 * snapshot's summon layer.
 */
export class Pets {
  private readonly def: PetsPassive | null;
  private readonly giantDef: UltimateDef | null;
  private readonly pets: Pet[] = [];
  /** The headbutt, and the armory's gear, as weapon instances (damage and kills for the party screen). */
  readonly headbutt: WeaponInstance | null;
  private readonly gear = new Map<WeaponDef, WeaponInstance>();
  private turn = 0;
  /** For target picking: how many pets are after each enemy this frame. */
  private readonly chasing = new Map<Enemy, number>();

  constructor(
    private game: GameScene,
    readonly owner: Player,
  ) {
    const d = owner.passive.def;
    this.def = d?.kind === 'pets' ? d : null;
    this.headbutt = this.def ? owner.weapons.instance(this.def.attack) : null;
    this.giantDef = owner.ultimate.def.kind === 'giant' ? owner.ultimate.def : null;
  }

  /** Gear weapon instances made so far (for the party screen). */
  gearInstances(): WeaponInstance[] {
    return [...this.gear.values()];
  }

  /** How many bunnies the Warren has now (the passive's stacks). */
  get count(): number {
    return this.pets.filter((p) => !p.giant).length;
  }

  /** Host: brings the pack in line with the passive and ultimate, then moves and attacks. `firing`: the run is playing. */
  update(dt: number, firing: boolean): void {
    const o = this.owner;
    if (!this.def || !o.alive) return;
    const want = o.passive.stacks;
    let small = this.count;
    while (small < want) {
      this.spawn(false);
      small++;
    }
    for (let i = this.pets.length - 1; i >= 0 && small > want; i--) {
      if (this.pets[i].giant) continue;
      this.remove(i);
      small--;
    }
    const giantWanted = !!this.giantDef && o.ultimate.active;
    const giantAt = this.pets.findIndex((p) => p.giant);
    if (giantWanted && giantAt < 0) this.spawn(true);
    else if (!giantWanted && giantAt >= 0) this.remove(giantAt);

    this.turn = (this.turn + HOME_TURN * dt) % (Math.PI * 2);
    this.chasing.clear();
    for (const p of this.pets) if (p.target) this.chasing.set(p.target, (this.chasing.get(p.target) ?? 0) + 1);
    const armory = o.weapons.armory();
    const bonus = o.weapons.petBonus();
    const locked = o.misted;
    this.pets.forEach((p, i) => this.updatePet(p, i, dt, firing && !locked, armory, bonus));
  }

  private spawn(giant: boolean): void {
    const o = this.owner;
    const def = this.def!;
    const sprite = this.game.add.sprite(o.x, o.y, ATLAS, 'px').play(def.anim);
    const home = this.game.rng.angle();
    const pet: Pet = {
      netId: nextNetId(),
      x: o.x,
      y: o.y + 2,
      giant,
      gear: -1,
      swapLeft: 0,
      attackLeft: 0.3,
      stompLeft: 0.3,
      target: null,
      targetId: 0,
      retarget: 0,
      home,
      hop: this.game.rng.float(),
      flip: false,
      moving: false,
      sprite,
    };
    if (giant) {
      sprite.setScale(this.giantDef?.scale ?? 1);
      this.game.fx.ring(o.x, o.y, 0xffffff, 40, 500);
      this.game.fx.puff(o.x, o.y, 0xffffff, 16);
    } else {
      this.game.fx.puff(o.x, o.y, 0xffffff, 6);
    }
    this.pets.push(pet);
  }

  private remove(i: number): void {
    const p = this.pets[i];
    this.game.fx.puff(p.x, p.y, 0xffffff, p.giant ? 14 : 5);
    p.sprite.destroy();
    this.pets.splice(i, 1);
  }

  private updatePet(p: Pet, index: number, dt: number, firing: boolean, armory: WeaponInstance | null, bonus: { damage: number; haste: number; speed: number }): void {
    const o = this.owner;
    const def = this.def!;
    const g = this.giantDef;
    // Gear: a random piece from the armory, swapped every armory cooldown.
    const gearList = armory?.def.gear ?? [];
    if (!armory || gearList.length === 0) p.gear = -1;
    else {
      p.swapLeft -= dt;
      if (p.gear < 0 || p.swapLeft <= 0) {
        const before = p.gear;
        p.gear = gearList.length > 1 && before >= 0 ? (before + this.game.rng.int(1, gearList.length - 1)) % gearList.length : this.game.rng.int(0, gearList.length - 1);
        p.swapLeft = o.weapons.eff(armory).cooldown;
        if (before >= 0) this.game.fx.sparkle(p.x, p.y - 6, armory.def.color ?? 0xffffff);
      }
    }
    const gearDef = p.gear >= 0 ? gearList[p.gear] : null;
    const gearInst = gearDef ? this.gearFor(gearDef, armory!.level) : null;
    const ranged = gearDef?.targeting === 'nearest';
    const power = p.giant ? (g?.power ?? 1) : 1;
    const boost = (1 + bonus.damage) * power;
    const scale = p.giant ? (g?.scale ?? 1) : 1;
    const bodyR = 4 * scale;

    // Target: keep a living one that is still near the owner, else pick the closest (crowded ones count as further).
    p.retarget -= dt;
    if (p.target && (!p.target.active || p.target.netId !== p.targetId || this.dist(p.target, o) > def.leash)) p.target = null;
    if (!p.target || p.retarget <= 0) {
      p.retarget = RETARGET;
      const t = firing ? this.pick(p, def.aggro) : null;
      if (t !== p.target) {
        if (p.target) this.chasing.set(p.target, (this.chasing.get(p.target) ?? 1) - 1);
        if (t) this.chasing.set(t, (this.chasing.get(t) ?? 0) + 1);
      }
      p.target = t;
      p.targetId = t?.netId ?? 0;
    }

    // Where to go: next to the target (or at a distance for ranged gear), else the waiting spot by the owner.
    let tx: number;
    let ty: number;
    let stop: number;
    const t = p.target;
    if (t) {
      tx = t.x;
      ty = t.y;
      stop = ranged ? gearInst!.stats.range * RANGED_STANDOFF : t.radius + bodyR;
    } else {
      const a = this.turn + p.home;
      const r = HOME_RADIUS + index * HOME_SPREAD + bodyR;
      tx = o.x + Math.cos(a) * r;
      ty = o.y + 4 + Math.sin(a) * r * HOME_FLAT;
      stop = HOME_CLOSE;
    }
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    const speed = def.speed * (1 + bonus.speed) * (p.giant ? (g?.speedMult ?? 1) : 1);
    if (this.dist(p, o) > def.leash * LOST_LEASHES) {
      p.x = o.x;
      p.y = o.y + 2;
      p.moving = false;
    } else if (d > stop) {
      // Waiting pets that fell behind run to catch up.
      const run = !t && d > def.leash ? 1.6 : 1;
      const step = Math.min(d - stop, speed * run * dt);
      p.x = Phaser.Math.Clamp(p.x + (dx / d) * step, INNER.left, INNER.right);
      p.y = Phaser.Math.Clamp(p.y + (dy / d) * step, INNER.top, INNER.bottom);
      p.moving = true;
      if (Math.abs(dx) > 0.5) p.flip = dx < 0;
    } else {
      p.moving = false;
      if (t && Math.abs(dx) > 0.5) p.flip = dx < 0;
    }

    // Attacks.
    const haste = 1 + bonus.haste;
    p.attackLeft -= dt;
    p.stompLeft -= dt;
    if (firing && t) {
      const reach = Math.hypot(t.x - p.x, t.y - p.y);
      if (p.giant && p.stompLeft <= 0 && reach <= t.radius + bodyR + 2) {
        const atk = o.ultimate.attack;
        p.stompLeft = o.weapons.eff(atk).cooldown / haste;
        this.stomp(atk, t, boost);
      }
      const atk = gearInst ?? this.headbutt!;
      if (p.attackLeft <= 0) {
        const e = o.weapons.eff(atk);
        const inReach = ranged ? reach <= e.range : reach <= t.radius + bodyR + e.size;
        if (inReach) {
          p.attackLeft = e.cooldown / haste;
          this.attack(p, atk, t, boost);
        }
      }
    }

    // Draw: hop while moving, face the way it goes, the gear's look.
    const anim = gearDef?.petAnim ?? def.anim;
    if (p.sprite.anims.currentAnim?.key !== anim) p.sprite.play(anim, true);
    if (p.moving) p.hop = (p.hop + dt * HOP_RATE) % 1;
    else p.hop = 0;
    const lift = Math.abs(Math.sin(p.hop * Math.PI)) * HOP_HEIGHT * scale;
    p.sprite
      .setVisible(true)
      .setFlipX(p.flip)
      .setPosition(Math.round(p.x), Math.round(p.y - lift))
      .setDepth(DEPTH.units + p.y / ARENA_SIZE);
  }

  /** The closest enemy to `p` within `aggro` px of the owner; enemies other pets are after count as further away. */
  private pick(p: Pet, aggro: number): Enemy | null {
    const o = this.owner;
    const near: Enemy[] = [];
    this.game.enemies.grid.query(o.x, o.y, aggro, near);
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const en of near) {
      if (!en.active || this.dist(en, o) > aggro) continue;
      const crowd = (this.chasing.get(en) ?? 0) - (en === p.target ? 1 : 0);
      const d = this.dist(en, p) + Math.max(0, crowd) * CROWD_PENALTY;
      if (d < bestD) {
        bestD = d;
        best = en;
      }
    }
    return best;
  }

  /** One attack of a pet on `t`: a projectile for ranged gear, a cut or headbutt up close. */
  private attack(p: Pet, w: WeaponInstance, t: Enemy, boost: number): void {
    const ws = this.owner.weapons;
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const color = w.def.color ?? 0xffffff;
    if (w.def.targeting === 'nearest') {
      const n = Math.max(1, Math.round(ws.eff(w).projectileCount));
      for (let i = 0; i < n; i++) ws.shoot(w, p.x, p.y - 3, Math.atan2(dy, dx), boost);
      this.game.playSfx(w.def.projectileAnim === 'spell-pulse' ? 'zap' : 'throw', p.x, p.y);
      return;
    }
    ws.startAttack(w);
    ws.petHit(w, t, boost, dx / d, dy / d);
    if (w === this.headbutt) {
      this.game.fx.puff(t.x, t.y, color, 3);
      this.game.playSfx('hit', t.x, t.y);
    } else {
      // A short cut across the enemy.
      const nx = -dy / d;
      const ny = dx / d;
      const half = t.radius + 3;
      this.game.fx.beam(t.x - nx * half, t.y - ny * half, t.x + nx * half, t.y + ny * half, 2, CUT_SECONDS, color);
      this.game.playSfx('stab', t.x, t.y);
    }
  }

  /** Giant Bunny: every enemy within the stomp's AREA of `t` is hit (one attack). */
  private stomp(w: WeaponInstance, t: Enemy, boost: number): void {
    const ws = this.owner.weapons;
    const e = ws.eff(w);
    const x = t.x;
    const y = t.y;
    const near: Enemy[] = [];
    this.game.enemies.grid.query(x, y, e.size + 16, near);
    ws.startAttack(w);
    for (const en of near) {
      if (!en.active) continue;
      const dx = en.x - x;
      const dy = en.y - y;
      const d = Math.hypot(dx, dy);
      if (d > e.size + en.radius) continue;
      ws.petHit(w, en, boost, dx / (d || 1), dy / (d || 1));
    }
    this.game.fx.ring(x, y, w.def.color ?? 0xffffff, e.size, 300);
    this.game.fx.puff(x, y, 0xd8c8a8, 8);
    this.game.playSfx('boom', x, y);
  }

  /** The instance for one piece of gear, kept at the armory's level. */
  private gearFor(def: WeaponDef, level: number): WeaponInstance {
    let w = this.gear.get(def);
    if (!w) {
      w = this.owner.weapons.instance(def);
      this.gear.set(def, w);
    }
    if (w.level !== level) this.owner.weapons.setLevel(w, level);
    return w;
  }

  private dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Host: the pets to draw on joiners' screens. */
  summonViews(out: SummonView[]): void {
    for (const p of this.pets) {
      out.push({ id: p.netId, anim: p.sprite.anims.currentAnim?.key ?? this.def!.anim, x: p.sprite.x, y: p.sprite.y, angle: 0, flip: p.flip, giant: p.giant });
    }
  }

  /** Removes every pet (owner fell, run over, player left). They come back as the passive says once the owner is up. */
  clear(): void {
    for (const p of this.pets) p.sprite.destroy();
    this.pets.length = 0;
  }
}
