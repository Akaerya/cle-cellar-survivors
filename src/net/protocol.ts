import Phaser from 'phaser';
import type { RunSummary } from '../core/events';
import type { SfxName } from '../core/sfx';
import type { Choice } from '../scenes/GameScene';

// ------------------------------------------------------------------ JSON messages

/** [weapon or item id, level] */
export type BuildPair = [string, number];

export type HostMsg =
  | { t: 'welcome'; you: number; slots: number[] }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; slots: number[] }
  | { t: 'start'; seed: string; slots: number[] }
  /** A player's weapons and items changed. */
  | { t: 'build'; slot: number; weapons: BuildPair[]; items: BuildPair[] }
  /** Level-up cards for the receiving player; `pending` counts this pick. */
  | { t: 'choices'; choices: Choice[]; pending: number }
  /** The receiving player has picked everything; teammates are still choosing. */
  | { t: 'choicesDone' }
  /** Everyone has picked; the run continues. */
  | { t: 'levelUpOver' }
  | { t: 'end'; summary: RunSummary }
  | { t: 'toLobby' };

export type ClientMsg =
  /** The joiner's monkey (joiners move their own monkey; the host trusts it). */
  | { t: 'pos'; x: number; y: number; fx: number; fy: number; m: 0 | 1 }
  | { t: 'pick'; index: number };

// ------------------------------------------------------------------ effects relayed to joiners

export type FxEvent =
  /** damage number */
  | ['n', number, number, number, 0 | 1]
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
  /** a player was hurt: slot, amount */
  | ['h', number, number]
  /** melee slash: slot, weapon index, angle, reach, arc, duration */
  | ['w', number, number, number, number, number, number]
  /** aura pulse: slot, weapon index */
  | ['a', number, number]
  /** camera flash for everyone: duration */
  | ['f', number];

// ------------------------------------------------------------------ binary snapshots

export const STATE_CODES = ['playing', 'dying', 'victory', 'ended'] as const;

export const PF = { dead: 1, gone: 2, moving: 4, god: 8 } as const;
export const EF = { flip: 1, flash: 2 } as const;

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
  /** Fallen monkey: revive progress 0..1 and the HP fraction a revive restores. */
  revive: number;
  reviveHp: number;
}

export interface SnapEntity {
  id: number;
  /** Enemy: index into ENEMIES. Gem: 0 blue, 1 green, 2 red. Projectile: index into WEAPONS. */
  kind: number;
  /** Enemy: EF flags. Projectile: scale x 32. Gem: unused. Potion: 1 while blinking. */
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
  events: FxEvent[];
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
    players.push({ slot, flags, x, y, fx, fy, hp, maxHp, invuln, phases, revive, reviveHp });
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

  const len = u32();
  const events = len > 0 ? (JSON.parse(decoder.decode(new Uint8Array(buf, o, len))) as FxEvent[]) : [];
  return { runTime, state, frozen, kills, level, exp, need, teamDeaths, players, enemies, gems, projectiles, potions, events };
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
  }
}
