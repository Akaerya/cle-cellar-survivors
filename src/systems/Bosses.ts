import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, DEPTH, INNER, RUN_SECONDS } from '../constants';
import { BOSSES, BOSS_TIMES, HAZARDS, enemyDef, hazardDef, hpScaleForMinute, hpScaleForPlayers } from '../data';
import { PLAYER_RADIUS } from '../data/player';
import type { BossSkill, ChainsDef, EnemyDef, HazardDef } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { nextNetId } from '../net/ids';
import type { GameScene } from '../scenes/GameScene';

/** A boss HP bar for the HUD: which boss (by net id), its kind and HP left (0..1). Host and joiners. */
export interface BossBar {
  id: number;
  def: EnemyDef;
  frac: number;
}

/** Red telegraph colour for charges and wind-ups. */
const WARN_COLOR = 0xff5a66;
/** A returning club is caught this close to its thrower. */
const CATCH_RADIUS = 14;
/** Seconds a returning club takes to get back up to full speed. */
const RETURN_ACCEL = 0.6;
/** Pollen and whirlpools stay this far inside the arena wall. */
const WALL_MARGIN = 24;

/** Something a boss left in the world (host only; joiners draw them from snapshots). */
export interface Hazard {
  def: HazardDef;
  /** Index into HAZARDS (the kind sent to joiners). */
  kind: number;
  netId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  damage: number;
  /**
   * Seconds between damage-over-time ticks to every player inside (caustic ground: they ignore invulnerability), and
   * seconds to the next one. 0: it hurts on touch every frame instead (once per invulnerability).
   */
  interval: number;
  tick: number;
  /** px/s it drifts toward the closest living player (pollen). */
  follow: number;
  /** Vanishes when it hits a player (petals). */
  consume: boolean;
  /** Boomerang: flies out for `outTime`, slowing down, then back to the thrower. */
  back: { owner: Enemy; ownerId: number; outTime: number; speed: number } | null;
  sprite: Phaser.GameObjects.Sprite;
}

/** Shockwave ring rolling out from a slam; hits each player once as its front passes. */
interface Shock {
  x: number;
  y: number;
  radius: number;
  t: number;
  dur: number;
  damage: number;
  band: number;
  hit: Set<Player>;
}

/** A firing beam; hits each player once while it lasts. */
interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  t: number;
  dur: number;
  damage: number;
  hit: Set<Player>;
}

/** An attack waiting for its charge or wind-up; dropped when the boss dies first. */
interface Pending {
  boss: Enemy;
  bossId: number;
  left: number;
  fire: () => void;
}

/**
 * Bosses (host and solo): brings them in on the BOSS_TIMES schedule, runs their skills and minions,
 * and owns the hazards, shockwaves and beams they leave. A boss due at the end of the run holds dawn back.
 */
export class Bosses {
  readonly hazards: Hazard[] = [];
  private shocks: Shock[] = [];
  private beams: Beam[] = [];
  private pending: Pending[] = [];
  /** The bosses this run meets, in order (seeded, all different while the list allows). */
  readonly order: EnemyDef[];
  private next = 0;
  /** The boss holding dawn back (and its net id, since enemies are pooled). */
  private dawnBoss: Enemy | null = null;
  private dawnBossId = -1;
  private readonly hazardKind = new Map(HAZARDS.map((d, i) => [d, i]));

  constructor(private game: GameScene) {
    const picks = game.rng.shuffled(BOSSES);
    this.order = BOSS_TIMES.map((_, i) => picks[i % picks.length]);
  }

  /** True while a boss that arrived at the end of the run is still alive: the run is not won yet. */
  get holdsDawn(): boolean {
    const b = this.dawnBoss;
    return b !== null && b.active && b.netId === this.dawnBossId;
  }

  /** Brings in every boss whose time has come. */
  checkSchedule(runTime: number): void {
    while (this.next < BOSS_TIMES.length && runTime >= BOSS_TIMES[this.next]) {
      const at = BOSS_TIMES[this.next];
      this.spawn(this.order[this.next], at >= RUN_SECONDS);
      this.next++;
    }
  }

  /** Debug: a random boss right now (does not touch the schedule). */
  spawnRandom(): void {
    this.spawn(this.game.rng.pick(BOSSES), false);
  }

  private spawn(def: EnemyDef, holdsDawn: boolean): void {
    const g = this.game;
    const players = g.livePlayers();
    if (players.length === 0) return;
    const target = g.rng.pick(players);
    const pt = g.spawner.ringPoint(def.radius, target) ?? { x: target.x, y: Phaser.Math.Clamp(target.y - 200, INNER.top + 60, INNER.bottom - 60) };
    const hpScale = hpScaleForMinute(g.runTime / 60) * hpScaleForPlayers(g.playerCount);
    const e = g.enemies.spawn(def, pt.x, pt.y, hpScale, true);
    if (!e) return;
    // Skills start staggered so a boss does not open with everything at once.
    def.boss!.skills.forEach((s, i) => (e.skillTimers[i] = s.cooldown * (0.5 + 0.3 * i)));
    if (holdsDawn) {
      this.dawnBoss = e;
      this.dawnBossId = e.netId;
      g.banner(`DAWN WAITS · DEFEAT THE ${def.name.toUpperCase()}`, COLOR.bad);
    } else {
      g.banner(`${def.name.toUpperCase()} APPROACHES`, COLOR.bad);
    }
    g.fx.ring(e.x, e.y, def.boss!.color, 90, 700);
    g.playSfx('roar');
  }

  /** Enemies.kill tells us a boss is gone: killed by players (`defeated`), or cleared at dawn. */
  onBossGone(e: Enemy, defeated: boolean): void {
    this.pending = this.pending.filter((p) => p.boss !== e);
    if (e === this.dawnBoss) this.dawnBoss = null;
    if (!defeated) return;
    const g = this.game;
    g.banner(`${e.def.name.toUpperCase()} IS DEFEATED`, COLOR.gold);
    g.fx.ring(e.x, e.y, COLOR.gold, 110, 700);
    g.fx.blast(e.x, e.y, 50, e.def.boss!.color);
    g.playSfx('boom', e.x, e.y);
  }

  /** HP bars for every living boss. */
  bars(): BossBar[] {
    const out: BossBar[] = [];
    for (const e of this.game.enemies.active) {
      if (e.active && e.def.boss) out.push({ id: e.netId, def: e.def, frac: Math.max(0, e.hp / e.maxHp) });
    }
    return out;
  }

  /** Move speed multiplier for a player at (x, y): webs and void fields slow them. */
  slowAt(x: number, y: number): number {
    let slow = 0;
    for (const h of this.hazards) {
      if (!h.def.slow) continue;
      const r = h.def.radius + PLAYER_RADIUS;
      if ((h.x - x) ** 2 + (h.y - y) ** 2 <= r * r) slow = Math.max(slow, h.def.slow);
    }
    return 1 - slow;
  }

  /** The stacking slow a player at (x, y) is standing in (a void field's Astral Chains), if any. */
  chainsAt(x: number, y: number): ChainsDef | null {
    for (const h of this.hazards) {
      if (!h.def.chains) continue;
      const r = h.def.radius + PLAYER_RADIUS;
      if ((h.x - x) ** 2 + (h.y - y) ** 2 <= r * r) return h.def.chains;
    }
    return null;
  }

  /** `playing` false (dying, dawn) only lets hazards fade out: no skills and no damage. */
  update(dt: number, playing: boolean): void {
    const g = this.game;
    if (playing) {
      for (const e of g.enemies.active) {
        if (!e.active) continue;
        if (e.def.boss) this.think(e, dt);
        else if (e.def.shooter) this.shoot(e, dt);
      }
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const p = this.pending[i];
        p.left -= dt;
        if (!p.boss.active || p.boss.netId !== p.bossId) {
          this.pending.splice(i, 1);
          continue;
        }
        if (p.left <= 0) {
          this.pending.splice(i, 1);
          p.fire();
        }
      }
    }
    this.updateHazards(dt, playing);
    this.updateShocks(dt, playing);
    this.updateBeams(dt, playing);
  }

  /** Removes every hazard and attack in flight (dawn). */
  clear(): void {
    for (const h of this.hazards) h.sprite.destroy();
    this.hazards.length = 0;
    this.shocks.length = 0;
    this.beams.length = 0;
    this.pending.length = 0;
  }

  // ---------------------------------------------------------------- skills

  private think(e: Enemy, dt: number): void {
    const skills = e.def.boss!.skills;
    const busy = this.game.time.now < e.rootedUntil;
    for (let i = 0; i < skills.length; i++) {
      e.skillTimers[i] = (e.skillTimers[i] ?? skills[i].cooldown) - dt;
      if (busy || e.skillTimers[i] > 0) continue;
      e.skillTimers[i] = skills[i].cooldown;
      this.use(e, skills[i]);
      // One skill per frame; a charging skill keeps the others waiting until it lands.
      break;
    }
  }

  private nearestPlayer(x: number, y: number, maxDist = Infinity): Player | null {
    let best: Player | null = null;
    let bestD = maxDist * maxDist;
    for (const p of this.game.livePlayers()) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private use(e: Enemy, s: BossSkill): void {
    const g = this.game;
    const rng = g.rng;
    switch (s.kind) {
      case 'webs': {
        const t = this.nearestPlayer(e.x, e.y);
        if (!t) return;
        for (let i = 0; i < s.count; i++) {
          const a = rng.angle();
          const r = Math.sqrt(rng.float()) * s.range;
          const x = clampX(t.x + Math.cos(a) * r);
          const y = clampY(t.y + Math.sin(a) * r);
          g.fx.beam(e.x, e.y, x, y, 1, 0.25, 0xe8e8f4);
          this.addHazard('web', x, y, { life: s.lifetime });
        }
        g.playSfx('whip', e.x, e.y);
        return;
      }
      case 'summon': {
        const minion = enemyDef(s.minion);
        let alive = 0;
        for (const m of g.enemies.active) if (m.active && m.def === minion) alive++;
        const n = Math.min(s.count, s.max - alive);
        const hpScale = hpScaleForMinute(g.runTime / 60) * hpScaleForPlayers(g.playerCount);
        const off = rng.angle();
        for (let i = 0; i < n; i++) {
          const a = off + (i * Math.PI * 2) / n;
          const x = clampX(e.x + Math.cos(a) * s.distance);
          const y = clampY(e.y + Math.sin(a) * s.distance);
          if (g.enemies.spawn(minion, x, y, hpScale)) g.fx.puff(x, y, minion.puffColor, 8);
        }
        return;
      }
      case 'pollen': {
        for (let i = 0; i < s.count; i++) {
          const x = e.x + rng.range(-24, 24);
          const y = e.y + rng.range(-24, 24);
          this.addHazard('pollen', x, y, { life: s.lifetime, damage: s.damage, follow: s.speed });
        }
        g.fx.puff(e.x, e.y - 10, 0xeef88c, 14);
        return;
      }
      case 'beam': {
        const t = this.nearestPlayer(e.x, e.y);
        if (!t) return;
        const a = Math.atan2(t.y - e.y, t.x - e.x);
        const x1 = e.x;
        const y1 = e.y;
        const x2 = e.x + Math.cos(a) * s.length;
        const y2 = e.y + Math.sin(a) * s.length;
        e.rootedUntil = g.time.now + (s.charge + s.duration) * 1000;
        g.fx.beam(x1, y1, x2, y2, 2, s.charge, WARN_COLOR);
        this.pending.push({
          boss: e,
          bossId: e.netId,
          left: s.charge,
          fire: () => {
            this.beams.push({ x1, y1, x2, y2, width: s.width, t: 0, dur: s.duration, damage: s.damage, hit: new Set() });
            g.fx.beam(x1, y1, x2, y2, s.width, s.duration + 0.3, s.color);
            g.playSfx('laser', x1, y1);
          },
        });
        return;
      }
      case 'whirlpools': {
        const players = g.livePlayers();
        if (players.length === 0) return;
        for (let i = 0; i < s.count; i++) {
          const p = rng.pick(players);
          const a = rng.angle();
          const r = rng.range(60, s.range);
          this.addHazard('whirlpool', clampX(p.x + Math.cos(a) * r), clampY(p.y + Math.sin(a) * r), { life: s.lifetime, damage: s.damage });
        }
        g.playSfx('freeze');
        return;
      }
      case 'slam': {
        e.rootedUntil = g.time.now + (s.windup + 0.3) * 1000;
        g.fx.warn(e.x, e.y, s.radius, s.windup, WARN_COLOR);
        const x = e.x;
        const y = e.y;
        this.pending.push({
          boss: e,
          bossId: e.netId,
          left: s.windup,
          fire: () => {
            this.shocks.push({ x, y, radius: s.radius, t: 0, dur: s.duration, damage: s.damage, band: s.band, hit: new Set() });
            g.fx.ring(x, y, 0xf0b030, s.radius, s.duration * 1000);
            g.fx.puff(x, y + 16, 0x9a8a52, 20);
            g.playSfx('boom', x, y);
          },
        });
        return;
      }
      case 'clubs': {
        const off = rng.angle();
        for (let i = 0; i < s.count; i++) {
          const a = off + (i * Math.PI * 2) / s.count;
          this.addHazard('club', e.x, e.y, {
            life: s.lifetime,
            damage: s.damage,
            vx: Math.cos(a) * s.speed,
            vy: Math.sin(a) * s.speed,
            back: { owner: e, ownerId: e.netId, outTime: s.outTime, speed: s.speed },
          });
        }
        g.playSfx('whip', e.x, e.y);
        return;
      }
    }
  }

  /** Minions that shoot (Bloom Sprouts): one shot at the closest player in range every interval. */
  private shoot(e: Enemy, dt: number): void {
    const sh = e.def.shooter!;
    // First shot comes after a random part of the interval, so a fresh group does not fire in unison.
    if (e.skillTimers[0] === undefined) e.skillTimers[0] = sh.interval * (0.5 + this.game.rng.float() * 0.5);
    e.skillTimers[0] -= dt;
    if (e.skillTimers[0] > 0) return;
    e.skillTimers[0] = sh.interval;
    const t = this.nearestPlayer(e.x, e.y, sh.range);
    if (!t) return;
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    this.addHazard(sh.hazard, e.x, e.y - 4, { life: sh.lifetime, damage: sh.damage, vx: Math.cos(a) * sh.speed, vy: Math.sin(a) * sh.speed, consume: true });
  }

  // ---------------------------------------------------------------- hazards and attacks

  /** Leaves hazard `id` at (x, y). Bosses, and rare enemies' modifiers (systems/EnemyModifiers.ts), use it. */
  addHazard(
    id: string,
    x: number,
    y: number,
    o: { life: number; damage?: number; interval?: number; follow?: number; vx?: number; vy?: number; consume?: boolean; back?: Hazard['back'] },
  ): void {
    const def = hazardDef(id);
    const sprite = this.game.add.sprite(x, y, ATLAS, def.frame).setScale(def.radius / def.artRadius);
    if (def.anim) sprite.play(def.anim);
    sprite.setDepth(def.ground ? DEPTH.shadows + 0.5 : DEPTH.projectiles - 1);
    this.hazards.push({
      def,
      kind: this.hazardKind.get(def) ?? 0,
      netId: nextNetId(),
      x,
      y,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      age: 0,
      life: o.life,
      damage: o.damage ?? 0,
      interval: o.interval ?? 0,
      tick: 0,
      follow: o.follow ?? 0,
      consume: o.consume ?? false,
      back: o.back ?? null,
      sprite,
    });
  }

  /** 0..1: how visible a hazard is (fading out at the end of its life). */
  static alpha(h: Hazard): number {
    const fade = h.def.fade ?? 0;
    return fade > 0 ? Math.min(1, h.life / fade) : 1;
  }

  private updateHazards(dt: number, playing: boolean): void {
    const g = this.game;
    const live = g.livePlayers();
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.age += dt;
      h.life -= dt;
      let gone = h.life <= 0;
      if (h.back) {
        const b = h.back;
        if (h.age < b.outTime) {
          // Slows to a stop at the far end of the throw.
          const k = 1 - h.age / b.outTime;
          const v = Math.hypot(h.vx, h.vy) || 1;
          h.vx = (h.vx / v) * b.speed * k;
          h.vy = (h.vy / v) * b.speed * k;
        } else if (b.owner.active && b.owner.netId === b.ownerId) {
          const dx = b.owner.x - h.x;
          const dy = b.owner.y - h.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < CATCH_RADIUS) gone = true;
          const sp = b.speed * Math.min(1, (h.age - b.outTime) / RETURN_ACCEL);
          h.vx = (dx / d) * sp;
          h.vy = (dy / d) * sp;
        }
      }
      if (h.follow > 0) {
        const t = this.nearestPlayer(h.x, h.y);
        if (t) {
          const dx = t.x - h.x;
          const dy = t.y - h.y;
          const d = Math.hypot(dx, dy) || 1;
          h.vx = (dx / d) * h.follow;
          h.vy = (dy / d) * h.follow;
        }
      }
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.x < INNER.left || h.x > INNER.right || h.y < INNER.top || h.y > INNER.bottom) gone = true;
      // Ticking hazards deal damage over time to everyone inside on each tick; the others hurt on touch.
      const ticking = h.interval > 0;
      let hurts = !gone && playing && h.damage > 0;
      if (hurts && ticking) {
        h.tick -= dt;
        hurts = h.tick <= 0;
        if (hurts) h.tick += h.interval;
      }
      if (hurts) {
        const r = h.def.radius + PLAYER_RADIUS;
        for (const p of live) {
          if ((p.x - h.x) ** 2 + (p.y - h.y) ** 2 > r * r) continue;
          g.hurtPlayer(p, h.damage, ticking);
          if (h.consume) {
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        h.sprite.destroy();
        this.hazards.splice(i, 1);
        continue;
      }
      h.sprite.setPosition(h.x, h.y).setAlpha(Bosses.alpha(h));
      if (h.def.spin) h.sprite.rotation += h.def.spin * dt;
    }
  }

  private updateShocks(dt: number, playing: boolean): void {
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      // Same easing as Fx.ring, so the hit lands where the drawn ring is.
      const k = Math.min(1, s.t / s.dur);
      const r = 4 + (s.radius - 4) * (1 - (1 - k) * (1 - k));
      if (playing) {
        for (const p of this.game.livePlayers()) {
          if (s.hit.has(p)) continue;
          const d = Math.hypot(p.x - s.x, p.y - s.y);
          if (Math.abs(d - r) > s.band + PLAYER_RADIUS) continue;
          s.hit.add(p);
          this.game.hurtPlayer(p, s.damage);
        }
      }
      if (s.t >= s.dur) this.shocks.splice(i, 1);
    }
  }

  private updateBeams(dt: number, playing: boolean): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      if (playing) {
        for (const p of this.game.livePlayers()) {
          if (b.hit.has(p)) continue;
          if (distToSegment(p.x, p.y, b.x1, b.y1, b.x2, b.y2) > b.width / 2 + PLAYER_RADIUS) continue;
          b.hit.add(p);
          this.game.hurtPlayer(p, b.damage);
        }
      }
      if (b.t >= b.dur) this.beams.splice(i, 1);
    }
  }
}

function clampX(x: number): number {
  return Phaser.Math.Clamp(x, INNER.left + WALL_MARGIN, INNER.right - WALL_MARGIN);
}

function clampY(y: number): number {
  return Phaser.Math.Clamp(y, INNER.top + WALL_MARGIN, INNER.bottom - WALL_MARGIN);
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Phaser.Math.Clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}
