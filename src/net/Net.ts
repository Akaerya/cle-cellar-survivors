import Peer, { type DataConnection } from 'peerjs';
import Phaser from 'phaser';
import { MAX_PLAYERS } from '../constants';
import { sanitizeName, type Profile } from '../core/profile';
import { characterDef } from '../data';
import type { ClientMsg, HostMsg, Profiles } from './protocol';

/**
 * Co-op over WebRTC. The host's browser runs the whole simulation; joiners send their position
 * and level-up picks, and receive snapshots. PeerJS's public broker only introduces the browsers
 * to each other (the invite code is the host's peer id); game traffic goes peer to peer.
 */

const ID_PREFIX = 'cle-cellar-survivors-coop-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
/** Stop queueing snapshots for a peer that has this much unsent data (slow link). */
const MAX_BUFFERED = 256 * 1024;

export type Role = 'host' | 'client';

/** Events on `NetSession.events`. */
export const NET_EV = {
  /** Lobby membership changed: (slots: number[]) */
  lobby: 'lobby',
  /** Host: JSON message from a joiner: (slot, msg: ClientMsg) */
  clientMsg: 'client-msg',
  /** Client: JSON message from the host: (msg: HostMsg) */
  hostMsg: 'host-msg',
  /** Client: binary snapshot from the host: (buf: ArrayBuffer) */
  snapshot: 'snapshot',
  /** Host: a joiner left: (slot) */
  peerLeft: 'peer-left',
  /** The session is over: (reason: string) */
  closed: 'closed',
} as const;

function randomCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normaliseCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((c) => CODE_CHARS.includes(c))
    .join('')
    .slice(0, CODE_LENGTH);
}

export function isCodeChar(c: string): boolean {
  return c.length === 1 && CODE_CHARS.includes(c.toUpperCase());
}

function describeError(err: any): string {
  switch (err?.type) {
    case 'peer-unavailable':
      return 'NO GAME WITH THAT CODE';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'COULD NOT REACH THE MATCHMAKING SERVER';
    case 'browser-incompatible':
      return 'THIS BROWSER CANNOT DO PEER-TO-PEER';
    case 'webrtc':
      return 'CONNECTION FAILED (FIREWALL OR NAT)';
    default:
      return 'CONNECTION ERROR';
  }
}

export class NetSession {
  readonly events = new Phaser.Events.EventEmitter();
  readonly role: Role;
  code = '';
  /** This browser's player slot: 0 for the host, 1..3 for joiners. */
  mySlot = 0;
  /** Slots in the lobby, host first. */
  slots: number[] = [0];
  /** Name and character of everyone in the lobby, by slot (the host's copy is the one that counts). */
  profiles: Profiles = {};
  /** True once the host has started a run (late joiners are turned away). */
  inGame = false;
  private peer: Peer | null = null;
  private conns = new Map<number, DataConnection>();
  private host: DataConnection | null = null;
  private closed = false;

  private constructor(role: Role) {
    this.role = role;
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  // ---------------------------------------------------------------- setup

  /** Registers a fresh invite code with the broker. Resolves once joiners can connect. */
  static host(profile: Profile): Promise<NetSession> {
    const s = new NetSession('host');
    s.profiles = { 0: cleanProfile(profile) };
    return s.openHost(0);
  }

  private openHost(attempt: number): Promise<NetSession> {
    return new Promise((resolve, reject) => {
      const code = randomCode();
      const peer = new Peer(ID_PREFIX + code, { debug: 0 });
      let opened = false;
      peer.on('open', () => {
        opened = true;
        this.peer = peer;
        this.code = code;
        resolve(this);
      });
      peer.on('connection', (conn) => this.acceptJoiner(conn));
      peer.on('error', (err: any) => {
        if (!opened) {
          peer.destroy();
          if (err?.type === 'unavailable-id' && attempt < 4) this.openHost(attempt + 1).then(resolve, reject);
          else reject(new Error(describeError(err)));
          return;
        }
        // Errors after opening are about single joiners; the 'close' handlers deal with those.
      });
      peer.on('disconnected', () => {
        // Lost the broker: running games keep going over WebRTC, but no one new can join.
        if (!this.closed && !peer.destroyed) peer.reconnect();
      });
    });
  }

  /** Connects to the host behind `code`. Resolves once the host has given us a slot. */
  static join(code: string, profile: Profile): Promise<NetSession> {
    const s = new NetSession('client');
    s.code = code;
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      s.peer = peer;
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        s.close();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail('NO ANSWER FROM THAT CODE'), 15000);
      peer.on('error', (err: any) => {
        if (!settled) {
          clearTimeout(timer);
          fail(describeError(err));
        }
      });
      peer.on('open', () => {
        const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'raw' });
        s.host = conn;
        conn.on('data', (data) => {
          if (typeof data !== 'string') {
            s.events.emit(NET_EV.snapshot, data as ArrayBuffer);
            return;
          }
          const msg = JSON.parse(data) as HostMsg;
          if (!settled) {
            if (msg.t === 'welcome') {
              settled = true;
              clearTimeout(timer);
              s.mySlot = msg.you;
              s.slots = msg.slots;
              s.profiles = msg.profiles ?? {};
              s.setMyProfile(profile);
              resolve(s);
            } else if (msg.t === 'reject') {
              clearTimeout(timer);
              fail(msg.reason);
            }
            return;
          }
          if (msg.t === 'lobby') {
            s.slots = msg.slots;
            s.profiles = msg.profiles ?? {};
          }
          s.events.emit(NET_EV.hostMsg, msg);
          if (msg.t === 'lobby') s.events.emit(NET_EV.lobby, s.slots);
        });
        conn.on('close', () => {
          if (!settled) {
            clearTimeout(timer);
            fail('THE HOST CLOSED THE CONNECTION');
          } else s.end('THE HOST LEFT THE GAME');
        });
        conn.on('error', () => {
          if (!settled) {
            clearTimeout(timer);
            fail('CONNECTION FAILED (FIREWALL OR NAT)');
          }
        });
      });
    });
  }

  private acceptJoiner(conn: DataConnection): void {
    const reject = (reason: string) => {
      conn.on('open', () => {
        conn.send(JSON.stringify({ t: 'reject', reason } satisfies HostMsg));
        setTimeout(() => conn.close(), 500);
      });
    };
    if (this.inGame) return reject('THAT GAME HAS ALREADY STARTED');
    let slot = -1;
    for (let i = 1; i < MAX_PLAYERS; i++) {
      if (!this.slots.includes(i)) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return reject(`THAT GAME IS FULL (${MAX_PLAYERS} PLAYERS)`);
    // Reserve the slot now so two joiners at once do not get the same one.
    this.slots = [...this.slots, slot].sort();
    this.conns.set(slot, conn);
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      this.conns.delete(slot);
      this.slots = this.slots.filter((s) => s !== slot);
      delete this.profiles[slot];
      if (this.closed) return;
      this.events.emit(NET_EV.peerLeft, slot);
      this.lobbyChanged();
    };
    conn.on('open', () => {
      if (left) return;
      this.sendTo(slot, { t: 'welcome', you: slot, slots: this.slots, profiles: this.profiles });
      this.lobbyChanged();
    });
    conn.on('data', (data) => {
      if (typeof data !== 'string') return;
      const msg = JSON.parse(data) as ClientMsg;
      if (msg.t === 'profile') {
        this.profiles[slot] = cleanProfile(msg);
        this.lobbyChanged();
        return;
      }
      this.events.emit(NET_EV.clientMsg, slot, msg);
    });
    conn.on('close', leave);
    conn.on('error', leave);
    // ICE can fail without a close event; give up on a joiner that never opens.
    setTimeout(() => {
      if (!conn.open) {
        leave();
        conn.close();
      }
    }, 20000);
  }

  /** Host: tells everyone (and this browser) who is in the lobby now. */
  private lobbyChanged(): void {
    this.broadcast({ t: 'lobby', slots: this.slots, profiles: this.profiles });
    this.events.emit(NET_EV.lobby, this.slots);
  }

  /** This player's name or character changed. */
  setMyProfile(p: Profile): void {
    this.profiles[this.mySlot] = cleanProfile(p);
    if (this.isHost) this.lobbyChanged();
    else {
      this.sendHost({ t: 'profile', ...this.profiles[this.mySlot] });
      this.events.emit(NET_EV.lobby, this.slots);
    }
  }

  // ---------------------------------------------------------------- sending

  sendTo(slot: number, msg: HostMsg): void {
    const c = this.conns.get(slot);
    if (c?.open) c.send(JSON.stringify(msg));
  }

  broadcast(msg: HostMsg): void {
    const s = JSON.stringify(msg);
    for (const c of this.conns.values()) if (c.open) c.send(s);
  }

  /** Snapshots are dropped rather than queued when a peer is falling behind. */
  sendSnapshot(slot: number, buf: ArrayBuffer): void {
    const c = this.conns.get(slot);
    if (!c?.open) return;
    if ((c.dataChannel?.bufferedAmount ?? 0) > MAX_BUFFERED) return;
    c.send(buf);
  }

  sendHost(msg: ClientMsg): void {
    if (this.host?.open) this.host.send(JSON.stringify(msg));
  }

  /** Joiner slots that are connected right now. */
  get remoteSlots(): number[] {
    return [...this.conns.keys()];
  }

  // ---------------------------------------------------------------- teardown

  private end(reason: string): void {
    if (this.closed) return;
    this.close();
    this.events.emit(NET_EV.closed, reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.host?.close();
    // Give the close messages a moment to leave before tearing down the peer.
    const peer = this.peer;
    setTimeout(() => peer?.destroy(), 300);
    if (current === this) current = null;
  }
}

/** Names are re-sanitised and unknown characters replaced, whoever sent them. */
function cleanProfile(p: { name?: unknown; character?: unknown }): Profile {
  return { name: sanitizeName(p.name), character: characterDef(typeof p.character === 'string' ? p.character : undefined).id };
}

/** The session that outlives scene changes (lobby -> run -> game over -> next run). */
let current: NetSession | null = null;

export function netSession(): NetSession | null {
  return current;
}

export function setNetSession(s: NetSession | null): void {
  if (current && current !== s) current.close();
  current = s;
}
