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
} from '../constants';
import { DEBUG_EV, EV, type BuildEntry, type RunSummary } from '../core/events';
import { computeStats, expToNext, type OwnedItem } from '../core/progression';
import { Rng, seedFromUrl } from '../core/rng';
import { sfx } from '../core/sfx';
import { ITEMS, STARTING_WEAPON, WEAPONS, itemDef } from '../data';
import type { Enemy } from '../entities/Enemy';
import type { Gem } from '../entities/Gem';
import { Player } from '../entities/Player';
import type { Projectile } from '../entities/Projectile';
import { buildArena } from '../systems/Arena';
import { Enemies } from '../systems/Enemies';
import { Fx } from '../systems/Fx';
import { Gems } from '../systems/Gems';
import { Spawner } from '../systems/Spawner';
import { Weapons } from '../systems/Weapons';
import { onKey } from '../ui/widgets';

export type RunState = 'playing' | 'dying' | 'victory' | 'ended';

export interface Choice {
  kind: 'weapon' | 'item' | 'heal';
  id: string;
  name: string;
  icon: string;
  /** Level after taking this card (1 for new). */
  level: number;
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
  debug: boolean;
}

/** The run itself: owns the monkey, the systems, progression, and the run clock. */
export class GameScene extends Phaser.Scene {
  rng!: Rng;
  player!: Player;
  fx!: Fx;
  enemies!: Enemies;
  gems!: Gems;
  weapons!: Weapons;
  spawner!: Spawner;
  items: OwnedItem[] = [];

  state: RunState = 'playing';
  runTime = 0;
  kills = 0;
  level = 1;
  exp = 0;
  expNeed = expToNext(1);
  pendingLevelUps = 0;
  debug = false;

  private keys!: {
    up: Phaser.Input.Keyboard.Key[];
    down: Phaser.Input.Keyboard.Key[];
    left: Phaser.Input.Keyboard.Key[];
    right: Phaser.Input.Keyboard.Key[];
  };
  private hpBar!: Phaser.GameObjects.Graphics;
  private lastSecond = -1;
  private debugTimer = 0;

  constructor() {
    super(SCENES.game);
  }

  init(): void {
    // The scene object is reused across restarts, so every run field is reset here.
    this.items = [];
    this.state = 'playing';
    this.runTime = 0;
    this.kills = 0;
    this.level = 1;
    this.exp = 0;
    this.expNeed = expToNext(1);
    this.pendingLevelUps = 0;
    this.lastSecond = -1;
    this.debugTimer = 0;
  }

  create(data: { seed?: string }): void {
    this.rng = new Rng(data?.seed ?? seedFromUrl());
    this.physics.world.setBounds(0, 0, ARENA_SIZE, ARENA_SIZE);

    const arena = buildArena(this, this.rng);
    this.player = new Player(this, ARENA_SIZE / 2, ARENA_SIZE / 2);
    this.fx = new Fx(this);
    this.enemies = new Enemies(this);
    this.gems = new Gems(this);
    this.weapons = new Weapons(this);
    this.spawner = new Spawner(this);
    this.weapons.add(STARTING_WEAPON);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, ARENA_SIZE, ARENA_SIZE);
    cam.startFollow(this.player, true, 0.2, 0.2);
    cam.setRoundPixels(true);
    cam.setBackgroundColor(0x120d18);

    // Physics: walls block the monkey and enemies; overlaps drive damage and pickups.
    this.physics.add.collider(this.player, arena.walls);
    this.physics.add.collider(this.enemies.group, arena.walls);
    this.physics.add.overlap(this.player, this.enemies.group, (_p, e) => this.onTouchEnemy(e as Enemy));
    this.physics.add.overlap(this.weapons.projectiles, this.enemies.group, (p, e) =>
      this.weapons.onProjectileHit(p as Projectile, e as Enemy),
    );
    this.physics.add.overlap(this.player, this.gems.group, (_p, g) => this.gems.collect(g as Gem));

    // Scene clock: pausing this scene pauses the spawner too.
    this.time.addEvent({ delay: SPAWN_TICK_MS, loop: true, callback: () => this.spawner.tick() });
    this.spawner.tick();

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

    this.hpBar = this.add.graphics().setDepth(DEPTH.hpBar);

    // Pause automatically when the window loses focus.
    const onBlur = () => this.openPause();
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);

    const listen: [string, (...a: any[]) => void][] = [
      [DEBUG_EV.spawn, () => this.spawner.spawnBurst(50)],
      [DEBUG_EV.addExp, () => this.addExp((this.expNeed - this.exp) / this.player.stats.expMult)],
      [DEBUG_EV.skipMinute, () => (this.runTime = Math.min(RUN_SECONDS - 1, this.runTime + 60))],
      [DEBUG_EV.god, () => (this.player.god = !this.player.god)],
      [DEBUG_EV.toggle, () => this.toggleDebug()],
    ];
    for (const [ev, fn] of listen) this.events.on(ev, fn);
    this.events.once('shutdown', () => {
      for (const [ev, fn] of listen) this.events.off(ev, fn);
      this.game.events.off(Phaser.Core.Events.BLUR, onBlur);
    });

    if (this.debug) this.applyDebugDraw();
    (window as any).__bananaNocturne = this;

    // A fresh run never inherits an overlay from the previous one.
    for (const key of [SCENES.levelUp, SCENES.pause, SCENES.gameOver]) {
      if (this.scene.isActive(key) || this.scene.isPaused(key)) this.scene.stop(key);
    }
    this.scene.stop(SCENES.ui);
    this.scene.launch(SCENES.ui);
  }

  update(_t: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000;
    if (this.state === 'ended') return;

    const k = this.keys;
    const down = (list: Phaser.Input.Keyboard.Key[]) => list.some((key) => key.isDown);
    const ix = (down(k.right) ? 1 : 0) - (down(k.left) ? 1 : 0);
    const iy = (down(k.down) ? 1 : 0) - (down(k.up) ? 1 : 0);
    this.player.steer(ix, iy, dt);

    const playing = this.state === 'playing';
    if (playing) {
      this.runTime += dt;
      this.spawner.checkEvents(this.runTime);
      if (this.runTime >= RUN_SECONDS) this.victory();
    }

    this.enemies.update(dt, this.time.now, this.player.x, this.player.y, this.state === 'dying');
    this.weapons.update(dt, this.state === 'playing');
    this.gems.update(dt);
    this.fx.update(dt);
    this.drawHpBar();

    const sec = Math.floor(this.runTime);
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      this.events.emit(EV.timeChanged, this.runTime);
    }

    if (this.debug) {
      this.debugTimer -= dt;
      if (this.debugTimer <= 0) {
        this.debugTimer = 0.25;
        this.events.emit(EV.debugStats, this.debugStats());
      }
    }

    if (this.pendingLevelUps > 0 && this.state === 'playing') this.openLevelUp();
  }

  // ------------------------------------------------------------------ combat

  private onTouchEnemy(e: Enemy): void {
    if (this.state !== 'playing' || !e.active) return;
    const dmg = this.player.takeHit(e.def.damage);
    if (dmg <= 0) return;
    sfx.play('hurt');
    this.cameras.main.shake(110, 0.006);
    this.events.emit(EV.playerHurt, dmg);
    this.events.emit(EV.hpChanged, this.player.hp, this.player.stats.maxHp);
    if (this.player.hp <= 0) this.die();
  }

  onEnemyKilled(): void {
    this.kills++;
    this.events.emit(EV.killsChanged, this.kills);
  }

  addExp(value: number): void {
    this.exp += value * this.player.stats.expMult;
    let leveled = false;
    while (this.exp >= this.expNeed) {
      this.exp -= this.expNeed;
      this.level++;
      this.pendingLevelUps++;
      this.expNeed = expToNext(this.level);
      leveled = true;
    }
    this.events.emit(EV.expChanged, this.exp, this.expNeed, this.level);
    if (leveled) this.events.emit(EV.levelUp, this.level);
  }

  // ------------------------------------------------------------------ level-ups

  private openLevelUp(): void {
    if (this.scene.isActive(SCENES.levelUp)) return;
    sfx.play('levelup');
    this.fx.ring(this.player.x, this.player.y, COLOR.gold, 70, 450);
    this.scene.pause();
    this.scene.launch(SCENES.levelUp);
  }

  /** Up to 3 random cards from new weapons/items and upgrades of owned ones, respecting slot limits. */
  rollChoices(): Choice[] {
    const pool: Choice[] = [];
    const weaponSlotsFull = this.weapons.list.length >= MAX_WEAPONS;
    const itemSlotsFull = this.items.length >= MAX_ITEMS;
    for (const def of WEAPONS) {
      const owned = this.weapons.get(def.id);
      if (owned) {
        if (owned.level < MAX_LEVEL) {
          pool.push({
            kind: 'weapon',
            id: def.id,
            name: def.name,
            icon: def.icon,
            level: owned.level + 1,
            isNew: false,
            text: def.levels[owned.level - 1]?.text ?? '',
          });
        }
      } else if (!weaponSlotsFull) {
        pool.push({ kind: 'weapon', id: def.id, name: def.name, icon: def.icon, level: 1, isNew: true, text: def.description });
      }
    }
    for (const def of ITEMS) {
      const owned = this.items.find((i) => i.def.id === def.id);
      if (owned) {
        if (owned.level < MAX_LEVEL) {
          pool.push({ kind: 'item', id: def.id, name: def.name, icon: def.icon, level: owned.level + 1, isNew: false, text: def.levelText });
        }
      } else if (!itemSlotsFull) {
        pool.push({ kind: 'item', id: def.id, name: def.name, icon: def.icon, level: 1, isNew: true, text: def.description });
      }
    }
    if (pool.length === 0) {
      return [
        {
          kind: 'heal',
          id: 'heal',
          name: 'Banana Bunch',
          icon: 'icon_heal',
          level: 0,
          isNew: false,
          text: `Everything is maxed. Heal ${FALLBACK_HEAL} HP.`,
        },
      ];
    }
    return this.rng.shuffled(pool).slice(0, 3);
  }

  applyChoice(c: Choice): void {
    if (c.kind === 'weapon') {
      if (this.weapons.get(c.id)) this.weapons.levelUp(c.id);
      else this.weapons.add(c.id);
    } else if (c.kind === 'item') {
      const owned = this.items.find((i) => i.def.id === c.id);
      if (owned) owned.level++;
      else this.items.push({ def: itemDef(c.id), level: 1 });
      this.player.setStats(computeStats(this.items));
    } else {
      this.player.heal(FALLBACK_HEAL);
    }
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    this.events.emit(EV.buildChanged, this.buildWeapons(), this.buildItems());
    this.events.emit(EV.hpChanged, this.player.hp, this.player.stats.maxHp);
  }

  buildWeapons(): BuildEntry[] {
    return this.weapons.list.map((w) => ({ id: w.def.id, name: w.def.name, icon: w.def.icon, level: w.level, damage: Math.round(w.damage) }));
  }

  buildItems(): BuildEntry[] {
    return this.items.map((i) => ({ id: i.def.id, name: i.def.name, icon: i.def.icon, level: i.level }));
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
      debug: this.debug,
    };
  }

  // ------------------------------------------------------------------ run flow

  openPause(): void {
    if (this.state !== 'playing' || !this.scene.isActive() || this.scene.isActive(SCENES.levelUp)) return;
    sfx.play('pause');
    this.scene.pause();
    this.scene.launch(SCENES.pause);
  }

  private die(): void {
    this.state = 'dying';
    this.player.dead = true;
    this.player.play('monkey-hurt', true);
    sfx.play('death');
    this.cameras.main.shake(300, 0.012);
    this.weapons.clearVisuals();
    this.tweens.add({ targets: this.player, alpha: 0.25, angle: 90, duration: 900, ease: 'Quad.easeIn' });
    this.time.delayedCall(1300, () => this.endRun(false));
  }

  private victory(): void {
    this.state = 'victory';
    this.runTime = RUN_SECONDS;
    sfx.play('victory');
    this.cameras.main.flash(900, 255, 236, 190);
    this.weapons.clearVisuals();
    let puffs = 0;
    for (const e of this.enemies.active.slice()) {
      if (!e.active) continue;
      if (puffs++ < 120) this.fx.puff(e.x, e.y, 0xffe6a0, 6);
      this.enemies.kill(e, false);
    }
    this.events.emit(EV.banner, 'DAWN BREAKS', COLOR.gold);
    this.time.delayedCall(2200, () => this.endRun(true));
  }

  private endRun(victory: boolean): void {
    if (this.state === 'ended') return;
    this.state = 'ended';
    const summary: RunSummary = {
      victory,
      time: this.runTime,
      level: this.level,
      kills: this.kills,
      weapons: this.buildWeapons(),
      items: this.buildItems(),
      seed: this.rng.seed,
    };
    this.events.emit(EV.runEnded);
    this.scene.stop(SCENES.ui);
    this.scene.pause();
    this.scene.launch(SCENES.gameOver, summary);
  }

  // ------------------------------------------------------------------ HUD bits in world space

  private drawHpBar(): void {
    const g = this.hpBar;
    g.clear();
    if (this.player.dead) return;
    const p = this.player;
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
    return {
      fps: Math.round(this.game.loop.actualFps),
      enemies: this.enemies.live,
      target: this.spawner.target,
      projectiles: this.weapons.activeProjectiles,
      gems: this.gems.live,
      numbers: this.fx.activeNumbers,
      bodies: this.physics.world.bodies.size,
      minute: Math.floor(this.runTime / 60),
      seed: this.rng.seed,
      god: this.player.god,
    };
  }
}

