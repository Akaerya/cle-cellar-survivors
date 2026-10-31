import Phaser from 'phaser';
import { INNER } from '../constants';
import { hasteFactor } from '../core/progression';
import { ENEMY_MODIFIERS, RARE_HP_PER_MODIFIER, RARE_TIERS, enemyModifier, modifierBit } from '../data';
import { PLAYER_RADIUS } from '../data/player';
import type { EnemyModifierDef, EnemyModifierId } from '../data/types';
import { stillAlive, type Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { GameScene } from '../scenes/GameScene';

type Mod<K extends EnemyModifierId> = Extract<EnemyModifierDef, { id: K }>;

const INVULNERABILITY = modifierBit('invulnerability');
const HEXPROOF = modifierBit('hexproof');
const SPIRIT_WALKER = modifierBit('spirit_walker');
const SOUL_ABSORPTION = modifierBit('soul_absorption');
const SPIRIT = enemyModifier('spirit_walker');
const SOULS = enemyModifier('soul_absorption');
/** Grid queries reach this far past an aura so big enemies whose body pokes into it are found. */
const QUERY_MARGIN = 24;
/** Void fields and teleports stay this far inside the arena wall. */
const WALL_MARGIN = 24;

/** A crystal bud charging up under a player (Crystalline). */
interface Bud {
  x: number;
  y: number;
  /** Seconds until it explodes. */
  left: number;
  radius: number;
  damage: number;
  color: number;
  /** The rare enemy that grew it (and its spawn id): Storm Shield reflects damage at it while it lives. */
  source: Enemy;
  sourceId: number;
}

/**
 * Rare enemies (host and solo). The spawner calls `roll` on every enemy it brings in; this system runs what the
 * modifiers do (data/enemyModifiers.ts): the Invulnerability and Empower Allies auras, Enrage, void fields, teleports,
 * crystal buds, caustic ground, souls and Spirit Walker revives. Enemies.hit asks `incoming` how much of a hit gets
 * through and calls `afterHit` (Thorns, Crystalline); everything a rare enemy deals goes through `outgoing`.
 * Joiners never run this: they draw rare enemies (RareVisuals) from the snapshot's rare list.
 */
export class EnemyModifiers {
  /** Rare enemies on the field, rebuilt every update (snapshots and RareVisuals read it). */
  readonly rares: Enemy[] = [];
  private query: Enemy[] = [];
  private buds: Bud[] = [];
  /** Players that already got a crystal bud this frame: a second one on the same spot could not hurt them again. */
  private budded = new Set<Player>();
  /** Enemies inside an Empower Allies aura last frame, and this frame, with the aura. */
  private empowered = new Map<Enemy, Mod<'empower_allies'>>();
  private nextEmpowered = new Map<Enemy, Mod<'empower_allies'>>();

  constructor(private game: GameScene) {}

  /** Spawner: maybe makes `e` rare. Tiers are rolled in order; the first that hits sets how many modifiers it gets. */
  roll(e: Enemy): void {
    const rng = this.game.rng;
    let r = rng.float();
    for (const tier of RARE_TIERS) {
      r -= tier.chance;
      if (r < 0) {
        this.apply(e, rng.shuffled(ENEMY_MODIFIERS).slice(0, tier.modifiers));
        return;
      }
    }
  }

  /** Makes `e` a rare enemy with `mods` (all different): more max HP, at full HP, with its timed modifiers on cooldown. */
  apply(e: Enemy, mods: EnemyModifierDef[]): void {
    e.mods = mods;
    e.modMask = 0;
    e.hpBonus = mods.length * RARE_HP_PER_MODIFIER;
    e.modTimers.length = 0;
    for (const m of mods) {
      e.modMask |= modifierBit(m.id);
      if (m.id === 'extra_life') e.hpBonus += m.health;
      e.modTimers.push(m.id === 'astral_touched' ? m.every : m.id === 'ambush' ? m.cooldown : 0);
    }
    this.refreshMaxHp(e);
    e.hp = e.maxHp;
    // A pooled enemy that died and came back this frame may still be listed until the next update.
    if (!this.rares.includes(e)) this.rares.push(e);
  }

  /** `playing` false (dying, dawn): auras and Enrage keep up with HP, but nothing acts. */
  update(dt: number, playing: boolean): void {
    const rares = this.rares;
    rares.length = 0;
    for (const e of this.game.enemies.active) {
      if (!e.active) continue;
      e.intervention = false;
      if (e.mods.length > 0) rares.push(e);
    }
    this.budded.clear();

    // Auras: who is protected (Invulnerability) or empowered this frame. Empower does not stack: the first aura wins.
    const next = this.nextEmpowered;
    next.clear();
    for (const r of rares) {
      for (const m of r.mods) {
        if (m.id === 'invulnerability') {
          for (const en of this.around(r.x, r.y, m.radius)) if (en !== r && !(en.modMask & INVULNERABILITY)) en.intervention = true;
        } else if (m.id === 'empower_allies') {
          for (const en of this.around(r.x, r.y, m.radius)) if (!next.has(en)) next.set(en, m);
        }
      }
    }
    // Enemies that died since keep their entry until here; a recycled one has no aura, so it is left alone.
    for (const e of this.empowered.keys()) if (!next.has(e)) this.setEmpower(e, null);
    for (const [e, m] of next) this.setEmpower(e, m);
    this.nextEmpowered = this.empowered;
    this.empowered = next;

    for (const e of rares) {
      const haste = hasteFactor(this.haste(e));
      for (let i = 0; i < e.mods.length; i++) {
        const m = e.mods[i];
        if (m.id === 'enrage') e.enrage = Phaser.Math.Clamp((1 - e.hp / e.maxHp) / (1 - m.fullAt), 0, 1);
        if (!playing) continue;
        if (m.id === 'astral_touched') {
          e.modTimers[i] -= dt;
          if (e.modTimers[i] <= 0) {
            e.modTimers[i] += m.every * haste;
            this.voidField(e, m);
          }
        } else if (m.id === 'ambush') {
          // Stays ready while the closest player is already this close, and jumps the moment they get away.
          e.modTimers[i] = Math.max(0, e.modTimers[i] - dt);
          if (e.modTimers[i] <= 0 && this.ambush(e, m)) e.modTimers[i] = m.cooldown * haste;
        }
      }
      this.refreshSpeed(e);
    }

    if (playing) this.updateBuds(dt);
    else this.buds.length = 0;
  }

  /** Hexproof enemies take no debuffs: no duration effects, no slows. */
  debuffable(e: Enemy): boolean {
    return (e.modMask & HEXPROOF) === 0;
  }

  /**
   * How much of `amount` rare enemy `e` takes from a hit by `attacker` (null when no player is behind it). `dot`:
   * damage over time, which is not a hit. -1: the damage is ignored (Blocks Attacks). Damage reductions multiply; a
   * Temporal Shield reduces hits from outside it once, however many the enemy has.
   */
  incoming(e: Enemy, amount: number, attacker: Player | null, dot = false): number {
    let shielded = false;
    for (const m of e.mods) {
      switch (m.id) {
        case 'blocks_attacks':
          if (this.game.rng.float() < m.chance) return this.ignored(e, 'BLOCK', m.color);
          break;
        case 'temporal_shield': {
          // Only hits are reduced: damage over time keeps ticking whoever applied it and wherever they are.
          const now = this.game.time.now;
          if (shielded || dot || !attacker || now < e.shieldDownUntil) break;
          if ((attacker.x - e.x) ** 2 + (attacker.y - e.y) ** 2 <= (m.radius + PLAYER_RADIUS) ** 2) break;
          shielded = true;
          amount *= 1 - m.reduction;
          if (++e.shieldHits >= m.hits) {
            e.shieldHits = 0;
            e.shieldDownUntil = now + m.recharge * 1000;
            this.game.fx.ring(e.x, e.y, m.color, m.radius, 300);
            this.game.fx.label(e.x, e.y - e.displayHeight / 2 - 8, 'BREAK', m.color);
          }
          break;
        }
        case 'physical_resistant':
          amount *= 1 - m.reduction;
          break;
        case 'enrage':
          amount *= 1 - m.reduction * e.enrage;
          break;
      }
    }
    return amount;
  }

  /** A word where the damage number would be, for a hit that was ignored. */
  private ignored(e: Enemy, word: string, color: number): number {
    this.game.fx.label(e.x, e.y - e.displayHeight / 2, word, color);
    return -1;
  }

  /** A hit (not damage over time) by `attacker` dealt `dealt` to rare enemy `e`: Thorns and Crystalline answer it. */
  afterHit(e: Enemy, dealt: number, attacker: Player): void {
    if (this.game.state !== 'playing') return;
    for (const m of e.mods) {
      if (!attacker.alive) return;
      if (m.id === 'thorns') this.game.hurtPlayer(attacker, this.outgoing(e, attacker, m.flat + m.share * dealt), false, e, e, m.floor);
      else if (m.id === 'crystalline') this.bud(e, m, attacker);
    }
  }

  /**
   * What multiplies the damage `e` deals: increased damage from Enrage, Empower Allies and souls adds up; with a
   * `target`, Executioner's more damage multiplies that.
   */
  damageMult(e: Enemy, target?: Player): number {
    let inc = e.empower?.damage ?? 0;
    let more = 1;
    for (const m of e.mods) {
      if (m.id === 'enrage') inc += m.damage * e.enrage;
      else if (m.id === 'soul_absorption') inc += m.damage * e.souls;
      else if (m.id === 'executioner' && target) {
        const missing = Math.max(0, 1 - target.hp / target.stats.maxHp);
        more *= 1 + m.more * Math.floor(missing / m.per + 1e-6);
      }
    }
    return (1 + inc) * more;
  }

  /** `raw` damage `e` deals to `target` right now (a touch, Thorns), after its modifiers and the auras it stands in. */
  outgoing(e: Enemy, target: Player, raw: number): number {
    return e.mods.length === 0 && !e.empower ? raw : raw * this.damageMult(e, target);
  }

  /** `e` died (a kill, or a death Spirit Walker then undoes): Caustic Ground, and souls for nearby Soul Absorption enemies. */
  onDeath(e: Enemy): void {
    for (const m of e.mods) {
      if (m.id === 'caustic_ground') {
        this.game.bosses.addHazard(m.hazard, e.x, e.y, { life: m.life, damage: m.damage * this.damageMult(e), interval: m.interval });
      }
    }
    const r2 = (SOULS.radius + e.radius) ** 2;
    for (const r of this.rares) {
      if (r === e || !r.active || !(r.modMask & SOUL_ABSORPTION)) continue;
      if ((r.x - e.x) ** 2 + (r.y - e.y) ** 2 > r2) continue;
      r.souls++;
      this.game.fx.beam(e.x, e.y, r.x, r.y, 1, 0.3, SOULS.color);
    }
  }

  /**
   * `e` just reached 0 HP: Spirit Walker (its own or a nearby ally's) brings it back once with full HP. Effects on it
   * keep ticking (Enemies.updateEffects may be in the middle of them).
   */
  revive(e: Enemy): boolean {
    if (e.spirit || !this.spiritNear(e)) return false;
    this.onDeath(e);
    e.spirit = true;
    e.hp = e.maxHp;
    e.setAlpha(SPIRIT.alpha);
    const fx = this.game.fx;
    fx.puff(e.x, e.y, e.def.puffColor, 8);
    fx.ring(e.x, e.y, SPIRIT.color, e.radius + 24, 450);
    this.game.playSfx('revive', e.x, e.y);
    return true;
  }

  /** Removes every crystal bud still charging (dawn). */
  clear(): void {
    this.buds.length = 0;
  }

  // ---------------------------------------------------------------- abilities

  private spiritNear(e: Enemy): boolean {
    if (e.modMask & SPIRIT_WALKER) return true;
    const r2 = (SPIRIT.radius + e.radius) ** 2;
    for (const r of this.rares) {
      if (r !== e && r.active && r.modMask & SPIRIT_WALKER && (r.x - e.x) ** 2 + (r.y - e.y) ** 2 <= r2) return true;
    }
    return false;
  }

  /** A void field at a random spot within `spread` px. */
  private voidField(e: Enemy, m: Mod<'astral_touched'>): void {
    const rng = this.game.rng;
    const a = rng.angle();
    const r = Math.sqrt(rng.float()) * m.spread;
    const x = clampX(e.x + Math.cos(a) * r);
    const y = clampY(e.y + Math.sin(a) * r);
    this.game.bosses.addHazard(m.hazard, x, y, { life: m.life });
    this.game.fx.puff(x, y, m.color, 6);
  }

  /** Teleports `distance` px from the closest living player, on its own side. False when it is already that close. */
  private ambush(e: Enemy, m: Mod<'ambush'>): boolean {
    let t: Player | null = null;
    let best = Infinity;
    for (const p of this.game.targetablePlayers()) {
      const d2 = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
      if (d2 < best) {
        best = d2;
        t = p;
      }
    }
    if (!t || best <= m.distance * m.distance) return false;
    const d = Math.sqrt(best);
    const x = clampX(t.x + ((e.x - t.x) / d) * m.distance);
    const y = clampY(t.y + ((e.y - t.y) / d) * m.distance);
    const fx = this.game.fx;
    fx.puff(e.x, e.y, m.color, 10);
    this.game.enemies.relocate(e, x, y);
    fx.puff(x, y, m.color, 10);
    this.game.playSfx('whip', x, y);
    return true;
  }

  /** Crystalline: a bud grows under the attacker (a warning circle shows the blast) and explodes after `charge` seconds. */
  private bud(e: Enemy, m: Mod<'crystalline'>, at: Player): void {
    if (this.budded.has(at)) return;
    this.budded.add(at);
    this.game.bosses.addHazard(m.hazard, at.x, at.y, { life: m.charge });
    this.game.fx.warn(at.x, at.y, m.radius, m.charge, m.color);
    this.buds.push({ x: at.x, y: at.y, left: m.charge, radius: m.radius, damage: m.damage * this.damageMult(e), color: m.color, source: e, sourceId: e.netId });
  }

  private updateBuds(dt: number): void {
    let keep = 0;
    for (const b of this.buds) {
      b.left -= dt;
      if (b.left > 0) {
        this.buds[keep++] = b;
        continue;
      }
      this.game.fx.frost(b.x, b.y, b.radius, b.color);
      this.game.playSfx('shatter', b.x, b.y);
      const r2 = (b.radius + PLAYER_RADIUS) ** 2;
      for (const p of this.game.livePlayers()) {
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 <= r2) this.game.hurtPlayer(p, b.damage, false, stillAlive(b.source, b.sourceId));
      }
    }
    this.buds.length = keep;
  }

  // ---------------------------------------------------------------- stats

  /** Ability Haste from souls: shortens void field and teleport cooldowns like the player stat. */
  private haste(e: Enemy): number {
    for (const m of e.mods) if (m.id === 'soul_absorption') return m.haste * e.souls;
    return 0;
  }

  /** Max HP from base HP, the modifiers' bonus and an Empower Allies aura (all added up). HP keeps its share of max HP. */
  private refreshMaxHp(e: Enemy): void {
    const before = e.maxHp;
    e.maxHp = Math.max(1, Math.round(e.baseHp * (1 + e.hpBonus + (e.empower?.health ?? 0))));
    if (before > 0) e.hp *= e.maxHp / before;
  }

  /** Increased move speed from Enrage and an Empower Allies aura adds up. */
  private refreshSpeed(e: Enemy): void {
    let inc = e.empower?.speed ?? 0;
    for (const m of e.mods) if (m.id === 'enrage') inc += m.speed * e.enrage;
    e.speedMult = 1 + inc;
  }

  private setEmpower(e: Enemy, m: Mod<'empower_allies'> | null): void {
    if (e.empower === m) return;
    e.empower = m;
    this.refreshMaxHp(e);
    this.refreshSpeed(e);
  }

  /** Living enemies whose body is within `radius` px of (x, y). Reuses one array: do not nest. */
  private around(x: number, y: number, radius: number): Enemy[] {
    const q = this.query;
    q.length = 0;
    this.game.enemies.grid.query(x, y, radius + QUERY_MARGIN, q);
    let n = 0;
    for (const en of q) if (en.active && (en.x - x) ** 2 + (en.y - y) ** 2 <= (radius + en.radius) ** 2) q[n++] = en;
    q.length = n;
    return q;
  }
}

function clampX(x: number): number {
  return Phaser.Math.Clamp(x, INNER.left + WALL_MARGIN, INNER.right - WALL_MARGIN);
}

function clampY(y: number): number {
  return Phaser.Math.Clamp(y, INNER.top + WALL_MARGIN, INNER.bottom - WALL_MARGIN);
}
