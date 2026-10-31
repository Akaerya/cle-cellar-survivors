import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { ARENA_SIZE, CHILL_TINT, DEPTH, MAX_EFFECT_STACKS, MAX_ENEMIES, SLOW_LINGER_MS, STUN_TINT } from '../constants';
import { SpatialGrid } from '../core/spatialGrid';
import { VIRULENT_RANGE } from '../data';
import type { EnemyDef } from '../data/types';
import { Enemy, SHADOW_W, TICK_EPSILON, type EffectStack } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { GameScene } from '../scenes/GameScene';
import type { Effective, WeaponInstance } from './Weapons';

/** Knockback is an impulse that decays with this time constant, so `knockback` px is the distance pushed. */
const KB_TAU = 0.12;
/** px/s of push per full overlap between two enemies. */
const SEP_STRENGTH = 150;
const SEP_MAX = 170;

/** Most stacks of its effect one weapon can keep on one enemy. */
const maxStacks = (w: WeaponInstance) => w.def.effect?.maxStacks ?? MAX_EFFECT_STACKS;


export class Enemies {
  readonly group: Phaser.Physics.Arcade.Group;
  readonly grid = new SpatialGrid<Enemy>(ARENA_SIZE, ARENA_SIZE, 64);
  /** Active enemies, rebuilt at the start of every update. */
  readonly active: Enemy[] = [];
  private shadows: Phaser.GameObjects.Blitter;
  live = 0;
  /** HP the last `hit` took off (0 when it did not land), and whether it killed the enemy. */
  lastDealt = 0;
  lastKilled = false;
  /** `updateEffects`: each stack weapon's stats for this frame, and one enemy's tick damage summed per weapon. */
  private effCache = new Map<WeaponInstance, Effective>();
  private tickSums = new Map<WeaponInstance, number>();

  constructor(private game: GameScene) {
    this.group = game.physics.add.group({ classType: Enemy, maxSize: MAX_ENEMIES, runChildUpdate: false });
    this.shadows = game.add.blitter(0, 0, ATLAS).setDepth(DEPTH.shadows);
  }

  /** `force` (bosses): when the field is full, a regular enemy is removed to make room. */
  spawn(def: EnemyDef, x: number, y: number, hpScale: number, force = false): Enemy | null {
    if (this.live >= MAX_ENEMIES && force) {
      const victim = this.active.find((e) => e.active && !e.def.boss);
      if (victim) this.kill(victim, false);
    }
    if (this.live >= MAX_ENEMIES) return null;
    const e = this.group.get(x, y) as Enemy | null;
    if (!e) return null;
    e.spawn(def, x, y, hpScale);
    if (!e.shadow) e.shadow = this.shadows.create(x, y, def.shadow);
    else e.shadow.setFrame(def.shadow);
    e.shadow.visible = true;
    this.live++;
    this.active.push(e);
    return e;
  }

  /** Every enemy walks at the nearest player in `targets`. */
  update(dt: number, now: number, targets: Player[], frozen: boolean, speedScale = 1): void {
    const active = this.active;
    active.length = 0;
    this.grid.clear();
    const children = this.group.getChildren() as Enemy[];
    for (let i = 0; i < children.length; i++) {
      const e = children[i];
      if (!e.active) continue;
      active.push(e);
      this.grid.insert(e);
      e.sepX = 0;
      e.sepY = 0;
    }

    // Soft push-apart so the horde forms a crowd instead of stacking on one point.
    this.grid.forEachNeighbourPair((a, b) => {
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const min = (a.radius + b.radius) * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) return;
      let d = Math.sqrt(d2);
      if (d < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d = Math.hypot(dx, dy);
      }
      const push = ((min - d) / min) * SEP_STRENGTH;
      const nx = dx / d;
      const ny = dy / d;
      const ma = a.def.mass ?? 1;
      const mb = b.def.mass ?? 1;
      const wa = (2 * mb) / (ma + mb);
      const wb = (2 * ma) / (ma + mb);
      a.sepX -= nx * push * wa;
      a.sepY -= ny * push * wa;
      b.sepX += nx * push * wb;
      b.sepY += ny * push * wb;
    });

    const decay = Math.exp(-dt / KB_TAU);
    for (let i = 0; i < active.length; i++) {
      const e = active[i];
      const body = e.body as Phaser.Physics.Arcade.Body;
      if (frozen || targets.length === 0 || now < e.rootedUntil || e.stunned(now)) {
        body.setVelocity(0, 0);
      } else {
        let t = targets[0];
        let best = Infinity;
        for (let k = 0; k < targets.length; k++) {
          const c = targets[k];
          const d2 = (c.x - e.x) ** 2 + (c.y - e.y) ** 2;
          if (d2 < best) {
            best = d2;
            t = c;
          }
        }
        const dx = t.x - e.x;
        const dy = t.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        e.kbx *= decay;
        e.kby *= decay;
        const sl = Math.hypot(e.sepX, e.sepY);
        const sk = sl > SEP_MAX ? SEP_MAX / sl : 1;
        const sp = e.def.speed * speedScale * e.speedMult * (now < e.slowUntil ? 1 - e.slowAmount : 1);
        body.setVelocity(
          (dx / d) * sp + e.kbx + e.sepX * sk,
          (dy / d) * sp + e.kby + e.sepY * sk,
        );
        if (Math.abs(dx) > 2) e.setFlipX(dx < 0);
      }
      if (e.flashUntil !== 0 && now >= e.flashUntil) e.flashUntil = 0;
      if (e.flashUntil === 0) {
        // Back from a hit flash, or stunned, chilled or neither: only touch the tint when it changes.
        const stun = e.stunned(now);
        const chill = stun ? STUN_TINT : e.chillTint(now, CHILL_TINT);
        const want = stun ? 3 : chill === null ? 0 : chill === CHILL_TINT ? 2 : 4;
        if (want !== e.tintState) {
          e.tintState = want;
          if (chill !== null) e.setTint(chill).setTintMode(Phaser.TintModes.MULTIPLY);
          else e.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
        }
      }
      e.setDepth(DEPTH.units + e.y / ARENA_SIZE);
      const s = e.shadow!;
      s.x = e.x - SHADOW_W[e.def.shadow] / 2;
      s.y = e.y + e.displayHeight / 2 - 3 * (e.def.scale ?? 1) + e.def.hover;
    }
  }

  /**
   * Host: ticks duration effects. Each stack deals its weapon's effect damage every `effectInterval` until it runs
   * out, and every tick may reiterate (copy the stack with the time it has left). An enemy takes the ticks of one
   * weapon's stacks that fall in the same frame as one hit (one number).
   */
  updateEffects(dt: number): void {
    const active = this.active;
    const effs = this.effCache;
    const sums = this.tickSums;
    effs.clear();
    for (let i = 0; i < active.length; i++) {
      const e = active[i];
      if (e.effects.length === 0) continue;
      sums.clear();
      // Copies made this frame start ticking next frame.
      const n = e.effects.length;
      for (let k = 0; k < n; k++) {
        const st = e.effects[k];
        st.left -= dt;
        st.next -= dt;
        if (!st.weapon.def.effect) {
          st.left = 0;
          continue;
        }
        let eff = effs.get(st.weapon);
        if (!eff) {
          eff = st.weapon.owner.weapons.eff(st.weapon);
          effs.set(st.weapon, eff);
        }
        // A tick counts while it falls inside the stack's duration.
        while (st.next <= 0 && st.next <= st.left + TICK_EPSILON) {
          st.next += eff.effectInterval;
          sums.set(st.weapon, (sums.get(st.weapon) ?? 0) + eff.effectDamage);
          this.reiterate(e, st, eff.reiterate);
        }
      }
      for (const [w, amount] of sums) {
        if (!e.active) break;
        this.hit(e, amount, 0, 0, 0, w, true);
      }
      if (!e.active) continue;
      let keep = 0;
      for (let k = 0; k < e.effects.length; k++) if (e.effects[k].left > 0) e.effects[keep++] = e.effects[k];
      e.effects.length = keep;
    }
  }

  /**
   * Host: `e` just died carrying duration effect stacks. On a field that hands stacks on (Vulnerability), all of them
   * go to the closest enemy on that field owner's screen. Otherwise each stack whose weapon has Virulent Chain moves to
   * the closest enemies within VIRULENT_RANGE (that many of them). Stacks keep the time they have left; an enemy that
   * already carries a weapon's full count of stacks takes no more of them.
   */
  private passOnEffects(e: Enemy): void {
    let to: Enemy[] = [];
    for (const p of this.game.players) {
      if (!p || p.gone || !p.weapons.onTransferField(e)) continue;
      const t = this.closest(e, Infinity, 1, (o) => this.game.onScreen(p, o.x, o.y));
      if (t.length > 0) {
        to = t;
        break;
      }
    }
    for (const st of e.effects) {
      if (st.left <= 0) continue;
      let targets = to;
      if (targets.length === 0) {
        const n = Math.round(st.weapon.owner.weapons.eff(st.weapon).virulent);
        if (n <= 0) continue;
        targets = this.closest(e, VIRULENT_RANGE, n);
      }
      for (const t of targets) {
        if (!this.game.enemyMods.debuffable(t) || this.stacksOf(t, st.weapon) >= maxStacks(st.weapon)) continue;
        t.effects.push({ weapon: st.weapon, left: st.left, next: st.next, copy: st.copy });
      }
    }
  }

  /** Up to `n` living enemies other than `e` within `range` px of it that pass `ok`, closest first. */
  private closest(e: Enemy, range: number, n: number, ok?: (o: Enemy) => boolean): Enemy[] {
    const found: { en: Enemy; d2: number }[] = [];
    // A pooled enemy that died and came back this frame can be listed twice until the next update.
    for (const o of new Set(this.active)) {
      if (o === e || !o.active || (ok && !ok(o))) continue;
      const d2 = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
      if (d2 <= range * range) found.push({ en: o, d2 });
    }
    found.sort((a, b) => a.d2 - b.d2);
    return found.slice(0, n).map((f) => f.en);
  }

  private stacksOf(e: Enemy, w: WeaponInstance): number {
    let count = 0;
    for (const st of e.effects) if (st.weapon === w) count++;
    return count;
  }

  /**
   * Slows `e` by `amount` (0..1) for a moment; fields call this every frame. Slows do not stack: the strongest wins.
   * Hexproof enemies are never slowed.
   */
  slow(e: Enemy, amount: number, now: number): void {
    if (!this.game.enemyMods.debuffable(e)) return;
    if (now >= e.slowUntil) e.slowAmount = 0;
    e.slowAmount = Math.max(e.slowAmount, Math.min(1, amount));
    e.slowUntil = now + SLOW_LINGER_MS;
  }

  /**
   * Stun: `e` stands still for `seconds` and takes `bonus` more damage meanwhile (a stronger stun extends a weaker
   * one). Bosses and hexproof enemies are never stunned. Returns true when it took.
   */
  stun(e: Enemy, seconds: number, bonus: number, now: number): boolean {
    if (e.def.boss || !this.game.enemyMods.debuffable(e)) return false;
    e.stunBonus = e.stunned(now) ? Math.max(e.stunBonus, bonus) : bonus;
    e.stunUntil = Math.max(e.stunUntil, now + seconds * 1000);
    return true;
  }

  /** Reiterate: with `chance`, the stack copies itself (same time left), up to the effect's most stacks per weapon. */
  reiterate(e: Enemy, stack: EffectStack, chance: number): void {
    if (chance <= 0 || stack.left <= 0 || !e.active) return;
    if (this.stacksOf(e, stack.weapon) >= maxStacks(stack.weapon) || this.game.rng.float() >= chance) return;
    e.effects.push({ weapon: stack.weapon, left: stack.left, next: stack.next, copy: true });
  }

  /**
   * dirX/dirY: unit vector to push the enemy along. `dot`: a tick of a duration effect (damage over time), which
   * Thorns and Crystalline do not answer. Returns false when the hit did not land: the enemy was already dead, or a
   * rare enemy's modifiers ignored it (blocked, shielded).
   */
  hit(e: Enemy, amount: number, dirX: number, dirY: number, knockback: number, weapon?: WeaponInstance, dot = false): boolean {
    this.lastDealt = 0;
    this.lastKilled = false;
    if (!e.active || e.hp <= 0) return false;
    // Critical strikes: any hit from a player with crit chance (passive weapons, stats) can crit.
    let crit = false;
    let brutal = false;
    if (weapon) {
      const owner = weapon.owner;
      const chance = owner.critChance;
      if (chance > 0 && this.game.rng.float() < chance) {
        crit = true;
        amount *= owner.stats.critDamage;
      }
      // Brutal charges (Unstable Infusion): double damage, which is not a critical strike.
      const brutalChance = owner.brutalChance;
      if (brutalChance > 0 && this.game.rng.float() < brutalChance) {
        brutal = true;
        amount *= 2;
      }
    }
    if (e.stunned(this.game.time.now)) amount *= 1 + e.stunBonus;
    const mods = this.game.enemyMods;
    const attacker = weapon?.owner ?? null;
    if (e.mods.length > 0) {
      amount = mods.incoming(e, amount, attacker, dot);
      if (amount < 0) return false;
    }
    // Intervention (an Invulnerability aura): the hit lands, but cannot take the enemy below 1 HP.
    const floor = e.intervention ? Math.min(e.hp, 1) : 0;
    const dealt = Math.min(e.hp - floor, amount);
    e.hp = Math.max(floor, e.hp - amount);
    if (weapon) {
      weapon.damage += dealt;
      weapon.owner.runStats.damage += dealt;
      weapon.owner.lifeStealFrom(dealt);
    }
    e.flash(this.game.time.now);
    this.game.fx.damageNumber(e.x, e.y - e.displayHeight / 2, amount, crit ? 2 : brutal || amount >= 25 ? 1 : 0);
    const k = (knockback * (1 - e.def.knockbackResist)) / KB_TAU;
    e.kbx += dirX * k;
    e.kby += dirY * k;
    this.game.playSfx('hit', e.x, e.y);
    if (attacker && !dot && e.mods.length > 0) mods.afterHit(e, amount, attacker);
    let killed = false;
    if (e.hp <= 0 && !mods.revive(e)) {
      killed = true;
      this.kill(e, true);
      if (weapon) {
        weapon.kills++;
        weapon.owner.runStats.kills++;
      }
    }
    if (crit && weapon) {
      weapon.owner.runStats.crits++;
      weapon.owner.weapons.onCrit();
    }
    // Set last: Thorns can set off a reflected hit (another `hit`) in the middle of this one.
    this.lastDealt = dealt;
    this.lastKilled = killed;
    return true;
  }

  kill(e: Enemy, dropGem: boolean): void {
    if (!e.active) return;
    this.game.fx.puff(e.x, e.y, e.def.puffColor, e.def.boss ? 40 : (e.def.mass ?? 1) > 1 ? 18 : 8);
    if (e.def.boss) this.game.bosses.onBossGone(e, dropGem);
    if (dropGem) {
      if (e.effects.length > 0) this.passOnEffects(e);
      this.game.enemyMods.onDeath(e);
      this.game.gems.drop(e.x, e.y + 2, e.def.exp);
      this.game.potions.roll(e.x, e.y - 2, e.def.potionChance);
    }
    e.disableBody(true, true);
    e.anims.stop();
    e.effects.length = 0;
    if (e.shadow) e.shadow.visible = false;
    this.live--;
    if (dropGem) {
      this.game.playSfx('kill', e.x, e.y);
      this.game.onEnemyKilled();
    }
  }

  /** Moves an enemy without losing its HP (used for stragglers far from every player). */
  relocate(e: Enemy, x: number, y: number): void {
    (e.body as Phaser.Physics.Arcade.Body).reset(x, y);
    e.kbx = e.kby = 0;
  }

  nearest(x: number, y: number, maxDist: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < this.active.length; i++) {
      const e = this.active[i];
      if (!e.active) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = e;
      }
    }
    return best;
  }
}
