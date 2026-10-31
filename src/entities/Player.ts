import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, DEPTH, ENEMY_HIT_COOLDOWN, INVULN_SECONDS, ARENA_SIZE, PLAYER_COLORS, PLAYER_TINTS } from '../constants';
import { emptyRunStats, type PlayerRunStats } from '../core/events';
import { computeStats, type OwnedItem, type OwnedMod } from '../core/progression';
import { BASE_STATS, PLAYER_RADIUS, REROLLS_PER_RUN } from '../data/player';
import type { ChainsDef, ChargeKind, ChargesDef, CharacterDef, PlayerStats } from '../data/types';
import { text } from '../ui/widgets';
import type { Passive } from '../systems/Passive';
import type { Pets } from '../systems/Pets';
import type { Ultimate } from '../systems/Ultimate';
import type { Weapons } from '../systems/Weapons';

export const CHARGE_KINDS: readonly ChargeKind[] = ['brutal', 'siphon', 'vicissitude'];
/** Past this many hit timers, the ones that ran out are cleared away. */
const MAX_HIT_COOLDOWNS = 64;

/** What the HUD shows about a character's buffs and passive. The host sends it to joiners in every snapshot. */
export interface PlayerStatus {
  /** Aegis stacks (Storm Shield). */
  aegis: number;
  /** Unstable Infusion charges held, by kind. */
  brutal: number;
  siphon: number;
  vicissitude: number;
  /** Shadow Charges (Flicker Strike). */
  shadow: number;
  /** Mistwalker amplification: total added to DAMAGE, and seconds the longest stack has left. */
  amp: number;
  ampLeft: number;
  /** Seconds until the passive can trigger again, and its stacks (Dragonborn). */
  passiveCd: number;
  stacks: number;
}

/** A playable character. The player only steers it (and casts the ultimate); weapons fire on their own. */
export class Player extends Phaser.Physics.Arcade.Sprite {
  /** 0 for solo and the host, 1..3 for joiners. */
  readonly slot: number;
  readonly character: CharacterDef;
  /** Display name (already falls back to P1..P4). */
  readonly displayName: string;
  /** Numbers for the party screen (counted on the host). */
  readonly runStats: PlayerRunStats = emptyRunStats();
  stats: PlayerStats = { ...BASE_STATS };
  hp = BASE_STATS.maxHp;
  /** Last non-zero movement direction, normalised. Some weapons aim with it. */
  readonly facing = new Phaser.Math.Vector2(1, 0);
  moving = false;
  invuln = 0;
  /** Length of the current invulnerability, for the flash timing. */
  private invulnTotal = INVULN_SECONDS;
  hurtAnim = 0;
  god = false;
  dead = false;
  /** Co-op: the player disconnected. Their character is hidden and ignored. */
  gone = false;
  /** Host: scene time (ms) until which each enemy or hazard that just hurt this character cannot hurt it again. */
  private readonly hitCooldowns = new Map<object, number>();
  weapons!: Weapons;
  ultimate!: Ultimate;
  passive!: Passive;
  /** Pets (Warren passive, Giant Bunny ultimate); empty for characters without them. */
  pets!: Pets;
  /** Aegis stacks (Storm Shield): each blocks one hit completely. */
  aegis = 0;
  /** Unstable Infusion charges: seconds left on each, oldest first, by kind. */
  readonly charges: Record<ChargeKind, number[]> = { brutal: [], siphon: [], vicissitude: [] };
  /** Shadow Charges (Flicker Strike), each spent on an extra strike. */
  shadow = 0;
  /** Mistwalker amplification stacks: seconds left and what each adds to DAMAGE. */
  readonly amps: { left: number; amount: number }[] = [];
  /** px/s this character moves at right now. The browser moving it measures it (joiners report theirs). */
  speedNow = 0;
  /** Co-op: times the host has teleported this character (Flicker Strike). Positions sent before the last are ignored. */
  teleports = 0;
  /** Joiners: the host's numbers for the HUD (null on the host and in solo, where the live values are used). */
  synced: PlayerStatus | null = null;
  items: OwnedItem[] = [];
  /** Generic powerups (stat boosts up to level 20, no slots). Stats come from items and powerups together. */
  powerups: OwnedItem[] = [];
  /** Modifications: change every weapon that shares one of their tags. */
  mods: OwnedMod[] = [];
  /** Level-up picks this player still has to make (fallen players keep collecting them). */
  pendingLevelUps = 0;
  /** Level-up rerolls left this run. */
  rerolls = REROLLS_PER_RUN;
  /** Multiplies move speed this frame (boss webs and void fields slow it); set by the scene before steering. */
  moveMult = 1;
  /**
   * Stacking slow from void fields (Astral Chains): seconds left on each stack, oldest first, the slow per stack and
   * seconds until the next stack while still in a field. Kept by the browser that moves this character.
   */
  readonly chains: number[] = [];
  private chainSlowEach = 0;
  private chainTimer = 0;
  /** Co-op, while fallen: revive progress 0..1, and the HP fraction a revive restores. */
  revive = 0;
  reviveHp = 0;
  /** Co-op: where the network says this character is (remote players are eased toward it). */
  netX = 0;
  netY = 0;
  private tag: Phaser.GameObjects.BitmapText | null = null;
  private reviveTag: Phaser.GameObjects.BitmapText | null = null;
  private readonly baseTint: number;

  constructor(scene: Phaser.Scene, x: number, y: number, slot: number, coop: boolean, character: CharacterDef, name: string) {
    super(scene, x, y, ATLAS, character.firstFrame);
    this.slot = slot;
    this.character = character;
    this.displayName = name;
    this.baseTint = coop ? PLAYER_TINTS[slot] : 0xffffff;
    this.netX = x;
    this.netY = y;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    // Circle centred on the sprite: frame is 16x20, origin 0.5.
    body.setCircle(PLAYER_RADIUS, 8 - PLAYER_RADIUS, 10 - PLAYER_RADIUS);
    this.setCollideWorldBounds(true);
    this.setTint(this.baseTint);
    this.play(this.anim('idle'));
    if (coop) {
      this.tag = text(scene, x, y - 14, name, { origin: [0.5, 1], color: PLAYER_COLORS[slot], depth: DEPTH.hpBar });
      this.reviveTag = text(scene, x, y + 16, '', { origin: [0.5, 0], color: COLOR.good, depth: DEPTH.hpBar }).setVisible(false);
    }
  }

  private anim(state: 'idle' | 'walk' | 'hurt'): string {
    return `${this.character.anim}-${state}`;
  }

  get bodyRadius(): number {
    return PLAYER_RADIUS;
  }

  /** Still in the fight: not dead and not disconnected. */
  get alive(): boolean {
    return !this.dead && !this.gone;
  }

  /** Applies new stats; extra max HP from items and powerups is added to current HP too. */
  setStats(stats: PlayerStats): void {
    const gained = stats.maxHp - this.stats.maxHp;
    this.stats = stats;
    if (gained > 0) this.hp += gained;
    this.hp = Math.min(this.hp, stats.maxHp);
  }

  /** Stats from items, powerups and the passive's stacks (Dragonborn), added up as usual. */
  recomputeStats(): void {
    this.setStats(computeStats([...this.items, ...this.powerups, ...(this.passive?.statSources() ?? [])]));
  }

  /** Mistwalker: abilities are locked, nothing can hurt it and enemies do not go after it. */
  get misted(): boolean {
    return this.ultimate?.misted ?? false;
  }

  /** Enemies and bosses can go after it. */
  get targetable(): boolean {
    return this.alive && !this.misted;
  }

  /** The DAMAGE stat with Mistwalker's amplification added. */
  get damageMult(): number {
    let amp = 0;
    for (const a of this.amps) amp += a.amount;
    return this.stats.damageMult + amp;
  }

  /** Mistwalker: amplification of `amount` for `seconds` (another stack when one is already running). */
  addAmp(amount: number, seconds: number): void {
    this.amps.push({ left: seconds, amount });
  }

  /** What `count` charges of one kind are worth: `per` charge from the owned Unstable Infusion, times its effect. */
  private chargeValue(count: number, per: (def: ChargesDef) => number): number {
    if (count <= 0) return 0;
    const inf = this.weapons?.infusion();
    const def = inf?.def.charges;
    return inf && def ? count * per(def) * (inf.stats.chargeEffect ?? 1) : 0;
  }

  /** Brutal charges: chance that a hit deals double damage. */
  get brutalChance(): number {
    return this.chargeValue(this.charges.brutal.length, (d) => d.brutal);
  }

  /** Share of damage dealt recovered as health: the stat plus Siphoning charges. */
  get lifeSteal(): number {
    return this.stats.lifeSteal + this.chargeValue(this.charges.siphon.length, (d) => d.siphon);
  }

  /** Host: life steal from a hit that dealt `dealt`. */
  lifeStealFrom(dealt: number): void {
    const ls = this.lifeSteal;
    if (ls > 0 && dealt > 0 && this.alive) this.heal(dealt * ls);
  }

  /** Unstable Infusion: a charge of `kind` for `def.duration` seconds; past `def.max` it replaces the oldest. */
  gainCharge(kind: ChargeKind, def: ChargesDef): void {
    const list = this.charges[kind];
    if (list.length >= def.max) list.shift();
    list.push(def.duration);
  }

  /** Host: charges and amplification run out. */
  updateBuffs(dt: number): void {
    for (const kind of CHARGE_KINDS) {
      const list = this.charges[kind];
      for (let i = list.length - 1; i >= 0; i--) {
        list[i] -= dt;
        if (list[i] <= 0) list.splice(i, 1);
      }
    }
    for (let i = this.amps.length - 1; i >= 0; i--) {
      this.amps[i].left -= dt;
      if (this.amps[i].left <= 0) this.amps.splice(i, 1);
    }
  }

  /** Drops every charge, Aegis and amplification (fallen, run over). */
  clearBuffs(): void {
    for (const kind of CHARGE_KINDS) this.charges[kind].length = 0;
    this.amps.length = 0;
    this.aegis = 0;
    this.shadow = 0;
  }

  /** What the HUD shows: the host's numbers on joiners, the live ones elsewhere. */
  status(): PlayerStatus {
    if (this.synced) return this.synced;
    let amp = 0;
    let ampLeft = 0;
    for (const a of this.amps) {
      amp += a.amount;
      ampLeft = Math.max(ampLeft, a.left);
    }
    return {
      aegis: this.aegis,
      brutal: this.charges.brutal.length,
      siphon: this.charges.siphon.length,
      vicissitude: this.charges.vicissitude.length,
      shadow: this.shadow,
      amp,
      ampLeft,
      passiveCd: this.passive?.cooldownLeft ?? 0,
      stacks: this.passive?.stacks ?? 0,
    };
  }

  private spinTime = 0;
  private lookLeft = false;

  /** Brief turn-around flip (the tail lash). */
  spin(): void {
    this.spinTime = 0.12;
  }

  /** Returns the HP actually restored. */
  heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
    this.runStats.healed += this.hp - before;
    return this.hp - before;
  }

  /** ix, iy: raw input in -1..1. Diagonals are normalised so they are not faster. */
  steer(ix: number, iy: number, dt: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (this.dead || this.gone) {
      body.setVelocity(0, 0);
      this.moving = false;
      this.speedNow = 0;
      this.animate(dt);
      return;
    }
    const len = Math.hypot(ix, iy);
    this.moving = len > 0;
    this.speedNow = 0;
    if (this.moving) {
      const nx = ix / len;
      const ny = iy / len;
      const speed = this.stats.moveSpeed * this.moveMult;
      body.setVelocity(nx * speed, ny * speed);
      this.facing.set(nx, ny);
      this.speedNow = speed;
    } else {
      body.setVelocity(0, 0);
    }
    this.animate(dt);
  }

  /**
   * Co-op: a character moved by someone else's input. Eases toward the last reported position
   * so 20-30 updates a second still look smooth.
   */
  follow(dt: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    const k = 1 - Math.exp(-dt * 18);
    const dx = this.netX - this.x;
    const dy = this.netY - this.y;
    if (dx * dx + dy * dy > 120 * 120) body.reset(this.netX, this.netY);
    else body.reset(this.x + dx * k, this.y + dy * k);
    this.animate(dt);
  }

  /**
   * Astral Chains: stacks run out, and while standing in a field (`def`, null when not) a new one is added every
   * `def.every` seconds, the first right away. At `def.max` a new stack replaces the oldest.
   */
  updateChains(dt: number, def: ChainsDef | null): void {
    for (let i = this.chains.length - 1; i >= 0; i--) {
      this.chains[i] -= dt;
      if (this.chains[i] <= 0) this.chains.splice(i, 1);
    }
    if (!this.alive) this.chains.length = 0;
    if (!def || !this.alive) {
      this.chainTimer = 0;
      return;
    }
    this.chainSlowEach = def.slow;
    this.chainTimer -= dt;
    while (this.chainTimer <= 0) {
      this.chainTimer += def.every;
      if (this.chains.length >= def.max) this.chains.shift();
      this.chains.push(def.duration);
    }
  }

  /** Fraction of move speed Astral Chains take off, on top of the field's own slow. */
  get chainSlow(): number {
    return this.chains.length * this.chainSlowEach;
  }

  /** Chance (0..1) that one of this player's hits is a critical strike: the stat plus passive weapons. */
  get critChance(): number {
    return Math.min(1, this.stats.critChance + this.weapons.critChance());
  }

  /** HP healed per second: flat regen plus the percent-of-max-HP regen. Not paused by taking damage. */
  get regenPerSecond(): number {
    return this.stats.regen + this.stats.regenPercent * this.stats.maxHp;
  }

  /** Server-side upkeep the host runs for every character. */
  regenerate(dt: number): void {
    const rate = this.regenPerSecond;
    if (this.alive && rate > 0 && this.hp < this.stats.maxHp) this.hp = Math.min(this.stats.maxHp, this.hp + rate * dt);
  }

  /** Facing flip, hurt flash, walk/idle animation, depth and name tag. */
  animate(dt: number): void {
    if (this.facing.x !== 0) this.lookLeft = this.facing.x < 0;
    if (this.spinTime > 0) this.spinTime -= dt;
    this.setFlipX(this.spinTime > 0 ? !this.lookLeft : this.lookLeft);

    // Invulnerability flash: white on impact, then blinking.
    if (this.invuln > 0 && !this.dead) {
      this.invuln -= dt;
      const t = this.invulnTotal - this.invuln;
      if (t < 0.08) {
        this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      } else {
        this.setTint(this.baseTint).setTintMode(Phaser.TintModes.MULTIPLY);
        this.setAlpha(Math.floor(t * 16) % 2 === 0 ? 0.35 : 1);
      }
      if (this.invuln <= 0) this.setAlpha(1);
    }

    if (!this.dead) {
      if (this.hurtAnim > 0) {
        this.hurtAnim -= dt;
      } else {
        const key = this.anim(this.moving ? 'walk' : 'idle');
        if (this.anims.currentAnim?.key !== key) this.play(key, true);
      }
    }

    this.setDepth(DEPTH.units + this.y / ARENA_SIZE);
    if (this.tag) {
      this.tag.setPosition(Math.round(this.x), Math.round(this.y - 11));
      this.tag.setVisible(!this.gone);
    }
    if (this.reviveTag) {
      const show = this.dead && !this.gone;
      this.reviveTag.setVisible(show);
      if (show) {
        this.reviveTag
          .setText(`REVIVE ${Math.round(this.reviveHp * 100)}%`)
          .setPosition(Math.round(this.x), Math.round(this.y + 15))
          .setAlpha(this.revive > 0 ? 1 : 0.7);
      }
    }
  }

  /**
   * True when a hit can reach this character: alive, not mist, and not invulnerable (`dot`, a tick of damage over
   * time such as caustic ground, ignores invulnerability).
   */
  canBeHit(dot: boolean): boolean {
    return this.alive && !this.misted && (dot || this.invuln <= 0);
  }

  /** True when `hitter` (an enemy or hazard) hurt this character less than ENEMY_HIT_COOLDOWN ago. */
  hitCooling(hitter: object, now: number): boolean {
    const until = this.hitCooldowns.get(hitter);
    return until !== undefined && now < until;
  }

  /**
   * `hitter` just tried to hurt this character, whether the hit got through or was dodged or blocked: it waits
   * ENEMY_HIT_COOLDOWN before it can try again (touching enemies would otherwise hit every frame).
   */
  markHit(hitter: object, now: number): void {
    if (this.hitCooldowns.size > MAX_HIT_COOLDOWNS) {
      for (const [k, until] of this.hitCooldowns) if (until <= now) this.hitCooldowns.delete(k);
    }
    this.hitCooldowns.set(hitter, now + ENEMY_HIT_COOLDOWN * 1000);
  }

  /**
   * The damage `raw` would deal: armor is subtracted first, then shields absorb their share, then DAMAGE TAKEN and a
   * Vicissitude charge (used up here) apply. Always at least 1.
   */
  damageFrom(raw: number): number {
    const vicissitude = Math.min(1, this.chargeValue(Math.min(1, this.charges.vicissitude.length), (d) => d.vicissitude));
    if (vicissitude > 0) this.charges.vicissitude.shift();
    return Math.max(1, Math.round((raw - this.stats.armor) * (1 - this.weapons.reduction()) * this.stats.damageTaken * (1 - vicissitude)));
  }

  /** Takes `dmg` off HP (not in god mode). A hit (not `dot`) plays the hurt animation. */
  takeDamage(dmg: number, dot: boolean): void {
    if (!dot) this.showHurt();
    if (this.god) return;
    this.runStats.taken += Math.min(this.hp, dmg);
    this.hp = Math.max(0, this.hp - dmg);
  }

  /** At least `seconds` of invulnerability from now (a longer one already running is kept). */
  grantInvuln(seconds: number): void {
    if (this.invuln >= seconds) return;
    this.invuln = this.invulnTotal = seconds;
  }

  showHurt(): void {
    this.invuln = this.invulnTotal = INVULN_SECONDS;
    this.hurtAnim = 0.2;
    this.play(this.anim('hurt'), true);
  }

  /** Falls over. Used on the host when HP runs out and on joiners when a snapshot says so. */
  fallOver(): void {
    this.dead = true;
    this.moving = false;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.play(this.anim('hurt'), true);
    this.setTint(this.baseTint).setTintMode(Phaser.TintModes.MULTIPLY);
    this.scene.tweens.add({ targets: this, alpha: 0.25, angle: 90, duration: 900, ease: 'Quad.easeIn' });
    this.tag?.setAlpha(0.4);
  }

  /** Co-op: revived by a teammate with `hpFraction` of max HP. */
  standUp(hpFraction: number, invulnSeconds: number): void {
    this.scene.tweens.killTweensOf(this);
    this.dead = false;
    this.revive = 0;
    this.setAngle(0).setAlpha(1);
    this.hp = Math.max(1, Math.round(this.stats.maxHp * hpFraction));
    this.invuln = this.invulnTotal = invulnSeconds;
    this.hurtAnim = 0;
    this.play(this.anim('idle'), true);
    this.tag?.setAlpha(1);
  }

  /** Co-op: the player left. */
  leave(): void {
    this.gone = true;
    this.disableBody(true, true);
    this.tag?.setVisible(false);
    this.reviveTag?.setVisible(false);
  }
}
