import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { ARENA_SIZE, DEPTH, INNER, MAX_CURIO_FIELDS, MAX_CURIO_JOBS, MAX_CURIO_MITIGATION, VIEW_W } from '../constants';
import { hasTag, type OwnedPowerup } from '../core/progression';
import { BASE_STATS, CURIOS, CYCLONE_ANIM, curioDef, enemyModifier, hazardDef, modifierBit } from '../data';
import { PLAYER_RADIUS } from '../data/player';
import type { CurioDef, CurioId, EnemyModifierDef, PlayerStats, PowerupDef, Targeting, WeaponDef } from '../data/types';
import { stillAlive, type Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { nextNetId } from '../net/ids';
import type { GameScene } from '../scenes/GameScene';
import type { SummonView, WeaponInstance } from './Weapons';

type Curio<K extends CurioId> = Extract<CurioDef, { id: K }>;
type Mod<K extends EnemyModifierDef['id']> = Extract<EnemyModifierDef, { id: K }>;

/** Chronobreak changes the cooldown of every weapon but these, whose cooldown is not how often they are used. */
const NO_COOLDOWN: ReadonlySet<Targeting> = new Set(['passive', 'infusion', 'petbuff', 'armory', 'followup', 'beam']);
const HEXPROOF = modifierBit('hexproof');
const VOID_FIELD = hazardDef('void_field');
const CAUSTIC_FIELD = hazardDef('caustic_ground');
/** Colours of what curios leave in the world. */
const VOID_COLOR = enemyModifier('astral_touched').color;
const SPIRIT_COLOR = enemyModifier('spirit_walker').color;
/** HUD colours of Aegis Aurora's shields and Fleeting Fantasy. */
export const SHIELD_COLOR = 0x9fe8ff;
export const FANTASY_COLOR = 0xd2a8ff;
/** px moved in one frame beyond which it counts as a teleport, not movement (Clockwork Capacitor). */
const TELEPORT_STEP = 40;

/** A field a curio leaves on the ground (caustic ground, void fields): slows enemies in it and may hurt them. */
interface Field {
  x: number;
  y: number;
  radius: number;
  left: number;
  slow: number;
  /** Damage every `interval` seconds (0: none), credited to `weapon`, and seconds to the next tick. */
  damage: number;
  interval: number;
  next: number;
  weapon: WeaponInstance;
}

/** A crystal bud a stolen Crystalline grew under a monster: explodes after `left` seconds. */
interface Bud {
  x: number;
  y: number;
  left: number;
  radius: number;
  damage: number;
  weapon: WeaponInstance;
}

/** Shadows and Dust's cyclone. */
interface Cyclone {
  netId: number;
  x: number;
  y: number;
  left: number;
  tick: number;
  sprite: Phaser.GameObjects.Sprite;
}

/** A rare enemy modifier stolen by Headhunter or Inspired Learning, and its state while it lasts. */
interface Stolen {
  def: EnemyModifierDef;
  left: number;
  /** Seconds until a timed one (void fields, teleports) acts again. */
  timer: number;
  /** Soul Absorption: souls gathered. Spirit Walker: already used. Temporal Shield: hits taken and broken until (scene ms). */
  souls: number;
  used: boolean;
  shieldHits: number;
  shieldDownUntil: number;
  /** The curio that stole it: its damage is credited there. */
  weapon: WeaponInstance;
}

/**
 * One player's curios (data/curios.ts). Joiners keep the list for the HUD and their stats; everything else runs on
 * the host. The hooks: Enemies.hit asks `outgoing` for the damage bonus and calls `landed` and `onKill`; Weapons
 * calls `weaponHit` (Kraken Slayer), `used` (Chronobreak), `cooldownFor`, `haste` and `recalls` (Resonance Dynamo);
 * GameScene.hurtPlayer goes through `ignores`, `takenMult`, `intervened`, `onDamaged`, `answer` and `spiritSave`;
 * Player routes heals (`beforeHeal`, `afterHeal`), damage taken (`absorb`), stats and move speed through here.
 * Follow-up damage (chains, explosions, zaps) is queued and dealt once the hit that caused it is done (`flush`).
 */
export class Curios {
  readonly list: CurioDef[] = [];
  private readonly owned = new Map<CurioId, CurioDef>();
  /** What each damaging curio deals its damage as, by attack id (the party screen reads them). */
  readonly attacks = new Map<string, WeaponInstance>();
  private readonly curioAttacks = new Set<WeaponInstance>();

  /** Shadows and Dust: Rampage stacks. */
  rampage = 0;
  /** Suffering Mass: Fleeting Fantasy and its max (0 without the curio). */
  ff = 0;
  ffMax = 0;
  /** Seconds since damage was last taken. */
  private sinceHurt = Infinity;
  /** Aegis Aurora shields: seconds left and points left on each. */
  private readonly shields: { left: number; value: number }[] = [];
  /** Martyr's Crown: damage stored and seconds it has left. */
  private readonly stored: { left: number; amount: number }[] = [];
  /** Bloodrush: HP restored since it was picked. */
  private restored = 0;
  /** Clockwork Capacitor: Static stacks, px moved toward the next one, and where the owner was last frame. */
  staticStacks = 0;
  private moved = 0;
  private lastX = NaN;
  private lastY = NaN;
  /** A charged hit is under way: its explosion goes off once it lands. */
  private burst = false;
  /** Dumb Luck: stacks, and seconds left of the streak. */
  luck = 0;
  private luckLeft = 0;
  /** Statik Shiv: zaps so far. */
  private zaps = 0;
  /** Lone Hero: seconds left on each stack. */
  private readonly lone: number[] = [];
  /** Glutton's Pouch: seconds left of the damage bonus. */
  private feast = 0;
  /** Necrotic Prism: healing turned into damage, waiting for the next pulse, and seconds to it. */
  private necrotic = 0;
  private necroticTimer = 0;
  private readonly fields: Field[] = [];
  private readonly buds: Bud[] = [];
  private readonly cyclones: Cyclone[] = [];
  readonly stolen: Stolen[] = [];
  private jobs: (() => void)[] = [];
  private draining = false;
  private query: Enemy[] = [];

  constructor(
    private game: GameScene,
    readonly owner: Player,
  ) {}

  has(id: CurioId): boolean {
    return this.owned.has(id);
  }

  /** The owned curio `id`, typed, or null. */
  private get<K extends CurioId>(id: K): Curio<K> | null {
    return (this.owned.get(id) as Curio<K> | undefined) ?? null;
  }

  add(id: string): void {
    const def = curioDef(id);
    if (this.owned.has(def.id)) return;
    this.list.push(def);
    this.owned.set(def.id, def);
    const attacks: WeaponDef[] = 'attack' in def ? [def.attack] : [];
    if (def.id === 'shadows_and_dust') attacks.push(def.nova, def.pulse, def.cyclone.attack);
    for (const a of attacks) {
      const w = this.owner.weapons.instance(a);
      this.attacks.set(a.id, w);
      this.curioAttacks.add(w);
    }
    if (def.id === 'suffering_mass') this.ff = def.base;
    this.owner.recomputeStats();
  }

  /** Joiners: brings the list in line with the host's. */
  sync(ids: string[]): void {
    for (const id of ids) this.add(id);
  }

  /** Curios that can still be offered to this player. */
  available(): CurioDef[] {
    return CURIOS.filter((c) => !this.owned.has(c.id));
  }

  private attack(def: WeaponDef): WeaponInstance {
    return this.attacks.get(def.id)!;
  }

  /** True for the instances curio damage is dealt as (they set off no hit curios: no Statik Shiv on a zap). */
  isCurio(w: WeaponInstance): boolean {
    return this.curioAttacks.has(w);
  }

  // ---------------------------------------------------------------- stats

  /** Stat changes from curios (Jewel Magnet) and stolen Extra Life. */
  statSources(): OwnedPowerup[] {
    const out: OwnedPowerup[] = [];
    const magnet = this.get('jewel_magnet');
    if (magnet) out.push({ def: statsOf(magnet.id, magnet.stats), level: 1 });
    const lives = this.stolenOf('extra_life');
    if (lives.length > 0) out.push({ def: statsOf('stolen_extra_life', [{ stat: 'maxHp', percent: lives[0].health }]), level: lives.length });
    return out;
  }

  /** Suffering Mass: max HP goes to Fleeting Fantasy (in proportion) and is locked to 1. */
  adjustStats(stats: PlayerStats): void {
    const sm = this.get('suffering_mass');
    if (!sm) return;
    const max = (sm.base * stats.maxHp) / BASE_STATS.maxHp;
    if (this.ffMax > 0 && max > this.ffMax) this.ff += max - this.ffMax;
    this.ffMax = max;
    this.ff = Math.min(this.ff, max);
    stats.maxHp = 1;
  }

  /** Move speed from `base` (the stat): Cle's Walking Stick adds, Rampage and stolen Enrage and Empower Allies increase. */
  moveSpeed(base: number): number {
    const stick = this.get('walking_stick');
    const flat = stick && this.sinceHurt >= stick.delay ? stick.speed : 0;
    let inc = 0;
    const sd = this.get('shadows_and_dust');
    if (sd) inc += sd.speed * this.rampage;
    for (const s of this.stolen) if (s.def.id === 'enrage') inc += s.def.speed * this.enrage(s.def);
    inc += this.empowered()?.speed ?? 0;
    return (base + flat) * (1 + inc);
  }

  /** Ability Haste curios give a weapon: Lone Hero, stolen souls, and Still Here for melee weapons. */
  haste(def: WeaponDef): number {
    let h = 0;
    const lone = this.get('lone_hero');
    if (lone) h += lone.haste * this.lone.length;
    for (const s of this.stolen) if (s.def.id === 'soul_absorption') h += s.def.haste * s.souls;
    const still = this.get('still_here');
    if (still && hasTag(def, 'melee')) h += still.haste * this.missingPct();
    return h;
  }

  /** Chronobreak: the base cooldown `def` has instead of its own, or null. */
  cooldownFor(def: WeaponDef): number | null {
    const cb = this.get('chronobreak');
    return cb && !NO_COOLDOWN.has(def.targeting) ? cb.cooldown : null;
  }

  /** Dumb Luck's critical strike chance. */
  critBonus(): number {
    const d = this.get('dumb_luck');
    return d ? d.crit + d.per * this.luck : 0;
  }

  /** Health missing, in percent (0..100). */
  private missingPct(): number {
    const p = this.owner;
    return Math.max(0, 1 - p.hp / Math.max(1, p.stats.maxHp)) * 100;
  }

  // ---------------------------------------------------------------- dealing damage

  /**
   * What a hit of `w` on `e` is multiplied by: increased damage from curios adds up (Rampage, Chronobreak, Bloodrush,
   * Still Here, Whetstone, stolen Enrage, Empower Allies and souls), then more damage multiplies (Glutton's Pouch,
   * stolen Executioner) and a charged Clockwork Capacitor hit (used up here).
   */
  outgoing(w: WeaponInstance, e: Enemy, dot: boolean): number {
    if (this.list.length === 0 && this.stolen.length === 0) return 1;
    let inc = 0;
    const sd = this.get('shadows_and_dust');
    if (sd) inc += sd.damage * this.rampage;
    const cb = this.get('chronobreak');
    if (cb) inc += (cb.damage / 100) * this.missingPct();
    const br = this.get('bloodrush');
    if (br) inc += br.damage * Math.floor(this.restored / br.per);
    const still = this.get('still_here');
    if (still && hasTag(w.def, 'melee')) inc += still.damage * this.missingPct();
    const ws = this.get('whetstone');
    if (ws && e.hp > ws.above * e.maxHp) inc += ws.damage;
    let more = 1;
    for (const s of this.stolen) {
      const m = s.def;
      if (m.id === 'enrage') inc += m.damage * this.enrage(m);
      else if (m.id === 'soul_absorption') inc += m.damage * s.souls;
      else if (m.id === 'executioner') more *= 1 + m.more * Math.floor(Math.max(0, 1 - e.hp / e.maxHp) / m.per + 1e-6);
    }
    inc += this.empowered()?.damage ?? 0;
    const gp = this.get('gluttons_pouch');
    if (gp && this.feast > 0) more *= 1 + gp.damage;
    const cc = this.get('clockwork_capacitor');
    if (cc && !dot && this.staticStacks >= cc.max && !this.isCurio(w)) {
      this.staticStacks = 0;
      this.burst = true;
      more *= 1 + cc.bonus;
    }
    return (1 + inc) * more;
  }

  /**
   * A hit of `w` landed on `e` for `amount` (it took `dealt`), before Enemies.hit checks for a kill: The Collector,
   * then for weapon hits (not damage over time, not curio damage) Statik Shiv, Frostfire Brand, Still Here's healing
   * and a charged Clockwork Capacitor's explosion.
   */
  landed(w: WeaponInstance, e: Enemy, amount: number, dealt: number, dot: boolean): void {
    const col = this.get('the_collector');
    if (col && e.hp > 0 && !e.intervention && e.hp < col.below * e.maxHp) e.hp = 0;
    const burst = this.burst;
    this.burst = false;
    if (dot || this.isCurio(w)) return;
    const x = e.x;
    const y = e.y;
    const ss = this.get('statik_shiv');
    if (ss) {
      const level = Math.min(ss.max, Math.floor(this.zaps / ss.every));
      if (this.game.rng.float() < ss.chance + ss.more * level) {
        this.zaps++;
        const n = ss.targets + level;
        const zap = this.attack(ss.attack);
        this.jobs.push(() => {
          for (const t of this.closest(x, y, ss.range, n, e)) {
            this.game.fx.beam(x, y, t.x, t.y, 1, 0.15, zap.def.color ?? 0xffffff);
            this.game.enemies.hit(t, amount * ss.share, 0, 0, 0, zap);
          }
        });
      }
    }
    const fb = this.get('frostfire_brand');
    if (fb && e.active && this.game.time.now < e.slowUntil) {
      const burn = this.attack(fb.attack);
      this.owner.weapons.applyEffect(burn, this.owner.weapons.eff(burn), e);
    }
    const still = this.get('still_here');
    if (still && hasTag(w.def, 'melee') && dealt > 0 && this.owner.alive) {
      this.owner.heal(dealt * still.leech * this.missingPct());
    }
    const cc = this.get('clockwork_capacitor');
    if (cc && burst) {
      const bw = this.attack(cc.attack);
      this.jobs.push(() => {
        const r = this.owner.weapons.eff(bw).size;
        this.game.fx.blast(x, y, r, bw.def.color ?? 0xffffff);
        this.game.playSfx('boom', x, y);
        for (const t of this.around(x, y, r)) if (t !== e) this.game.enemies.hit(t, amount, 0, 0, 0, bw);
      });
    }
  }

  /** Kraken Slayer: every `every`-th attack of the starting weapon deals a bonus hit to each enemy it lands on. */
  weaponHit(w: WeaponInstance, e: Enemy, serial: number): void {
    const ks = this.get('kraken_slayer');
    if (!ks || w.def.id !== this.owner.character.startingWeapon || serial % ks.every !== 0) return;
    const kw = this.attack(ks.attack);
    this.jobs.push(() => {
      if (!e.active) return;
      const missing = Math.max(0, 1 - e.hp / e.maxHp) * 100;
      this.game.fx.echo(e.x, e.y, e.radius + 4, kw.def.color ?? 0xffffff);
      this.game.enemies.hit(e, this.owner.weapons.eff(kw).damage * (1 + (ks.missing / 100) * missing), 0, 0, 0, kw);
    });
  }

  /**
   * Something of the owner's killed `e` (`overkill`: damage past what it had). Kill curios go off: Rampage, Original
   * Sin, Prismatic Violence, Vaporising Catalyst, Vampirism, and for rare enemies Headhunter, Inspired Learning and
   * Glutton's Pouch; stolen Caustic Ground leaves its ground too.
   */
  onKill(e: Enemy, overkill: number): void {
    if (this.list.length === 0) return;
    const x = e.x;
    const y = e.y;
    const maxHp = e.maxHp;
    const fx = this.game.fx;
    const sd = this.get('shadows_and_dust');
    if (sd) this.addRampage(sd);
    const os = this.get('original_sin');
    if (os && overkill > 0) {
      const sw = this.attack(os.attack);
      this.jobs.push(() => {
        const t = this.closest(x, y, Infinity, 1, e)[0];
        if (!t) return;
        fx.beam(x, y, t.x, t.y, 1, 0.2, 0xff4a3a);
        this.game.enemies.hit(t, overkill * os.share, 0, 0, 0, sw);
      });
    }
    const pv = this.get('prismatic_violence');
    if (pv) {
      const pw = this.attack(pv.attack);
      this.jobs.push(() => {
        const ef = this.owner.weapons.eff(pw);
        fx.blast(x, y, ef.size, pw.def.color ?? 0xffffff);
        for (const t of this.around(x, y, ef.size)) this.game.enemies.hit(t, pv.share * maxHp * ef.damageScale, 0, 0, 0, pw);
      });
    }
    const vc = this.get('vaporising_catalyst');
    if (vc) {
      const vw = this.attack(vc.attack);
      const ef = this.owner.weapons.eff(vw);
      this.addField({ x, y, radius: ef.size, left: vc.life, slow: vc.slow, damage: ef.damage, interval: vc.interval, next: 0, weapon: vw }, vw.def.color ?? 0x8ee04a);
    }
    const vp = this.get('vampirism');
    if (vp && this.owner.alive) this.owner.heal(vp.heal * this.owner.healthMax);
    for (const s of this.stolen) {
      if (s.def.id !== 'caustic_ground') continue;
      const m = s.def;
      this.addField(
        { x, y, radius: CAUSTIC_FIELD.radius, left: m.life, slow: 0, damage: m.damage * this.owner.weapons.eff(s.weapon).damageScale, interval: m.interval, next: 0, weapon: s.weapon },
        m.color,
      );
    }
    if (e.mods.length === 0) return;
    const hh = this.get('headhunter');
    if (hh) for (const m of e.mods) this.steal(m, hh.duration, this.attack(hh.attack));
    const il = this.get('inspired_learning');
    if (il && this.list.filter((c) => c !== il && c.tier <= il.maxTier).length >= il.need) {
      this.steal(this.game.rng.pick(e.mods as EnemyModifierDef[]), il.duration, this.attack(il.attack));
    }
    const gp = this.get('gluttons_pouch');
    if (gp) {
      for (let i = 0; i < gp.potions; i++) this.game.potions.drop(x + (i - (gp.potions - 1) / 2) * 10, y - 2);
      this.feast = gp.duration;
      fx.label(x, y - 14, gp.name.toUpperCase(), 0xffb84a);
    }
  }

  /** A critical strike of the owner's (Dumb Luck). */
  onCrit(): void {
    const d = this.get('dumb_luck');
    if (!d) return;
    if (this.luck === 0) this.luckLeft = d.window;
    this.luck++;
  }

  /** A monster died (anyone's kill): stolen Soul Absorption gathers a soul when it was close. */
  onMonsterDeath(e: Enemy): void {
    const p = this.owner;
    for (const s of this.stolen) {
      if (s.def.id !== 'soul_absorption' || !p.alive) continue;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > (s.def.radius + e.radius) ** 2) continue;
      s.souls++;
      this.game.fx.beam(e.x, e.y, p.x, p.y, 1, 0.3, s.def.color);
    }
  }

  /** Chronobreak: using a weapon costs HP (never the last of it). */
  used(): void {
    const cb = this.get('chronobreak');
    const p = this.owner;
    if (!cb || !p.alive || p.god) return;
    p.hp = Math.max(1, p.hp - cb.cost * p.stats.maxHp);
    if (p === this.game.player) this.game.onPlayerHealed(p);
  }

  /** Resonance Dynamo: projectiles of `def` fly back instead of vanishing. */
  recalls(def: WeaponDef): boolean {
    return this.has('resonance_dynamo') && hasTag(def, 'projectile');
  }

  /** Runs the damage queued by hits (chains, explosions, zaps), and what that queues in turn, up to MAX_CURIO_JOBS. */
  flush(): void {
    if (this.draining || this.jobs.length === 0) return;
    this.draining = true;
    const jobs = this.jobs;
    for (let i = 0; i < jobs.length && i < MAX_CURIO_JOBS; i++) jobs[i]();
    jobs.length = 0;
    this.draining = false;
  }

  // ---------------------------------------------------------------- taking damage

  /** A stolen Blocks Attacks ignores this damage instance (rolled once per stolen copy). */
  ignores(): boolean {
    const p = this.owner;
    for (const s of this.stolen) {
      if (s.def.id !== 'blocks_attacks' || this.game.rng.float() >= s.def.chance) continue;
      this.game.fx.label(p.x, p.y - 12, 'BLOCK', s.def.color);
      return true;
    }
    return false;
  }

  /** Every damage instance is this much lower before armor (Heavy Iron). */
  get flatReduction(): number {
    return this.get('heavy_iron')?.flat ?? 0;
  }

  /**
   * What damage taken is multiplied by: Aegis Aurora, Lone Hero, stolen Physical Resistant and Enrage, and a stolen
   * Temporal Shield against hits (not `dot`) from a `source` further than its radius. At most MAX_CURIO_MITIGATION off.
   */
  takenMult(source: { x: number; y: number } | null, dot: boolean): number {
    let k = this.baseTaken();
    const p = this.owner;
    const now = this.game.time.now;
    for (const s of this.stolen) {
      const m = s.def;
      if (m.id === 'physical_resistant') k *= 1 - m.reduction;
      else if (m.id === 'enrage') k *= 1 - m.reduction * this.enrage(m);
      else if (m.id === 'temporal_shield' && !dot && source && now >= s.shieldDownUntil) {
        if ((source.x - p.x) ** 2 + (source.y - p.y) ** 2 <= (m.radius + PLAYER_RADIUS) ** 2) continue;
        k *= 1 - m.reduction;
        if (++s.shieldHits >= m.hits) {
          s.shieldHits = 0;
          s.shieldDownUntil = now + m.recharge * 1000;
          this.game.fx.ring(p.x, p.y, m.color, m.radius, 300);
        }
      }
    }
    return Math.max(1 - MAX_CURIO_MITIGATION, k);
  }

  /** Aegis Aurora and Lone Hero's share of damage taken (no source needed). */
  private baseTaken(): number {
    let k = 1;
    const aa = this.get('aegis_aurora');
    if (aa) k *= 1 - aa.mitigation;
    const lh = this.get('lone_hero');
    if (lh) k *= 1 - lh.mitigation * this.lone.length;
    return Math.max(1 - MAX_CURIO_MITIGATION, k);
  }

  /** Damage mitigation 0..1 from shields, DAMAGE TAKEN and curios (Aegis Aurora's shields are worth this). */
  private mitigation(): number {
    const p = this.owner;
    return Phaser.Math.Clamp(1 - (1 - p.weapons.reduction()) * p.stats.damageTaken * this.baseTaken(), 0, 1);
  }

  /** Shields, Fleeting Fantasy and HP together. */
  effectiveHp(): number {
    let s = 0;
    for (const sh of this.shields) s += sh.value;
    return this.owner.hp + this.ff + s;
  }

  /** What would be left of `dmg` for HP once shields and Fleeting Fantasy have taken their share. */
  hpShare(dmg: number): number {
    return Math.max(0, dmg - (this.effectiveHp() - this.owner.hp));
  }

  /** `dmg` is taken: Aegis Aurora's shields take it first, then Fleeting Fantasy. Returns what is left for HP. */
  absorb(dmg: number): number {
    for (const sh of this.shields) {
      const t = Math.min(sh.value, dmg);
      sh.value -= t;
      dmg -= t;
    }
    if (this.ffMax > 0 && dmg > 0) {
      const t = Math.min(this.ff, dmg);
      this.ff -= t;
      this.owner.runStats.taken += t;
      dmg -= t;
    }
    return dmg;
  }

  /**
   * `dmg` was taken (from `raw` before mitigation): Rampage ends, the no-damage timers start over, and Lone Hero,
   * Martyr's Crown and Aegis Aurora count it.
   */
  onDamaged(dmg: number, dot: boolean): void {
    const p = this.owner;
    this.sinceHurt = 0;
    if (this.rampage > 0) {
      this.rampage = 0;
      if (p === this.game.player) this.game.fx.label(p.x, p.y - 16, 'RAMPAGE LOST', 0x9d93b8);
    }
    const lh = this.get('lone_hero');
    if (lh && !dot) this.lone.push(lh.duration);
    const aa = this.get('aegis_aurora');
    if (aa) {
      const points = this.mitigation() * 100;
      this.shields.push({ left: aa.duration, value: aa.shield * points });
      // Only so much at once: the newest shields give way first.
      let over = this.shields.reduce((s, sh) => s + sh.value, 0) - aa.max * points;
      for (let i = this.shields.length - 1; i >= 0 && over > 0; i--) {
        const t = Math.min(this.shields[i].value, over);
        this.shields[i].value -= t;
        over -= t;
      }
    }
    const mc = this.get('martyrs_crown');
    if (mc) {
      this.stored.push({ left: mc.window, amount: mc.store * dmg });
      if (this.stored.length >= mc.triggers) {
        const total = this.stored.reduce((s, x) => s + x.amount, 0) * mc.mult;
        this.stored.length = 0;
        const mw = this.attack(mc.attack);
        const ef = p.weapons.eff(mw);
        const x = p.x;
        const y = p.y;
        this.jobs.push(() => {
          this.game.fx.blast(x, y, ef.size, mw.def.color ?? 0xffffff);
          this.game.playSfx('boom', x, y);
          for (const t of this.around(x, y, ef.size)) this.game.enemies.hit(t, total * ef.damageScale, 0, 0, 0, mw);
        });
        this.flush();
      }
    }
  }

  /** A hit of `raw` (taking `dmg`) came from `source`: Mirror Shard, stolen Thorns and Crystalline answer it. */
  answer(source: Enemy, raw: number, dmg: number): void {
    const ms = this.get('mirror_shard');
    const p = this.owner;
    const id = source.netId;
    if (ms) {
      const mw = this.attack(ms.attack);
      this.jobs.push(() => {
        const t = stillAlive(source, id);
        if (!t) return;
        this.game.fx.beam(p.x, p.y, t.x, t.y, 1, 0.15, mw.def.color ?? 0xffffff);
        this.game.enemies.hit(t, raw * ms.share, 0, 0, 0, mw);
      });
    }
    for (const s of this.stolen) {
      const m = s.def;
      if (m.id === 'thorns') {
        this.jobs.push(() => {
          const t = stillAlive(source, id);
          if (t) this.game.enemies.hit(t, m.flat + m.share * dmg, 0, 0, 0, s.weapon);
        });
      } else if (m.id === 'crystalline' && this.buds.every((b) => b.x !== source.x || b.y !== source.y)) {
        this.game.fx.warn(source.x, source.y, m.radius, m.charge, m.color);
        this.buds.push({ x: source.x, y: source.y, left: m.charge, radius: m.radius, damage: m.damage * p.weapons.eff(s.weapon).damageScale, weapon: s.weapon });
      }
    }
    this.flush();
  }

  /** True while a stolen Invulnerability of this player protects `q` (a teammate close by) from dropping below 1 HP. */
  protects(q: Player): boolean {
    const p = this.owner;
    if (q === p || !p.alive) return false;
    for (const s of this.stolen) {
      if (s.def.id === 'invulnerability' && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= (s.def.radius + PLAYER_RADIUS) ** 2) return true;
    }
    return false;
  }

  /** A stolen Spirit Walker of this player brings `q` (the owner, or a teammate close by) back once. True when it did. */
  spiritFor(q: Player): boolean {
    const p = this.owner;
    if (!p.alive && q !== p) return false;
    for (const s of this.stolen) {
      if (s.def.id !== 'spirit_walker' || s.used) continue;
      if (q !== p && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 > (s.def.radius + PLAYER_RADIUS) ** 2) continue;
      s.used = true;
      q.hp = q.stats.maxHp;
      q.curios.ff = q.curios.ffMax;
      this.game.fx.ring(q.x, q.y, SPIRIT_COLOR, 50, 450);
      this.game.playSfx('revive', q.x, q.y);
      return true;
    }
    return false;
  }

  /** Stood back up with `frac` of max HP (co-op revive, Ragebaiter): Fleeting Fantasy comes back the same share. */
  onStoodUp(frac: number): void {
    this.ff = this.ffMax * frac;
  }

  // ---------------------------------------------------------------- healing

  /** A heal of `amount` is coming: Necrotic Prism keeps its share and turns the rest into damage. */
  beforeHeal(amount: number): number {
    const np = this.get('necrotic_prism');
    if (!np) return amount;
    this.necrotic += amount * (1 - np.keep);
    return amount * np.keep;
  }

  /** `restored` HP was healed (Bloodrush counts it). */
  afterHeal(restored: number): void {
    if (this.has('bloodrush')) this.restored += restored;
  }

  /** Suffering Mass: heals go to Fleeting Fantasy. Returns what it restored. */
  restoreFantasy(amount: number): number {
    const before = this.ff;
    this.ff = Math.min(this.ffMax, this.ff + amount);
    return this.ff - before;
  }

  // ---------------------------------------------------------------- update (host)

  /** Host: timers, fields, cyclones, Static, Fleeting Fantasy, stolen modifiers. `playing` false only lets things run out. */
  update(dt: number, playing: boolean): void {
    if (this.list.length === 0) return;
    const p = this.owner;
    this.sinceHurt += dt;
    if (this.feast > 0) this.feast = Math.max(0, this.feast - dt);
    if (this.luck > 0) {
      this.luckLeft -= dt;
      if (this.luckLeft <= 0) this.luck = 0;
    }
    tick(this.lone, dt);
    for (let i = this.shields.length - 1; i >= 0; i--) {
      this.shields[i].left -= dt;
      if (this.shields[i].left <= 0 || this.shields[i].value <= 0) this.shields.splice(i, 1);
    }
    for (let i = this.stored.length - 1; i >= 0; i--) {
      this.stored[i].left -= dt;
      if (this.stored[i].left <= 0) this.stored.splice(i, 1);
    }
    const sm = this.get('suffering_mass');
    if (sm && p.alive && this.sinceHurt >= sm.delay) this.ff = Math.min(this.ffMax, this.ff + sm.regen * this.ffMax * dt);
    this.updateStatic();
    if (playing) {
      this.updateNecrotic(dt);
      this.updateFields(dt);
      this.updateBuds(dt);
      this.updateBurns();
    } else {
      this.fields.length = 0;
      this.buds.length = 0;
    }
    this.updateCyclones(dt, playing);
    this.updateStolen(dt, playing);
    this.flush();
  }

  private updateStatic(): void {
    const cc = this.get('clockwork_capacitor');
    const p = this.owner;
    if (cc && p.alive && !Number.isNaN(this.lastX)) {
      const step = Math.hypot(p.x - this.lastX, p.y - this.lastY);
      if (step < TELEPORT_STEP && this.staticStacks < cc.max) {
        this.moved += step;
        while (this.moved >= cc.per && this.staticStacks < cc.max) {
          this.moved -= cc.per;
          this.staticStacks++;
        }
        if (this.staticStacks >= cc.max) this.game.fx.ring(p.x, p.y, cc.attack.color ?? 0xffffff, 24, 300);
      }
    }
    this.lastX = p.x;
    this.lastY = p.y;
  }

  private updateNecrotic(dt: number): void {
    const np = this.get('necrotic_prism');
    if (!np) return;
    this.necroticTimer -= dt;
    if (this.necroticTimer > 0) return;
    this.necroticTimer = np.interval;
    if (this.necrotic <= 0) return;
    const amount = this.necrotic;
    this.necrotic = 0;
    const nw = this.attack(np.attack);
    const r = this.owner.weapons.eff(nw).size;
    const p = this.owner;
    this.game.fx.ring(p.x, p.y, nw.def.color ?? 0xffffff, r, 300);
    for (const t of this.around(p.x, p.y, r)) this.game.enemies.hit(t, amount, 0, 0, 0, nw);
  }

  /** Fields slow every enemy on them every frame, and hurt them every `interval` seconds. */
  private updateFields(dt: number): void {
    if (this.fields.length === 0) return;
    const now = this.game.time.now;
    let keep = 0;
    for (const f of this.fields) {
      f.left -= dt;
      f.next -= dt;
      const check = f.damage > 0 && f.next <= 0;
      if (check) f.next += f.interval;
      for (const t of this.around(f.x, f.y, f.radius)) {
        if (f.slow > 0) this.game.enemies.slow(t, f.slow, now);
        if (check) this.game.enemies.hit(t, f.damage, 0, 0, 0, f.weapon, true);
      }
      if (f.left > 0) this.fields[keep++] = f;
    }
    this.fields.length = keep;
  }

  private addField(f: Field, color: number): void {
    if (this.fields.length >= MAX_CURIO_FIELDS) this.fields.shift();
    this.fields.push(f);
    this.game.fx.vortex(f.x, f.y, f.radius, f.left, color);
  }

  private updateBuds(dt: number): void {
    let keep = 0;
    for (const b of this.buds) {
      b.left -= dt;
      if (b.left > 0) {
        this.buds[keep++] = b;
        continue;
      }
      this.game.fx.frost(b.x, b.y, b.radius, 0x9fe8ff);
      this.game.playSfx('shatter', b.x, b.y);
      for (const t of this.around(b.x, b.y, b.radius)) this.game.enemies.hit(t, b.damage, 0, 0, 0, b.weapon);
    }
    this.buds.length = keep;
  }

  /** Frostfire Brand: burning enemies are slowed. */
  private updateBurns(): void {
    const fb = this.get('frostfire_brand');
    if (!fb) return;
    const burn = this.attack(fb.attack);
    const now = this.game.time.now;
    for (const e of this.game.enemies.active) {
      if (e.active && e.effects.some((st) => st.weapon === burn)) this.game.enemies.slow(e, fb.slow, now);
    }
  }

  // ---------------------------------------------------------------- Shadows and Dust

  private addRampage(sd: Curio<'shadows_and_dust'>): void {
    const p = this.owner;
    if (!p.alive) return;
    this.rampage++;
    const fx = this.game.fx;
    if (this.rampage === sd.novaAt) {
      const nw = this.attack(sd.nova);
      const n = Math.max(1, Math.round(p.weapons.eff(nw).projectileCount));
      this.jobs.push(() => {
        for (let i = 0; i < n; i++) p.weapons.shoot(nw, p.x, p.y - 2, (i * Math.PI * 2) / n);
        this.game.playSfx('throw', p.x, p.y);
      });
      fx.label(p.x, p.y - 16, 'RAMPAGE', 0xd8d0ff);
    } else if (this.rampage === sd.pulseAt) {
      const pw = this.attack(sd.pulse);
      this.jobs.push(() => {
        const ef = p.weapons.eff(pw);
        fx.ring(p.x, p.y, pw.def.color ?? 0xffffff, ef.size, 450);
        fx.blast(p.x, p.y, ef.size * 0.5, pw.def.color ?? 0xffffff);
        this.game.playSfx('boom', p.x, p.y);
        for (const t of this.around(p.x, p.y, ef.size)) {
          const d = Math.hypot(t.x - p.x, t.y - p.y) || 1;
          this.game.enemies.hit(t, ef.damage, (t.x - p.x) / d, (t.y - p.y) / d, ef.knockback, pw);
        }
      });
      fx.label(p.x, p.y - 16, 'RAMPAGE', 0xd8d0ff);
    } else if (this.rampage === sd.cycloneAt) {
      this.addCyclone(sd, p.x, p.y);
      fx.label(p.x, p.y - 16, 'RAMPAGE', 0xd8d0ff);
    }
  }

  private addCyclone(sd: Curio<'shadows_and_dust'>, x: number, y: number): void {
    if (this.cyclones.length >= sd.cyclone.max) return;
    const ef = this.owner.weapons.eff(this.attack(sd.cyclone.attack));
    const sprite = this.game.add.sprite(x, y, ATLAS, 'px').setDepth(DEPTH.units + y / ARENA_SIZE);
    sprite.play(CYCLONE_ANIM);
    this.cyclones.push({ netId: nextNetId(), x, y, left: ef.lifetime, tick: 0, sprite });
  }

  /** Cyclones go after the closest enemy, hurt everything around them on their tick, and each kill brings another. */
  private updateCyclones(dt: number, playing: boolean): void {
    const sd = this.get('shadows_and_dust');
    if (!sd || this.cyclones.length === 0) return;
    const cw = this.attack(sd.cyclone.attack);
    const ef = this.owner.weapons.eff(cw);
    const speed = sd.cyclone.speed * this.owner.moveSpeed;
    const enemies = this.game.enemies;
    for (const c of this.cyclones.slice()) {
      c.left -= dt;
      c.tick -= dt;
      const t = enemies.nearest(c.x, c.y, Infinity);
      if (t && playing) {
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        const d = Math.hypot(dx, dy);
        const step = Math.min(d, speed * dt);
        if (d > 0) {
          c.x = Phaser.Math.Clamp(c.x + (dx / d) * step, INNER.left, INNER.right);
          c.y = Phaser.Math.Clamp(c.y + (dy / d) * step, INNER.top, INNER.bottom);
        }
      }
      if (playing && c.tick <= 0) {
        c.tick += ef.cooldown;
        for (const en of this.around(c.x, c.y, ef.size)) {
          const ex = en.x;
          const ey = en.y;
          if (enemies.hit(en, ef.damage, 0, 0, 0, cw) && enemies.lastKilled) this.addCyclone(sd, ex, ey);
        }
      }
      c.sprite.setPosition(Math.round(c.x), Math.round(c.y)).setDepth(DEPTH.units + c.y / ARENA_SIZE);
      if (c.left <= 0 || !playing) {
        c.sprite.destroy();
        this.cyclones.splice(this.cyclones.indexOf(c), 1);
      }
    }
  }

  /** Host: the cyclones to draw on joiners' screens. */
  summonViews(out: SummonView[]): void {
    for (const c of this.cyclones) out.push({ id: c.netId, anim: CYCLONE_ANIM, x: c.x, y: c.y, angle: 0, flip: false, giant: false });
  }

  // ---------------------------------------------------------------- stolen modifiers

  /** Headhunter, Inspired Learning: `m` works for the owner for `seconds` (another copy when it already has one). */
  private steal(m: EnemyModifierDef, seconds: number, weapon: WeaponInstance): void {
    const p = this.owner;
    this.stolen.push({
      def: m,
      left: seconds,
      timer: m.id === 'astral_touched' ? m.every : m.id === 'ambush' ? m.cooldown : 0,
      souls: 0,
      used: false,
      shieldHits: 0,
      shieldDownUntil: 0,
      weapon,
    });
    this.game.fx.ring(p.x, p.y, m.color, 30, 350);
    if (m.id === 'extra_life') p.recomputeStats();
  }

  private stolenOf<K extends EnemyModifierDef['id']>(id: K): Mod<K>[] {
    const out: Mod<K>[] = [];
    for (const s of this.stolen) if (s.def.id === id) out.push(s.def as Mod<K>);
    return out;
  }

  /** Bit mask (modifierBit) of the modifiers stolen right now. */
  get stolenMask(): number {
    let mask = 0;
    for (const s of this.stolen) mask |= modifierBit(s.def.id);
    return mask;
  }

  /** Seconds the longest-lasting stolen modifier has left. */
  get stolenLeft(): number {
    let left = 0;
    for (const s of this.stolen) left = Math.max(left, s.left);
    return left;
  }

  /** A stolen Hexproof: the owner cannot be slowed. */
  static hexproof(mask: number): boolean {
    return (mask & HEXPROOF) !== 0;
  }

  /** Stolen Enrage: 0..1 from missing HP. */
  private enrage(m: Mod<'enrage'>): number {
    const p = this.owner;
    return Phaser.Math.Clamp((1 - p.hp / Math.max(1, p.stats.maxHp)) / (1 - m.fullAt), 0, 1);
  }

  /** The stolen Empower Allies aura the owner stands in (its own, or a teammate's close by), if any. */
  private empowered(): Mod<'empower_allies'> | null {
    const p = this.owner;
    for (const q of this.game.players) {
      if (!q || !q.alive || !q.curios) continue;
      for (const s of q.curios.stolen) {
        if (s.def.id !== 'empower_allies') continue;
        if (q === p || (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= (s.def.radius + PLAYER_RADIUS) ** 2) return s.def;
      }
    }
    return null;
  }

  private updateStolen(dt: number, playing: boolean): void {
    if (this.stolen.length === 0) return;
    const p = this.owner;
    let lostLife = false;
    let keep = 0;
    for (const s of this.stolen) {
      s.left -= dt;
      const m = s.def;
      if (playing && p.alive) {
        if (m.id === 'astral_touched') {
          s.timer -= dt;
          if (s.timer <= 0) {
            s.timer += m.every;
            const a = this.game.rng.angle();
            const r = Math.sqrt(this.game.rng.float()) * m.spread;
            this.addField(
              { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, radius: VOID_FIELD.radius, left: m.life, slow: VOID_FIELD.slow ?? 0, damage: 0, interval: 1, next: 0, weapon: s.weapon },
              VOID_COLOR,
            );
          }
        } else if (m.id === 'ambush') {
          s.timer = Math.max(0, s.timer - dt);
          if (s.timer <= 0 && this.ambush(m)) s.timer = m.cooldown;
        }
      }
      if (s.left > 0) this.stolen[keep++] = s;
      else if (m.id === 'extra_life') lostLife = true;
    }
    this.stolen.length = keep;
    if (lostLife) p.recomputeStats();
  }

  /** Stolen Ambush: the owner jumps to `distance` px from the closest monster on screen (when further than that). */
  private ambush(m: Mod<'ambush'>): boolean {
    const p = this.owner;
    const t = this.game.enemies.nearest(p.x, p.y, VIEW_W / 2);
    if (!t) return false;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d <= m.distance) return false;
    const margin = PLAYER_RADIUS + 2;
    const x = Phaser.Math.Clamp(t.x + ((p.x - t.x) / d) * m.distance, INNER.left + margin, INNER.right - margin);
    const y = Phaser.Math.Clamp(t.y + ((p.y - t.y) / d) * m.distance, INNER.top + margin, INNER.bottom - margin);
    this.game.fx.puff(p.x, p.y, m.color, 10);
    this.game.teleport(p, x, y);
    this.game.fx.puff(x, y, m.color, 10);
    this.game.playSfx('blink', x, y);
    return true;
  }

  // ---------------------------------------------------------------- helpers

  /** Living enemies whose body is within `radius` px of (x, y). */
  private around(x: number, y: number, radius: number): Enemy[] {
    const q: Enemy[] = [];
    this.game.enemies.grid.query(x, y, radius + 24, q);
    return q.filter((en) => en.active && (en.x - x) ** 2 + (en.y - y) ** 2 <= (radius + en.radius) ** 2);
  }

  /** Up to `n` living enemies but `not` within `range` px of (x, y), closest first. */
  private closest(x: number, y: number, range: number, n: number, not: Enemy): Enemy[] {
    const found: { en: Enemy; d2: number }[] = [];
    let list = this.game.enemies.active;
    if (Number.isFinite(range)) {
      list = this.query;
      list.length = 0;
      this.game.enemies.grid.query(x, y, range + 24, list);
    }
    for (const en of new Set(list)) {
      if (en === not || !en.active) continue;
      const d2 = (en.x - x) ** 2 + (en.y - y) ** 2;
      if (d2 <= range * range) found.push({ en, d2 });
    }
    found.sort((a, b) => a.d2 - b.d2);
    return found.slice(0, n).map((f) => f.en);
  }

  /** Fallen or run over: Rampage, shields, Static, Martyr's Crown, cyclones and what is on the ground end. */
  stop(): void {
    this.rampage = 0;
    this.shields.length = 0;
    this.stored.length = 0;
    this.lone.length = 0;
    this.staticStacks = 0;
    this.moved = 0;
    this.luck = 0;
    this.feast = 0;
    this.necrotic = 0;
    this.fields.length = 0;
    this.buds.length = 0;
    this.jobs.length = 0;
    for (const c of this.cyclones) c.sprite.destroy();
    this.cyclones.length = 0;
  }

  /** Points left on Aegis Aurora's shields (HUD). */
  get shield(): number {
    let s = 0;
    for (const sh of this.shields) s += sh.value;
    return s;
  }
}

/** A curio's stat changes as one powerup level, so they add up with powerups (see computeStats). */
const statDefs = new Map<string, PowerupDef>();
function statsOf(id: string, perLevel: PowerupDef['perLevel']): PowerupDef {
  let d = statDefs.get(id);
  if (!d) {
    d = { id, name: id, description: '', icon: '', perLevel, levelText: '' };
    statDefs.set(id, d);
  }
  return d;
}

/** Counts every timer in `list` down and drops the ones that ran out. */
function tick(list: number[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    list[i] -= dt;
    if (list[i] <= 0) list.splice(i, 1);
  }
}
