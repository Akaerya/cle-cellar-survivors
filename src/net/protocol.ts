import Phaser from 'phaser';
import type { RunSummary } from '../core/events';
import type { Profile } from '../core/profile';
import type { SfxName } from '../core/sfx';
import type { PlayerStatus } from '../entities/Player';
import type { Choice } from '../scenes/GameScene';

// ------------------------------------------------------------------ JSON messages

/** [weapon, item, modification or powerup id, level] */
export type BuildPair = [string, number];

/** Each lobby member's name and character, by slot. */
export type Profiles = Record<number, Profile>;

export type HostMsg =
  | { t: 'welcome'; you: number; slots: number[]; profiles: Profiles }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; slots: number[]; profiles: Profiles }
  | { t: 'start'; seed: string; slots: number[]; profiles: Profiles }
  /** A player's weapons, items, modifications or powerups changed. */
  | { t: 'build'; slot: number; weapons: BuildPair[]; items: BuildPair[]; mods: BuildPair[]; powerups: BuildPair[] }
  /** Level-up cards for the receiving player; `pending` counts this pick, `rerolls` is what they have left. */
  | { t: 'choices'; choices: Choice[]; pending: number; rerolls: number; reroll?: boolean }
  /** The receiving player has picked everything; teammates are still choosing. */
  | { t: 'choicesDone' }
  /** Everyone has picked; the run continues. */
  | { t: 'levelUpOver' }
  | { t: 'end'; summary: RunSummary }
  | { t: 'toLobby' };

export type ClientMsg =
  /**
   * The joiner's character (joiners move their own character; the host trusts it): position, facing, moving, speed
   * (Momentum), and how many teleports it has seen (positions from before the host's last one are ignored).
   */
  | { t: 'pos'; x: number; y: number; fx: number; fy: number; m: 0 | 1; v: number; k: number }
  | { t: 'pick'; index: number }
  /** Replace the three cards on offer (the host checks the player has rerolls left). */
  | { t: 'reroll' }
  /** Name or character changed in the lobby. */
  | { t: 'profile'; name: string; character: string }
  /** Cast the ultimate (the host checks the cooldown). */
  | { t: 'ult' };

// ------------------------------------------------------------------ effects relayed to joiners

export type FxEvent =
  /** damage number: x, y, value, style (0 normal, 1 big hit, 2 critical strike) */
  | ['n', number, number, number, 0 | 1 | 2]
  /** heal number: x, y, amount */
  | ['g', number, number, number]
  /** puff: x, y, colour, count */
  | ['p', number, number, number, number]
  /** ring: x, y, colour, radius, duration */
  | ['r', number, number, number, number, number]
  /** sound, with an optional position (dropped for joiners far from it) */
  | ['s', SfxName, number?, number?]
  /** banner: text, colour */
  | ['b', string, number]
  /** a player was hurt: slot, amount, 1 for a tick of damage over time (no hurt flash) */
  | ['h', number, number, 1?]
  /** melee slash: slot, weapon index, angle, reach, arc, duration */
  | ['w', number, number, number, number, number, number]
  /** aura pulse: slot, weapon index */
  | ['a', number, number]
  /** camera flash for everyone: duration, colour (warm white when missing) */
  | ['f', number, number?]
  /** lightning strike: x, y, radius, colour */
  | ['l', number, number, number, number]
  /** Echo Strike ring: x, y, radius, colour */
  | ['e', number, number, number, number]
  /** bomb explosion: x, y, radius, colour */
  | ['x', number, number, number, number]
  /** cold crystal burst: x, y, radius, colour */
  | ['k', number, number, number, number]
  /** Virulent Chain ink blob: from x, y to x2, y2 */
  | ['i', number, number, number, number]
  /** field: x, y, radius, seconds, colour, 1 for a spider web (else a swirling freezing vortex) */
  | ['v', number, number, number, number, number, 1?]
  /** lingering beam: x1, y1, x2, y2, width, seconds, colour */
  | ['z', number, number, number, number, number, number, number]
  /** dome ultimate cast: caster slot, centre x, centre y */
  | ['d', number, number, number]
  /** boss wind-up warning circle: x, y, radius, seconds, colour */
  | ['c', number, number, number, number, number]
  /** a word where a damage number would be (a rare enemy ignored a hit, a dodge): x, y, word, colour */
  | ['t', number, number, string, number]
  /** a player was teleported (Flicker Strike): slot, x, y, that player's teleport count */
  | ['m', number, number, number, number];

// ------------------------------------------------------------------ binary snapshots

export const STATE_CODES = ['playing', 'dying', 'victory', 'ended'] as const;

export const PF = { dead: 1, gone: 2, moving: 4, god: 8 } as const;
/** Enemy flags. `spirit`: came back once through Spirit Walker (drawn see-through). `stun`: stunned (Stun modification). `shock`: carrying Shock. */
export const EF = { flip: 1, flash: 2, chill: 4, spirit: 8, stun: 16, shock: 32 } as const;
/** Summon flags (low bits of `extra`); the bits above SUMMON_ANGLE_SHIFT are the art's turn in 64ths of a circle. */
export const SF = { flip: 1, giant: 2 } as const;
export const SUMMON_ANGLE_SHIFT = 2;
export const SUMMON_ANGLE_STEPS = 64;

/** `extra` of a summon record: SF flags and the turn of its art. */
export function summonExtra(v: { flip: boolean; giant: boolean; angle: number }): number {
  const t = (((v.angle / (Math.PI * 2)) % 1) + 1) % 1;
  const turn = Math.round(t * SUMMON_ANGLE_STEPS) % SUMMON_ANGLE_STEPS;
  return (v.flip ? SF.flip : 0) | (v.giant ? SF.giant : 0) | (turn << SUMMON_ANGLE_SHIFT);
}

export interface SnapPlayer {
  slot: number;
  flags: number;
  x: number;
  y: number;
  fx: number;
  fy: number;
  hp: number;
  maxHp: number;
  invuln: number;
  /** One value per weapon: the orbit angle for orbit weapons, 0 otherwise. */
  phases: number[];
  /** Fallen player: revive progress 0..1 and the HP fraction a revive restores. */
  revive: number;
  reviveHp: number;
  /** Ultimate: seconds of cooldown left and seconds the effect has left. */
  ultCd: number;
  ultActive: number;
  /** Buffs, charges and passive state, for the HUD and the shield bubble. */
  status: PlayerStatus;
}

export interface SnapEntity {
  id: number;
  /**
   * Enemy: index into ALL_ENEMIES. Gem: 0 blue, 1 green, 2 red. Projectile: index into ATTACK_DEFS. Hazard: index into
   * HAZARDS. Summon: index into SUMMON_ANIMS.
   */
  kind: number;
  /**
   * Enemy: EF flags. Projectile: scale x 32. Gem: unused. Potion: 1 while blinking. Hazard: alpha x 255. Summon: SF
   * flags and the turn of its art (see SUMMON_ANGLE_SHIFT).
   */
  extra: number;
  x: number;
  y: number;
}

export interface Snapshot {
  runTime: number;
  state: number;
  frozen: boolean;
  kills: number;
  level: number;
  exp: number;
  need: number;
  teamDeaths: number;
  players: SnapPlayer[];
  enemies: SnapEntity[];
  gems: SnapEntity[];
  projectiles: SnapEntity[];
  potions: SnapEntity[];
  hazards: SnapEntity[];
  /** Pets and seeker blades (Pets, Weapons.summonViews). */
  summons: SnapEntity[];
  /** Every living boss (not culled): HP bars are shown wherever it is. */
  bosses: SnapBoss[];
  /** Rare enemies among `enemies`: what RareVisuals draws on them. */
  rares: SnapRare[];
  events: FxEvent[];
}

export interface SnapRare {
  /** Net id of the enemy (also in `enemies`). */
  id: number;
  /** Bit i set: has ENEMY_MODIFIERS[i]. */
  mask: number;
  /** Enrage, 0..1. */
  enrage: number;
  /** Soul Absorption souls (capped at 255 here). */
  souls: number;
  /** Temporal Shield: its bubble is broken (recharging). */
  shieldDown: boolean;
}

/** Writes the rare enemy list; must match decodeSnapshot. */
export function writeRares(w: Writer, rares: SnapRare[]): void {
  w.u16(rares.length);
  for (const r of rares) {
    w.u16(r.id);
    w.u32(r.mask);
    w.u8(Math.round(Phaser.Math.Clamp(r.enrage, 0, 1) * 255));
    w.u8(Math.min(255, r.souls));
    w.u8(r.shieldDown ? 1 : 0);
  }
}

export interface SnapBoss {
  id: number;
  /** Index into ALL_ENEMIES. */
  kind: number;
  /** HP left, 0..1. */
  frac: number;
}

/** Writes the boss list; must match decodeSnapshot. */
export function writeBosses(w: Writer, bosses: SnapBoss[]): void {
  w.u8(bosses.length);
  for (const b of bosses) {
    w.u16(b.id);
    w.u8(b.kind);
    w.u16(Math.round(Phaser.Math.Clamp(b.frac, 0, 1) * 65535));
  }
}

const POS = 4; // positions are sent in quarter pixels as int16 (arena is 3200 px)

/** Reusable little-endian writer that grows as needed. */
export class Writer {
  private buf = new ArrayBuffer(64 * 1024);
  private view = new DataView(this.buf);
  private bytes = new Uint8Array(this.buf);
  o = 0;

  reset(): this {
    this.o = 0;
    return this;
  }

  private need(n: number): void {
    if (this.o + n <= this.buf.byteLength) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(next).set(this.bytes.subarray(0, this.o));
    this.buf = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }

  u8(v: number): void {
    this.need(1);
    this.view.setUint8(this.o, v);
    this.o += 1;
  }
  i8(v: number): void {
    this.need(1);
    this.view.setInt8(this.o, v);
    this.o += 1;
  }
  u16(v: number): void {
    this.need(2);
    this.view.setUint16(this.o, v, true);
    this.o += 2;
  }
  i16(v: number): void {
    this.need(2);
    this.view.setInt16(this.o, v, true);
    this.o += 2;
  }
  u32(v: number): void {
    this.need(4);
    this.view.setUint32(this.o, v, true);
    this.o += 4;
  }
  f32(v: number): void {
    this.need(4);
    this.view.setFloat32(this.o, v, true);
    this.o += 4;
  }
  pos(v: number): void {
    this.i16(Math.round(v * POS));
  }
  bytesOf(b: Uint8Array): void {
    this.need(b.length);
    this.bytes.set(b, this.o);
    this.o += b.length;
  }
  /** Patches a u16 written earlier (entity counts are known only after culling). */
  patchU16(at: number, v: number): void {
    this.view.setUint16(at, v, true);
  }

  copy(): ArrayBuffer {
    return this.buf.slice(0, this.o);
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function writeEvents(w: Writer, events: FxEvent[]): void {
  const b = encoder.encode(events.length ? JSON.stringify(events) : '');
  w.u32(b.length);
  w.bytesOf(b);
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot {
  const v = new DataView(buf);
  let o = 0;
  const u8 = () => v.getUint8(o++);
  const i8 = () => v.getInt8(o++);
  const u16 = () => ((o += 2), v.getUint16(o - 2, true));
  const i16 = () => ((o += 2), v.getInt16(o - 2, true));
  const u32 = () => ((o += 4), v.getUint32(o - 4, true));
  const f32 = () => ((o += 4), v.getFloat32(o - 4, true));
  const pos = () => i16() / POS;

  const runTime = f32();
  const state = u8();
  const frozen = u8() === 1;
  const kills = u32();
  const level = u16();
  const exp = f32();
  const need = f32();
  const teamDeaths = u16();

  const players: SnapPlayer[] = [];
  const np = u8();
  for (let i = 0; i < np; i++) {
    const slot = u8();
    const flags = u8();
    const x = pos();
    const y = pos();
    const fx = i8() / 127;
    const fy = i8() / 127;
    const hp = f32();
    const maxHp = u16();
    const invuln = u8() / 200;
    const phases: number[] = [];
    const nw = u8();
    for (let k = 0; k < nw; k++) phases.push((u16() / 65535) * Math.PI * 2);
    const revive = u8() / 255;
    const reviveHp = u8() / 100;
    const ultCd = u16() / 10;
    const ultActive = u16() / 10;
    const status: PlayerStatus = {
      aegis: u8(),
      brutal: u8(),
      siphon: u8(),
      vicissitude: u8(),
      shadow: u8(),
      amp: u16() / 100,
      ampLeft: u16() / 10,
      passiveCd: u16() / 10,
      stacks: u8(),
    };
    players.push({ slot, flags, x, y, fx, fy, hp, maxHp, invuln, phases, revive, reviveHp, ultCd, ultActive, status });
  }

  const entities = (): SnapEntity[] => {
    const n = u16();
    const out: SnapEntity[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const id = u16();
      const kind = u8();
      const extra = u8();
      const x = pos();
      const y = pos();
      out[i] = { id, kind, extra, x, y };
    }
    return out;
  };
  const enemies = entities();
  const gems = entities();
  const projectiles = entities();
  const potions = entities();
  const hazards = entities();
  const summons = entities();
  const bosses: SnapBoss[] = [];
  const nb = u8();
  for (let i = 0; i < nb; i++) {
    const id = u16();
    const kind = u8();
    const frac = u16() / 65535;
    bosses.push({ id, kind, frac });
  }
  const rares: SnapRare[] = [];
  const nr = u16();
  for (let i = 0; i < nr; i++) {
    const id = u16();
    const mask = u32();
    const enrage = u8() / 255;
    const souls = u8();
    const shieldDown = u8() === 1;
    rares.push({ id, mask, enrage, souls, shieldDown });
  }

  const len = u32();
  const events = len > 0 ? (JSON.parse(decoder.decode(new Uint8Array(buf, o, len))) as FxEvent[]) : [];
  return { runTime, state, frozen, kills, level, exp, need, teamDeaths, players, enemies, gems, projectiles, potions, hazards, summons, bosses, rares, events };
}

/** Writes one entity record; must match `entities()` in decodeSnapshot. */
export function writeEntity(w: Writer, id: number, kind: number, extra: number, x: number, y: number): void {
  w.u16(id);
  w.u8(kind);
  w.u8(extra);
  w.pos(x);
  w.pos(y);
}

/** Writes the snapshot header and players; must match decodeSnapshot. */
export function writeHeader(
  w: Writer,
  h: { runTime: number; state: number; frozen: boolean; kills: number; level: number; exp: number; need: number; teamDeaths: number },
  players: SnapPlayer[],
): void {
  w.f32(h.runTime);
  w.u8(h.state);
  w.u8(h.frozen ? 1 : 0);
  w.u32(h.kills);
  w.u16(h.level);
  w.f32(h.exp);
  w.f32(h.need);
  w.u16(h.teamDeaths);
  w.u8(players.length);
  for (const p of players) {
    w.u8(p.slot);
    w.u8(p.flags);
    w.pos(p.x);
    w.pos(p.y);
    w.i8(Math.round(p.fx * 127));
    w.i8(Math.round(p.fy * 127));
    w.f32(p.hp);
    w.u16(Math.round(p.maxHp));
    w.u8(Math.min(255, Math.round(p.invuln * 200)));
    w.u8(p.phases.length);
    for (const a of p.phases) {
      const t = (((a / (Math.PI * 2)) % 1) + 1) % 1;
      w.u16(Math.round(t * 65535));
    }
    w.u8(Math.round(Phaser.Math.Clamp(p.revive, 0, 1) * 255));
    w.u8(Math.round(p.reviveHp * 100));
    w.u16(Math.min(65535, Math.ceil(p.ultCd * 10)));
    w.u16(Math.min(65535, Math.ceil(p.ultActive * 10)));
    const s = p.status;
    for (const n of [s.aegis, s.brutal, s.siphon, s.vicissitude, s.shadow]) w.u8(Math.min(255, n));
    w.u16(Math.min(65535, Math.round(s.amp * 100)));
    w.u16(Math.min(65535, Math.ceil(s.ampLeft * 10)));
    w.u16(Math.min(65535, Math.ceil(s.passiveCd * 10)));
    w.u8(Math.min(255, s.stacks));
  }
}
