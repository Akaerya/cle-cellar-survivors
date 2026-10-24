import Phaser from 'phaser';
import {
  ARENA_SIZE,
  COLOR,
  DEPTH,
  FALLBACK_HEAL,
  MAX_ITEMS,
  MAX_LEVEL,
  MAX_WEAPONS,
  RUN_SECONDS,
  SCENES,
  SPAWN_TICK_MS,
  VIEW_H,
  VIEW_W,
} from '../constants';
import { DEBUG_EV, EV, type BuildEntry, type PartyMember, type RunSummary, type WeaponReport } from '../core/events';
import { displayName, loadProfile } from '../core/profile';
import { computeStats, expToNext, itemMaxLevel, weaponLevelText } from '../core/progression';
import { Rng, seedFromUrl } from '../core/rng';
import { sfx, type SfxName } from '../core/sfx';
import {
  ATTACK_DEFS,
  ENEMIES,
  ITEMS,
  MODIFICATIONS,
  POWERUPS,
  REVIVE,
  characterDef,
  itemDef,
  modDef,
  powerupDef,
  reviveHpPercent,
  speedScaleForMinute,
  ultimateDef,
  weaponDef,
} from '../data';
import type { Enemy } from '../entities/Enemy';
import type { Gem } from '../entities/Gem';
import { Player } from '../entities/Player';
import type { Projectile } from '../entities/Projectile';
import { Mirror, SNAPSHOT_HZ } from '../net/Mirror';
import { NET_EV, netSession, type NetSession } from '../net/Net';
import {
  EF,
  PF,
  STATE_CODES,
  Writer,
  decodeSnapshot,
  writeEntity,
  writeEvents,
  writeHeader,
  type BuildPair,
  type ClientMsg,
  type FxEvent,
  type HostMsg,
  type Profiles,
  type SnapPlayer,
  type Snapshot,
} from '../net/protocol';
import { buildArena } from '../systems/Arena';
import { Enemies } from '../systems/Enemies';
import { Fx } from '../systems/Fx';
import { Gems } from '../systems/Gems';
import { Potions } from '../systems/Potions';
import type { Potion } from '../entities/Potion';
import { Spawner } from '../systems/Spawner';
import { Ultimate } from '../systems/Ultimate';
import { Weapons, type WeaponInstance } from '../systems/Weapons';
import { onKey } from '../ui/widgets';

export type RunState = 'playing' | 'dying' | 'victory' | 'ended';

/** solo: no network. host: runs the simulation for everyone. client: draws what the host sends. */
export type RunMode = 'solo' | 'host' | 'client';

export interface Choice {
  kind: 'weapon' | 'item' | 'mod' | 'powerup' | 'heal';
  id: string;
  name: string;
  icon: string;
  /** Level after taking this card (1 for new). */
  level: number;
  /** Highest level this weapon, item, modification or powerup can reach. */
  maxLevel: number;
  isNew: boolean;
  text: string;
}

export interface HudSnapshot {
  hp: number;
  maxHp: number;
  exp: number;
  need: number;
  level: number;
  kills: number;
  time: number;
  weapons: BuildEntry[];
  items: BuildEntry[];
  mods: BuildEntry[];
  powerups: BuildEntry[];
  debug: boolean;
}

/** Where each player starts, by slot. */
const SPAWN_OFFSETS = [
  [0, 0],
  [28, 0],
  [-28, 0],
  [0, 26],
] as const;
/** Joiners report their character's position this often. */
const POS_HZ = 30;
/** Entities further than this past a joiner's view are not sent to them. */
const CULL_MARGIN = 96;
/** Effects queued for one snapshot beyond this are dropped (only under extreme load). */
const MAX_EVENTS = 400;

/**
 * The run itself: owns the players' characters, the systems, progression, and the run clock.
 * In co-op the host simulates everything and streams snapshots; joiners move their own character
 * and draw the rest from the snapshots.
 */
export class GameScene extends Phaser.Scene {
  mode: RunMode = 'solo';
  net: NetSession | null = null;
  rng!: Rng;
  /** Every player in the run, indexed by slot. */
  players: Player[] = [];
  /** The character this browser controls. */
  player!: Player;
  fx!: Fx;
  enemies!: Enemies;
  gems!: Gems;
  potions!: Potions;
  projectiles!: Phaser.Physics.Arcade.Group;
  spawner!: Spawner;
  mirror: Mirror | null = null;

  state: RunState = 'playing';
  runTime = 0;
  kills = 0;
  /** Co-op: players that have fallen this run (each later one is revived with less HP). */
  teamDeaths = 0;
  level = 1;
  exp = 0;
  expNeed = expToNext(1);
  debug = false;
  /** Co-op: the run is held while players pick level-up cards. */
  frozen = false;
  /** Level-up cards on offer to the local player. */
  offer: { choices: Choice[]; pending: number } | null = null;
  /** Host: cards on offer to each joiner, by slot. */
  private remoteOffers = new Map<number, Choice[]>();
  private inLevelUp = false;
  private outbox: FxEvent[] = [];
  private writer = new Writer();
  private snapTimer = 0;
  private posTimer = 0;
  private startCount = 1;

  private keys!: {
    up: Phaser.Input.Keyboard.Key[];
    down: Phaser.Input.Keyboard.Key[];
    left: Phaser.Input.Keyboard.Key[];
    right: Phaser.Input.Keyboard.Key[];
  };
  private hpBar!: Phaser.GameObjects.Graphics;
  private lastSecond = -1;
  private camTarget: Player | null = null;
  private diedAt = 0;
  private debugTimer = 0;

  constructor() {
    super(SCENES.game);
  }

  get coop(): boolean {
    return this.mode !== 'solo';
  }

  /** Players still connected (alive or dead): drives enemy HP scaling. */
  get playerCount(): number {
    return Math.max(1, this.players.filter((p) => p && !p.gone).length);
  }

  livePlayers(): Player[] {
    return this.players.filter((p) => p && p.alive);
  }

  init(): void {
    // The scene object is reused across restarts, so every run field is reset here.
    this.players = [];
    this.mirror = null;
    this.state = 'playing';
    this.runTime = 0;
    this.kills = 0;
    this.level = 1;
    this.exp = 0;
    this.expNeed = expToNext(1);
    this.lastSecond = -1;
    this.teamDeaths = 0;
    this.camTarget = null;
    this.diedAt = 0;
    this.debugTimer = 0;
    this.frozen = false;
    this.offer = null;
    this.remoteOffers.clear();
    this.inLevelUp = false;
    this.outbox = [];
    this.snapTimer = 0;
    this.posTimer = 0;
  }

  /** Solo: the saved profile picks the character. Co-op: `slots` and `profiles` come from the host. */
  create(data: { seed?: string; slots?: number[]; profiles?: Profiles }): void {
    const net = data?.slots ? netSession() : null;
    this.net = net;
    this.mode = !net ? 'solo' : net.isHost ? 'host' : 'client';
    const slots = net ? data.slots! : [0];
    const profiles: Profiles = net ? (data.profiles ?? {}) : { 0: loadProfile() };
    this.startCount = slots.length;

    this.rng = new Rng(data?.seed ?? seedFromUrl());
    this.physics.world.setBounds(0, 0, ARENA_SIZE, ARENA_SIZE);

    const arena = buildArena(this, this.rng);
    this.projectiles = Weapons.createProjectileGroup(this);
    for (const slot of slots) {
      const [ox, oy] = this.coop ? SPAWN_OFFSETS[slot] : SPAWN_OFFSETS[0];
      const character = characterDef(profiles[slot]?.character);
      const name = displayName(profiles[slot]?.name, slot);
      const p = new Player(this, ARENA_SIZE / 2 + ox, ARENA_SIZE / 2 + oy, slot, this.coop, character, name);
      p.weapons = new Weapons(this, p, this.projectiles);
      p.weapons.add(character.startingWeapon);
      p.ultimate = new Ultimate(this, p, ultimateDef(character.ultimate));
      this.players[slot] = p;
    }
    this.player = this.players[net?.mySlot ?? 0];
    this.fx = new Fx(this);
    this.enemies = new Enemies(this);
    this.gems = new Gems(this);
    this.potions = new Potions(this);
    this.spawner = new Spawner(this);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, ARENA_SIZE, ARENA_SIZE);
    this.followCamera(this.player);
    cam.setRoundPixels(true);
    cam.setBackgroundColor(0x120d18);

    if (this.mode === 'client') {
      // Joiners only move their own character; the host decides every hit.
      this.physics.add.collider(this.player, arena.walls);
      this.mirror = new Mirror(this);
    } else {
      // Physics: walls block the players and enemies; overlaps drive damage and pickups.
      this.physics.add.collider(this.enemies.group, arena.walls);
      this.physics.add.overlap(this.projectiles, this.enemies.group, (pr, e) =>
        this.onProjectileHit(pr as Projectile, e as Enemy),
      );
      for (const p of this.players.filter(Boolean)) {
        this.physics.add.collider(p, arena.walls);
        this.physics.add.overlap(p, this.enemies.group, (_p, e) => this.onTouchEnemy(p, e as Enemy));
        this.physics.add.overlap(p, this.gems.group, (_p, g) => this.gems.collect(g as Gem, p));
      }
      // Scene clock: pausing this scene pauses the spawner too.
      this.time.addEvent({ delay: SPAWN_TICK_MS, loop: true, callback: () => this.spawner.tick() });
      this.spawner.tick();
    }
    if (this.mode === 'host') this.fx.relay = (ev) => this.relay(ev);

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: [kb.addKey(K.W), kb.addKey(K.UP)],
      down: [kb.addKey(K.S), kb.addKey(K.DOWN)],
      left: [kb.addKey(K.A), kb.addKey(K.LEFT)],
      right: [kb.addKey(K.D), kb.addKey(K.RIGHT)],
    };
    kb.addKey(K.F3); // captured so the browser's find bar does not open
    onKey(this, 'keydown-ESC', () => this.openPause());
    onKey(this, 'keydown-P', () => this.openPause());
    onKey(this, 'keydown-M', () => this.events.emit(EV.banner, sfx.toggleMute() ? 'SOUND OFF' : 'SOUND ON', COLOR.textDim));
    onKey(this, 'keydown-F3', () => this.toggleDebug());
    onKey(this, 'keydown-Q', () => this.castUltimate());

    this.hpBar = this.add.graphics().setDepth(DEPTH.hpBar);

    // Solo pauses automatically when the window loses focus; co-op cannot pause for everyone.
    const onBlur = () => {
      if (!this.coop) this.openPause();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);

    const listen: [string, (...a: any[]) => void][] = [
      [DEBUG_EV.spawn, () => this.mode !== 'client' && this.spawner.spawnBurst(50)],
      [DEBUG_EV.addExp, () => this.mode !== 'client' && this.addExp(this.expNeed - this.exp)],
      [DEBUG_EV.skipMinute, () => this.mode !== 'client' && (this.runTime = Math.min(RUN_SECONDS - 1, this.runTime + 60))],
      [DEBUG_EV.god, () => this.mode !== 'client' && (this.player.god = !this.player.god)],
      [DEBUG_EV.ultReady, () => this.mode !== 'client' && this.players.forEach((p) => p && (p.ultimate.cooldownLeft = 0))],
      [DEBUG_EV.toggle, () => this.toggleDebug()],
    ];
    for (const [ev, fn] of listen) this.events.on(ev, fn);

    const netListen: [string, (...a: any[]) => void][] = [];
    if (net) {
      if (this.mode === 'host') {
        netListen.push([NET_EV.clientMsg, (slot: number, msg: ClientMsg) => this.onClientMsg(slot, msg)]);
        netListen.push([NET_EV.peerLeft, (slot: number) => this.onPeerLeft(slot)]);
        // Joiners that dropped while the run was loading.
        for (const slot of slots) if (slot !== 0 && !net.remoteSlots.includes(slot)) this.onPeerLeft(slot);
      } else {
        netListen.push([NET_EV.snapshot, (buf: ArrayBuffer) => this.onSnapshot(decodeSnapshot(buf))]);
        netListen.push([NET_EV.hostMsg, (msg: HostMsg) => this.onHostMsg(msg)]);
      }
      for (const [ev, fn] of netListen) net.events.on(ev, fn);
    }

    this.events.once('shutdown', () => {
      for (const [ev, fn] of listen) this.events.off(ev, fn);
      if (net) for (const [ev, fn] of netListen) net.events.off(ev, fn);
      this.game.events.off(Phaser.Core.Events.BLUR, onBlur);
      this.fx.relay = null;
    });

    if (this.debug) this.applyDebugDraw();
    (window as any).__cleCellar = this;

    // A fresh run never inherits an overlay from the previous one.
    for (const key of [SCENES.levelUp, SCENES.pause, SCENES.gameOver, SCENES.wiki]) {
      if (this.scene.isActive(key) || this.scene.isPaused(key)) this.scene.stop(key);
    }
    this.scene.stop(SCENES.ui);
    this.scene.launch(SCENES.ui);
  }

  update(_t: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000;
    if (this.state === 'ended') return;

    // Input. In co-op the pause menu does not stop the run, so it just lets go of the controls.
    const k = this.keys;
    const down = (list: Phaser.Input.Keyboard.Key[]) => list.some((key) => key.isDown);
    const held = !this.frozen && !this.menuOpen;
    const ix = held ? (down(k.right) ? 1 : 0) - (down(k.left) ? 1 : 0) : 0;
    const iy = held ? (down(k.down) ? 1 : 0) - (down(k.up) ? 1 : 0) : 0;
    this.player.steer(ix, iy, dt);

    if (this.mode === 'client') {
      this.updateClient(dt);
      return;
    }

    for (const p of this.players) {
      if (!p || p === this.player || p.gone) continue;
      p.follow(dt);
    }

    if (!this.frozen) {
      const playing = this.state === 'playing';
      for (const p of this.players) p?.regenerate(dt);
      if (playing) {
        this.runTime += dt;
        this.spawner.checkEvents(this.runTime);
        if (this.runTime >= RUN_SECONDS) this.victory();
      }

      const speedScale = speedScaleForMinute(this.runTime / 60);
      this.enemies.update(dt, this.time.now, this.livePlayers(), this.state === 'dying', speedScale);
      for (const p of this.players) if (p?.alive) p.weapons.update(dt, this.state === 'playing');
      if (playing) this.enemies.updateEffects(dt);
      for (const p of this.players) if (p && !p.gone) p.ultimate.update(dt, p.alive && this.state === 'playing');
      Weapons.updateProjectiles(this.projectiles, dt);
      this.gems.update(dt);
      this.potions.update(dt);
      if (this.state === 'playing') this.updateRevives(dt);
    }
    this.fx.update(dt);
    this.updateCamera();
    this.drawHpBars();
    this.emitTime();
    this.updateDebug(dt);

    if (this.mode === 'host') {
      this.snapTimer -= dt;
      if (this.snapTimer <= 0) {
        this.snapTimer += 1 / SNAPSHOT_HZ;
        if (this.snapTimer < 0) this.snapTimer = 0;
        this.sendSnapshots();
      }
    }

    if (!this.inLevelUp && this.state === 'playing' && this.livePlayers().some((p) => p.pendingLevelUps > 0)) {
      this.beginLevelUp();
    }
  }

  /** Pause menu or wiki over the run (co-op keeps running underneath). */
  private get menuOpen(): boolean {
    const open = (k: string) => this.scene.isActive(k) || this.scene.isPaused(k);
    return open(SCENES.pause) || open(SCENES.wiki);
  }

  /** Co-op: closes the menu and wiki when the run needs the screen (level-up, end). */
  private closeMenus(): void {
    for (const k of [SCENES.wiki, SCENES.pause]) if (this.scene.isActive(k) || this.scene.isPaused(k)) this.scene.stop(k);
  }

  private emitTime(): void {
    const sec = Math.floor(this.runTime);
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      this.events.emit(EV.timeChanged, this.runTime);
    }
  }

  private updateDebug(dt: number): void {
    if (!this.debug) return;
    this.debugTimer -= dt;
    if (this.debugTimer <= 0) {
      this.debugTimer = 0.25;
      this.events.emit(EV.debugStats, this.debugStats());
    }
  }

  // ------------------------------------------------------------------ effects and sound

  /** Co-op host: queues an effect for the joiners' next snapshot. */
  relay(ev: FxEvent): void {
    if (this.mode === 'host' && this.outbox.length < MAX_EVENTS) this.outbox.push(ev);
  }

  /** Plays a sound here (if it happened near this player) and relays it to joiners. */
  playSfx(name: SfxName, x?: number, y?: number): void {
    if (x === undefined || y === undefined) {
      sfx.play(name);
      this.relay(['s', name]);
      return;
    }
    if (this.nearView(this.player, x, y)) sfx.play(name);
    this.relay(['s', name, Math.round(x), Math.round(y)]);
  }

  banner(text: string, color: number): void {
    this.events.emit(EV.banner, text, color);
    this.relay(['b', text, color]);
  }

  /** The character whose view a player sees: their own, or a living teammate's once they fall. */
  viewTarget(p: Player): Player {
    if (!p.dead || !this.coop) return p;
    return this.livePlayers()[0] ?? p;
  }

  /** True when (x, y) is on the screen of player `p` (the camera stops at the arena edges), widened by `margin` px. */
  onScreen(p: Player, x: number, y: number, margin = 0): boolean {
    const t = this.viewTarget(p);
    const cx = Phaser.Math.Clamp(t.x, VIEW_W / 2, ARENA_SIZE - VIEW_W / 2);
    const cy = Phaser.Math.Clamp(t.y, VIEW_H / 2, ARENA_SIZE - VIEW_H / 2);
    return Math.abs(x - cx) < VIEW_W / 2 + margin && Math.abs(y - cy) < VIEW_H / 2 + margin;
  }

  private nearView(p: Player, x: number, y: number): boolean {
    return this.onScreen(p, x, y, CULL_MARGIN);
  }

  // ------------------------------------------------------------------ combat

  private onProjectileHit(pr: Projectile, e: Enemy): void {
    pr.weapon.owner.weapons.onProjectileHit(pr, e);
  }

  private onTouchEnemy(p: Player, e: Enemy): void {
    if (this.state !== 'playing' || this.frozen || !e.active || !p.alive) return;
    const dmg = p.takeHit(e.def.damage);
    if (dmg <= 0) return;
    this.relay(['h', p.slot, dmg]);
    if (p === this.player) this.onLocalHurt(dmg);
    if (p.hp <= 0) this.die(p);
  }

  private onLocalHurt(dmg: number): void {
    sfx.play('hurt');
    this.cameras.main.shake(110, 0.006);
    this.events.emit(EV.playerHurt, dmg);
    this.events.emit(EV.hpChanged, this.player.hp, this.player.stats.maxHp);
  }

  onEnemyKilled(): void {
    this.kills++;
    this.events.emit(EV.killsChanged, this.kills);
  }

  /** Shared EXP: every level gained gives each player one pick. */
  addExp(value: number): void {
    this.exp += value;
    let leveled = false;
    while (this.exp >= this.expNeed) {
      this.exp -= this.expNeed;
      this.level++;
      // Fallen players collect their picks too and make them once revived.
      for (const p of this.players) if (p && !p.gone) p.pendingLevelUps++;
      this.expNeed = expToNext(this.level);
      leveled = true;
    }
    this.events.emit(EV.expChanged, this.exp, this.expNeed, this.level);
    if (leveled) this.events.emit(EV.levelUp, this.level);
  }

  // ------------------------------------------------------------------ level-ups

  private beginLevelUp(): void {
    this.inLevelUp = true;
    this.playSfx('levelup');
    for (const p of this.livePlayers()) this.fx.ring(p.x, p.y, COLOR.gold, 70, 450);
    if (this.mode === 'solo') {
      this.scene.pause();
    } else {
      this.closeMenus();
      this.setFrozen(true);
      for (const p of this.livePlayers()) if (p !== this.player && p.pendingLevelUps > 0) this.offerTo(p);
    }
    if (this.player.pendingLevelUps > 0) this.offerTo(this.player);
    if (!this.scene.isActive(SCENES.levelUp)) this.scene.launch(SCENES.levelUp);
  }

  private offerTo(p: Player): void {
    const choices = this.rollChoices(p);
    if (p === this.player) {
      this.offer = { choices, pending: p.pendingLevelUps };
      this.events.emit(EV.levelUpOffer);
    } else {
      this.remoteOffers.set(p.slot, choices);
      this.net?.sendTo(p.slot, { t: 'choices', choices, pending: p.pendingLevelUps });
    }
  }

  /** The local player picked card `index` of the current offer. */
  chooseCard(index: number): void {
    const offer = this.offer;
    if (!offer) return;
    this.offer = null;
    if (this.mode === 'client') {
      this.net?.sendHost({ t: 'pick', index });
      return;
    }
    const c = offer.choices[index];
    if (!c) return;
    this.applyChoice(this.player, c);
    this.afterPick(this.player);
  }

  private afterPick(p: Player): void {
    if (p.pendingLevelUps > 0 && p.alive) {
      this.offerTo(p);
      return;
    }
    if (p === this.player) this.events.emit(EV.levelUpWaiting);
    else this.net?.sendTo(p.slot, { t: 'choicesDone' });
    this.checkLevelUpOver();
  }

  private checkLevelUpOver(): void {
    if (!this.inLevelUp) return;
    if (this.livePlayers().some((p) => p.pendingLevelUps > 0)) return;
    this.inLevelUp = false;
    this.remoteOffers.clear();
    this.offer = null;
    if (this.mode === 'host') {
      this.setFrozen(false);
      this.net?.broadcast({ t: 'levelUpOver' });
    }
    this.events.emit(EV.levelUpOver);
  }

  /** Co-op stand-in for pausing: the scene keeps running so the network keeps flowing. */
  private setFrozen(on: boolean): void {
    this.frozen = on;
    this.time.paused = on;
    if (on) this.physics.world.pause();
    else this.physics.world.resume();
  }

  /**
   * Up to 3 random cards from the character's weapons, the shared items, modifications, generic powerups
   * and upgrades of owned ones, respecting slot limits. A modification is only offered new while the player
   * owns a weapon it changes.
   */
  rollChoices(p: Player): Choice[] {
    const pool: Choice[] = [];
    const weaponSlotsFull = p.weapons.list.length >= MAX_WEAPONS;
    const itemSlotsFull = p.items.length >= MAX_ITEMS;
    for (const def of p.character.weapons.map(weaponDef)) {
      const owned = p.weapons.get(def.id);
      if (owned) {
        if (owned.level < MAX_LEVEL) {
          pool.push({
            kind: 'weapon',
            id: def.id,
            name: def.name,
            icon: def.icon,
            level: owned.level + 1,
            maxLevel: MAX_LEVEL,
            isNew: false,
            text: weaponLevelText(def, owned.level + 1),
          });
        }
      } else if (!weaponSlotsFull) {
        pool.push({ kind: 'weapon', id: def.id, name: def.name, icon: def.icon, level: 1, maxLevel: MAX_LEVEL, isNew: true, text: weaponLevelText(def, 1) });
      }
    }
    const stat = (kind: 'item' | 'powerup', list: typeof ITEMS, owned: typeof p.items, slotsFull: boolean) => {
      for (const def of list) {
        const max = itemMaxLevel(def);
        const have = owned.find((i) => i.def.id === def.id);
        if (have) {
          if (have.level < max) {
            pool.push({ kind, id: def.id, name: def.name, icon: def.icon, level: have.level + 1, maxLevel: max, isNew: false, text: def.levelText });
          }
        } else if (!slotsFull) {
          pool.push({ kind, id: def.id, name: def.name, icon: def.icon, level: 1, maxLevel: max, isNew: true, text: def.description });
        }
      }
    };
    stat('item', ITEMS, p.items, itemSlotsFull);
    const tags = new Set(p.weapons.list.flatMap((w) => w.def.tags ?? []));
    for (const def of MODIFICATIONS) {
      const max = def.levels.length;
      const have = p.mods.find((m) => m.def.id === def.id);
      if (have) {
        if (have.level < max) {
          pool.push({ kind: 'mod', id: def.id, name: def.name, icon: def.icon, level: have.level + 1, maxLevel: max, isNew: false, text: def.levels[have.level].text });
        }
      } else if (def.tags.some((t) => tags.has(t))) {
        pool.push({ kind: 'mod', id: def.id, name: def.name, icon: def.icon, level: 1, maxLevel: max, isNew: true, text: def.description });
      }
    }
    stat('powerup', POWERUPS, p.powerups, false);
    if (pool.length === 0) {
      return [
        {
          kind: 'heal',
          id: 'heal',
          name: 'Banana Bunch',
          icon: 'icon_heal',
          level: 0,
          maxLevel: 0,
          isNew: false,
          text: `Everything is maxed. Heal ${FALLBACK_HEAL} HP.`,
        },
      ];
    }
    return this.rng.shuffled(pool).slice(0, 3);
  }

  applyChoice(p: Player, c: Choice): void {
    if (c.kind === 'weapon') {
      if (p.weapons.get(c.id)) p.weapons.levelUp(c.id);
      else p.weapons.add(c.id);
    } else if (c.kind === 'item' || c.kind === 'powerup') {
      const list = c.kind === 'item' ? p.items : p.powerups;
      const owned = list.find((i) => i.def.id === c.id);
      if (owned) owned.level++;
      else list.push({ def: c.kind === 'item' ? itemDef(c.id) : powerupDef(c.id), level: 1 });
      p.setStats(computeStats([...p.items, ...p.powerups]));
    } else if (c.kind === 'mod') {
      const owned = p.mods.find((m) => m.def.id === c.id);
      if (owned) owned.level++;
      else p.mods.push({ def: modDef(c.id), level: 1 });
      p.weapons.refreshMods();
    } else {
      p.heal(FALLBACK_HEAL);
    }
    p.pendingLevelUps = Math.max(0, p.pendingLevelUps - 1);
    if (this.mode === 'host') this.net?.broadcast(this.buildMsg(p));
    if (p === this.player) {
      this.emitBuild();
      this.events.emit(EV.hpChanged, this.player.hp, this.player.stats.maxHp);
    }
  }

  private emitBuild(): void {
    const p = this.player;
    this.events.emit(EV.buildChanged, this.buildWeapons(p), this.buildItems(p), this.buildMods(p), this.buildPowerups(p));
  }

  buildWeapons(p: Player = this.player): BuildEntry[] {
    return p.weapons.list.map((w) => ({ id: w.def.id, name: w.def.name, icon: w.def.icon, level: w.level, max: MAX_LEVEL, damage: Math.round(w.damage) }));
  }

  buildItems(p: Player = this.player): BuildEntry[] {
    return p.items.map((i) => ({ id: i.def.id, name: i.def.name, icon: i.def.icon, level: i.level, max: itemMaxLevel(i.def) }));
  }

  buildMods(p: Player = this.player): BuildEntry[] {
    return p.mods.map((m) => ({ id: m.def.id, name: m.def.name, icon: m.def.icon, level: m.level, max: m.def.levels.length }));
  }

  buildPowerups(p: Player = this.player): BuildEntry[] {
    return p.powerups.map((i) => ({ id: i.def.id, name: i.def.name, icon: i.def.icon, level: i.level, max: itemMaxLevel(i.def) }));
  }

  hudSnapshot(): HudSnapshot {
    return {
      hp: this.player.hp,
      maxHp: this.player.stats.maxHp,
      exp: this.exp,
      need: this.expNeed,
      level: this.level,
      kills: this.kills,
      time: this.runTime,
      weapons: this.buildWeapons(),
      items: this.buildItems(),
      mods: this.buildMods(),
      powerups: this.buildPowerups(),
      debug: this.debug,
    };
  }

  // ------------------------------------------------------------------ run flow

  /** Q: the local player's ultimate. Joiners ask the host, which checks the cooldown. */
  private castUltimate(): void {
    if (this.state !== 'playing' || this.frozen || this.menuOpen || !this.player.alive) return;
    if (this.mode === 'client') {
      if (this.player.ultimate.ready) this.net?.sendHost({ t: 'ult' });
      return;
    }
    this.player.ultimate.cast();
  }

  openPause(): void {
    if (this.state !== 'playing' || !this.scene.isActive() || this.scene.isActive(SCENES.levelUp)) return;
    if (this.menuOpen) return;
    sfx.play('pause');
    if (!this.coop) this.scene.pause();
    this.scene.launch(SCENES.pause);
  }

  private die(p: Player): void {
    p.fallOver();
    p.weapons.clearVisuals();
    p.ultimate.stop();
    p.runStats.deaths++;
    this.playSfx('death', p.x, p.y);
    if (this.coop) {
      this.teamDeaths++;
      p.revive = 0;
      p.reviveHp = reviveHpPercent(this.teamDeaths);
      // Cards still on offer wait until the player is revived.
      this.remoteOffers.delete(p.slot);
      if (p === this.player) this.offer = null;
      this.checkLevelUpOver();
    }
    if (p === this.player) this.onLocalDeath();
    if (this.livePlayers().length > 0) {
      if (this.coop) this.banner(`${p.displayName} IS DOWN · STAND ON THEM TO REVIVE`, COLOR.bad);
      return;
    }
    this.state = 'dying';
    this.stopEffects();
    this.time.delayedCall(1300, () => this.endRun(false));
  }

  private onLocalDeath(): void {
    if (this.coop && this.scene.isActive(SCENES.levelUp)) this.scene.stop(SCENES.levelUp);
    this.cameras.main.shake(300, 0.012);
    this.diedAt = this.time.now;
    this.events.emit(EV.hpChanged, 0, this.player.stats.maxHp);
  }

  /** Co-op host: a living player standing on a fallen one fills its revive bar. */
  private updateRevives(dt: number): void {
    if (!this.coop) return;
    const live = this.livePlayers();
    const R2 = REVIVE.radius * REVIVE.radius;
    for (const p of this.players) {
      if (!p || !p.dead || p.gone) continue;
      const helpers = live.filter((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= R2);
      const rate = dt / REVIVE.seconds;
      p.revive = Phaser.Math.Clamp(p.revive + (helpers.length > 0 ? rate : -rate * REVIVE.drainRate), 0, 1);
      if (p.revive >= 1) {
        for (const q of helpers) q.runStats.revives++;
        this.revivePlayer(p);
      }
    }
  }

  private revivePlayer(p: Player): void {
    p.standUp(p.reviveHp, REVIVE.invulnSeconds);
    this.onRevived(p);
    this.playSfx('revive', p.x, p.y);
    this.fx.ring(p.x, p.y, COLOR.good, 60, 500);
    this.banner(`${p.displayName} IS BACK (${Math.round(p.reviveHp * 100)}% HP)`, COLOR.good);
  }

  /** Weapon and ultimate visuals off for everyone (the run is ending). */
  private stopEffects(): void {
    for (const p of this.players) {
      if (!p) continue;
      p.weapons.clearVisuals();
      p.ultimate.stop();
    }
  }

  /** Shared by host and joiners once a player stands up again. */
  private onRevived(p: Player): void {
    p.weapons.showVisuals();
    if (p === this.player) this.events.emit(EV.hpChanged, p.hp, p.stats.maxHp);
  }

  private followCamera(t: Player): void {
    this.camTarget = t;
    const lerp = t === this.player ? 0.2 : 0.1;
    this.cameras.main.startFollow(t, true, lerp, lerp);
  }

  /** Own character, or a living teammate's a moment after falling in co-op. */
  private updateCamera(): void {
    let t = this.player;
    if (this.player.dead && this.coop && this.time.now - this.diedAt > 1200) t = this.viewTarget(this.player);
    if (t !== this.camTarget) this.followCamera(t);
  }

  onPlayerHealed(p: Player): void {
    if (p === this.player) this.events.emit(EV.hpChanged, p.hp, p.stats.maxHp);
  }

  private victory(): void {
    this.state = 'victory';
    this.runTime = RUN_SECONDS;
    this.playSfx('victory');
    this.cameras.main.flash(900, 255, 236, 190);
    this.relay(['f', 900]);
    this.stopEffects();
    let puffs = 0;
    for (const e of this.enemies.active.slice()) {
      if (!e.active) continue;
      if (puffs++ < 120) this.fx.puff(e.x, e.y, 0xffe6a0, 6);
      this.enemies.kill(e, false);
    }
    this.banner('DAWN BREAKS', COLOR.gold);
    this.time.delayedCall(2200, () => this.endRun(true));
  }

  /** One weapon (or the ultimate) for the party screen. */
  private weaponReport(w: WeaponInstance, ultimate = false): WeaponReport {
    return {
      id: w.def.id,
      name: w.def.name,
      icon: w.def.icon,
      level: ultimate ? 0 : w.level,
      damage: Math.round(w.damage),
      kills: w.kills,
      dps: w.damage / Math.max(1, this.runTime - w.acquiredAt),
      ultimate: ultimate || undefined,
    };
  }

  /** Everyone's numbers for the party screen (host and solo: the only copy of them). */
  private partyReport(): PartyMember[] {
    return this.players
      .filter((p) => p)
      .map((p) => ({
        slot: p.slot,
        name: p.displayName,
        character: p.character.id,
        left: p.gone,
        stats: { ...p.runStats, damage: Math.round(p.runStats.damage), taken: Math.round(p.runStats.taken), healed: Math.round(p.runStats.healed), exp: Math.round(p.runStats.exp) },
        dps: p.runStats.damage / Math.max(1, this.runTime),
        weapons: [...p.weapons.list.map((w) => this.weaponReport(w)), this.weaponReport(p.ultimate.attack, true)],
        items: this.buildItems(p),
        mods: this.buildMods(p),
        powerups: this.buildPowerups(p),
      }));
  }

  private summaryFor(p: Player, victory: boolean, party: PartyMember[]): RunSummary {
    return {
      victory,
      time: this.runTime,
      level: this.level,
      kills: this.kills,
      party,
      mySlot: p.slot,
      seed: this.rng.seed,
      coopPlayers: this.coop ? this.startCount : undefined,
      teamDeaths: this.coop ? this.teamDeaths : undefined,
    };
  }

  private endRun(victory: boolean, summary?: RunSummary): void {
    if (this.state === 'ended') return;
    const party = summary ? summary.party : this.partyReport();
    if (this.mode === 'host') {
      // Final snapshot so joiners see the last moment, then everyone's own end screen.
      this.sendSnapshots();
      for (const p of this.players) {
        if (p && p !== this.player && !p.gone) this.net?.sendTo(p.slot, { t: 'end', summary: this.summaryFor(p, victory, party) });
      }
    }
    this.state = 'ended';
    this.events.emit(EV.runEnded);
    this.scene.stop(SCENES.ui);
    if (this.scene.isActive(SCENES.levelUp)) this.scene.stop(SCENES.levelUp);
    this.closeMenus();
    this.scene.pause();
    this.scene.launch(SCENES.gameOver, summary ?? this.summaryFor(this.player, victory, party));
  }

  // ------------------------------------------------------------------ co-op: host side

  private onClientMsg(slot: number, msg: ClientMsg): void {
    const p = this.players[slot];
    if (!p || p.gone) return;
    if (msg.t === 'pos') {
      p.netX = Phaser.Math.Clamp(Number(msg.x) || 0, 0, ARENA_SIZE);
      p.netY = Phaser.Math.Clamp(Number(msg.y) || 0, 0, ARENA_SIZE);
      if (msg.fx || msg.fy) p.facing.set(msg.fx, msg.fy).normalize();
      p.moving = msg.m === 1 && p.alive;
    } else if (msg.t === 'pick') {
      const offer = this.remoteOffers.get(slot);
      const c = offer?.[msg.index];
      if (!c || !this.inLevelUp) return;
      this.remoteOffers.delete(slot);
      this.applyChoice(p, c);
      this.afterPick(p);
    } else if (msg.t === 'ult') {
      if (this.state === 'playing' && !this.frozen) p.ultimate.cast();
    }
  }

  private onPeerLeft(slot: number): void {
    const p = this.players[slot];
    if (!p || p.gone) return;
    p.leave();
    p.weapons.destroy();
    p.ultimate.destroy();
    p.pendingLevelUps = 0;
    this.remoteOffers.delete(slot);
    if (this.state === 'ended') return;
    this.banner(`${p.displayName} LEFT THE GAME`, COLOR.textDim);
    this.checkLevelUpOver();
  }

  private buildMsg(p: Player): HostMsg {
    return {
      t: 'build',
      slot: p.slot,
      weapons: p.weapons.list.map((w): BuildPair => [w.def.id, w.level]),
      items: p.items.map((i): BuildPair => [i.def.id, i.level]),
      mods: p.mods.map((m): BuildPair => [m.def.id, m.level]),
      powerups: p.powerups.map((i): BuildPair => [i.def.id, i.level]),
    };
  }

  private sendSnapshots(): void {
    const net = this.net;
    if (!net) return;
    const events = this.outbox;
    this.outbox = [];
    const players: SnapPlayer[] = [];
    for (const p of this.players) {
      if (!p) continue;
      players.push({
        slot: p.slot,
        flags: (p.dead ? PF.dead : 0) | (p.gone ? PF.gone : 0) | (p.moving ? PF.moving : 0) | (p.god ? PF.god : 0),
        x: p.x,
        y: p.y,
        fx: p.facing.x,
        fy: p.facing.y,
        hp: p.hp,
        maxHp: p.stats.maxHp,
        invuln: Math.max(0, p.invuln),
        phases: p.weapons.phases(),
        revive: p.revive,
        reviveHp: p.reviveHp,
        ultCd: p.ultimate.cooldownLeft,
        ultActive: p.ultimate.activeLeft,
      });
    }
    const header = {
      runTime: this.runTime,
      state: STATE_CODES.indexOf(this.state),
      frozen: this.frozen,
      kills: this.kills,
      level: this.level,
      exp: this.exp,
      need: this.expNeed,
      teamDeaths: this.teamDeaths,
    };
    const now = this.time.now;
    const enemyKind = new Map(ENEMIES.map((d, i) => [d, i]));
    const weaponKind = new Map(ATTACK_DEFS.map((d, i) => [d, i]));

    for (const slot of net.remoteSlots) {
      const p = this.players[slot];
      if (!p || p.gone) continue;
      const w = this.writer.reset();
      writeHeader(w, header, players);

      let at = w.o;
      let n = 0;
      w.u16(0);
      for (const e of this.enemies.active) {
        if (!e.active || !this.nearView(p, e.x, e.y)) continue;
        const flags = (e.flipX ? EF.flip : 0) | (e.flashUntil > now ? EF.flash : 0);
        writeEntity(w, e.netId, enemyKind.get(e.def) ?? 0, flags, e.x, e.y);
        n++;
      }
      w.patchU16(at, n);

      at = w.o;
      n = 0;
      w.u16(0);
      for (const g of this.gems.group.getChildren() as Gem[]) {
        if (!g.active || !this.nearView(p, g.x, g.y)) continue;
        writeEntity(w, g.netId, g.color === 'red' ? 2 : g.color === 'green' ? 1 : 0, 0, g.x, g.y);
        n++;
      }
      w.patchU16(at, n);

      at = w.o;
      n = 0;
      w.u16(0);
      for (const pr of this.projectiles.getChildren() as Projectile[]) {
        if (!pr.active || !this.nearView(p, pr.x, pr.y)) continue;
        writeEntity(w, pr.netId, weaponKind.get(pr.weapon.def) ?? 0, Math.min(255, Math.round(pr.scaleX * 32)), pr.x, pr.y);
        n++;
      }
      w.patchU16(at, n);

      at = w.o;
      n = 0;
      w.u16(0);
      for (const po of this.potions.group.getChildren() as Potion[]) {
        if (!po.active || !this.nearView(p, po.x, po.y)) continue;
        writeEntity(w, po.netId, 0, po.blinking ? 1 : 0, po.x, po.y);
        n++;
      }
      w.patchU16(at, n);

      // Effects: only those near this player, and each sound at most once per snapshot.
      const sounds = new Set<string>();
      const mine = events.filter((ev) => {
        switch (ev[0]) {
          case 'n':
          case 'g':
          case 'p':
          case 'r':
          case 'l':
          case 'e':
          case 'x':
            return this.nearView(p, ev[1], ev[2]);
          case 's':
            if (sounds.has(ev[1])) return false;
            if (ev[2] !== undefined && !this.nearView(p, ev[2], ev[3]!)) return false;
            sounds.add(ev[1]);
            return true;
          default:
            return true;
        }
      });
      writeEvents(w, mine);
      net.sendSnapshot(slot, w.copy());
    }
  }

  // ------------------------------------------------------------------ co-op: joiner side

  private updateClient(dt: number): void {
    for (const p of this.players) {
      if (!p || p.gone) continue;
      if (p !== this.player) p.follow(dt);
      if (!p.dead) p.weapons.update(dt, false);
      p.ultimate.update(this.frozen ? 0 : dt, false);
    }
    this.mirror!.update(dt);
    this.fx.update(dt);
    this.drawHpBars();
    this.emitTime();
    this.updateDebug(dt);

    this.posTimer -= dt;
    if (this.posTimer <= 0 && this.state !== 'ended') {
      this.posTimer = 1 / POS_HZ;
      const p = this.player;
      this.net?.sendHost({
        t: 'pos',
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        fx: Math.round(p.facing.x * 100) / 100,
        fy: Math.round(p.facing.y * 100) / 100,
        m: p.moving ? 1 : 0,
      });
    }
  }

  private onSnapshot(s: Snapshot): void {
    if (this.state === 'ended') return;
    this.runTime = s.runTime;
    this.frozen = s.frozen;
    if (s.kills !== this.kills) {
      this.kills = s.kills;
      this.events.emit(EV.killsChanged, this.kills);
    }
    if (s.level !== this.level || s.exp !== this.exp || s.need !== this.expNeed) {
      const leveled = s.level > this.level;
      this.level = s.level;
      this.exp = s.exp;
      this.expNeed = s.need;
      this.events.emit(EV.expChanged, this.exp, this.expNeed, this.level);
      if (leveled) this.events.emit(EV.levelUp, this.level);
    }
    const state = STATE_CODES[s.state] ?? 'playing';
    if (state !== this.state && state !== 'ended') {
      this.state = state;
      if (state !== 'playing') this.stopEffects();
    }

    for (const sp of s.players) {
      const p = this.players[sp.slot];
      if (!p) continue;
      if (sp.flags & PF.gone) {
        if (!p.gone) {
          p.leave();
          p.weapons.destroy();
          p.ultimate.destroy();
        }
        continue;
      }
      const hpChanged = p.hp !== sp.hp || p.stats.maxHp !== sp.maxHp;
      p.hp = sp.hp;
      p.stats.maxHp = sp.maxHp;
      p.god = (sp.flags & PF.god) !== 0;
      if (p !== this.player) {
        p.netX = sp.x;
        p.netY = sp.y;
        if (sp.fx || sp.fy) p.facing.set(sp.fx, sp.fy);
        p.moving = (sp.flags & PF.moving) !== 0;
      }
      p.weapons.setPhases(sp.phases);
      if (this.state === 'playing') p.ultimate.sync(sp.ultCd, sp.ultActive);
      p.revive = sp.revive;
      p.reviveHp = sp.reviveHp;
      if (!(sp.flags & PF.dead) && p.dead) {
        p.standUp(sp.hp / Math.max(1, sp.maxHp), REVIVE.invulnSeconds);
        p.hp = sp.hp;
        this.onRevived(p);
      }
      if (sp.flags & PF.dead && !p.dead) {
        p.fallOver();
        p.weapons.clearVisuals();
        p.ultimate.stop();
        if (p === this.player) this.onLocalDeath();
      }
      if (p === this.player && hpChanged) this.events.emit(EV.hpChanged, p.hp, p.stats.maxHp);
    }

    const m = this.mirror!;
    m.enemies.apply(s.enemies);
    m.gems.apply(s.gems);
    m.projectiles.apply(s.projectiles);
    m.potions.apply(s.potions);
    this.teamDeaths = s.teamDeaths;

    for (const ev of s.events) this.replay(ev);
  }

  private replay(ev: FxEvent): void {
    switch (ev[0]) {
      case 'n':
        this.fx.damageNumber(ev[1], ev[2], ev[3], ev[4] === 1);
        break;
      case 'g':
        this.fx.healNumber(ev[1], ev[2], ev[3]);
        break;
      case 'p':
        this.fx.puff(ev[1], ev[2], ev[3], ev[4]);
        break;
      case 'r':
        this.fx.ring(ev[1], ev[2], ev[3], ev[4], ev[5]);
        break;
      case 's':
        sfx.play(ev[1]);
        break;
      case 'b':
        this.events.emit(EV.banner, ev[1], ev[2]);
        break;
      case 'h': {
        const p = this.players[ev[1]];
        if (!p) break;
        p.showHurt();
        if (p === this.player) this.onLocalHurt(ev[2]);
        break;
      }
      case 'w':
        this.players[ev[1]]?.weapons.addSlash(ev[2], ev[3], ev[4], ev[5], ev[6]);
        break;
      case 'a':
        this.players[ev[1]]?.weapons.pulse(ev[2]);
        break;
      case 'f':
        this.cameras.main.flash(ev[1], 255, 236, 190);
        break;
      case 'l':
        this.fx.lightning(ev[1], ev[2], ev[3], ev[4]);
        break;
      case 'e':
        this.fx.echo(ev[1], ev[2], ev[3], ev[4]);
        break;
      case 'x':
        this.fx.blast(ev[1], ev[2], ev[3], ev[4]);
        break;
    }
  }

  private onHostMsg(msg: HostMsg): void {
    switch (msg.t) {
      case 'build': {
        const p = this.players[msg.slot];
        if (!p || p.gone) break;
        p.items = msg.items.map(([id, level]) => ({ def: itemDef(id), level }));
        p.powerups = (msg.powerups ?? []).map(([id, level]) => ({ def: powerupDef(id), level }));
        p.mods = (msg.mods ?? []).map(([id, level]) => ({ def: modDef(id), level }));
        p.weapons.sync(msg.weapons);
        p.weapons.refreshMods();
        const hp = p.hp;
        p.setStats(computeStats([...p.items, ...p.powerups]));
        p.hp = hp; // HP comes from the host
        if (p === this.player) this.emitBuild();
        break;
      }
      case 'choices':
        this.offer = { choices: msg.choices, pending: msg.pending };
        this.inLevelUp = true;
        if (!this.scene.isActive(SCENES.levelUp)) {
          this.closeMenus();
          sfx.play('levelup');
          this.scene.launch(SCENES.levelUp);
        } else this.events.emit(EV.levelUpOffer);
        break;
      case 'choicesDone':
        this.events.emit(EV.levelUpWaiting);
        break;
      case 'levelUpOver':
        this.inLevelUp = false;
        this.offer = null;
        this.events.emit(EV.levelUpOver);
        break;
      case 'end':
        this.endRun(msg.summary.victory, msg.summary);
        break;
    }
  }

  // ------------------------------------------------------------------ HUD bits in world space

  private drawHpBars(): void {
    const g = this.hpBar;
    g.clear();
    for (const p of this.players) {
      if (!p || p.gone) continue;
      if (p.dead) {
        if (!this.coop) continue;
        // Revive circle: the area to stand in, filling up as the revive progresses.
        g.lineStyle(1, COLOR.good, 0.35);
        g.strokeCircle(p.x, p.y, REVIVE.radius);
        if (p.revive > 0) {
          g.lineStyle(2, COLOR.good, 1);
          g.beginPath();
          g.arc(p.x, p.y, REVIVE.radius, -Math.PI / 2, -Math.PI / 2 + p.revive * Math.PI * 2);
          g.strokePath();
        }
        continue;
      }
      const w = 18;
      const x = Math.round(p.x - w / 2);
      const y = Math.round(p.y + 12);
      const frac = Phaser.Math.Clamp(p.hp / p.stats.maxHp, 0, 1);
      const low = frac < 0.3 && Math.floor(this.time.now / 180) % 2 === 0;
      g.fillStyle(COLOR.ink, 1);
      g.fillRect(x - 1, y - 1, w + 2, 4);
      g.fillStyle(COLOR.hpDark, 1);
      g.fillRect(x, y, w, 2);
      g.fillStyle(low ? 0xffffff : COLOR.hp, 1);
      g.fillRect(x, y, Math.ceil(w * frac), 2);
    }
  }

  // ------------------------------------------------------------------ debug

  private toggleDebug(): void {
    this.debug = !this.debug;
    this.applyDebugDraw();
    this.events.emit(EV.debugState, this.debug);
    if (this.debug) this.events.emit(EV.debugStats, this.debugStats());
  }

  private applyDebugDraw(): void {
    const world = this.physics.world;
    if (this.debug && !world.debugGraphic) world.createDebugGraphic();
    world.drawDebug = this.debug;
    if (world.debugGraphic) {
      world.debugGraphic.clear();
      world.debugGraphic.setVisible(this.debug).setDepth(DEPTH.hpBar + 1);
    }
  }

  debugStats() {
    const m = this.mirror;
    return {
      fps: Math.round(this.game.loop.actualFps),
      enemies: m ? m.enemies.count : this.enemies.live,
      target: this.spawner.target,
      projectiles: m ? m.projectiles.count : this.projectiles.countActive(true),
      gems: m ? m.gems.count : this.gems.live,
      numbers: this.fx.activeNumbers,
      bodies: this.physics.world.bodies.size,
      minute: Math.floor(this.runTime / 60),
      seed: this.rng.seed,
      god: this.player.god,
      mode: this.mode,
    };
  }
}
