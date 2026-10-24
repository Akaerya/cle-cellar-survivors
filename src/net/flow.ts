import type Phaser from 'phaser';
import { SCENES } from '../constants';
import { seedFromUrl } from '../core/rng';
import { NET_EV, setNetSession, type NetSession } from './Net';
import type { HostMsg } from './protocol';

/** Stops every scene, then starts `key`. Used for co-op transitions that can arrive at any time. */
export function goTo(game: Phaser.Game, key: string, data?: object): void {
  for (const s of game.scene.getScenes(false)) {
    const k = s.scene.key;
    if (k !== key && k !== SCENES.boot && (s.scene.isActive() || s.scene.isPaused())) s.scene.stop();
  }
  game.scene.start(key, data);
}

/**
 * Wires the scene changes a co-op session drives no matter which scene is showing:
 * the host starting a run or going back to the lobby, and the session ending.
 */
export function installSession(game: Phaser.Game, s: NetSession): void {
  setNetSession(s);
  if (!s.isHost) {
    s.events.on(NET_EV.hostMsg, (msg: HostMsg) => {
      if (msg.t === 'start') goTo(game, SCENES.game, { seed: msg.seed, slots: msg.slots, profiles: msg.profiles });
      else if (msg.t === 'toLobby') goTo(game, SCENES.lobby, { mode: 'resume' });
    });
  }
  s.events.once(NET_EV.closed, (reason: string) => goTo(game, SCENES.title, { message: reason }));
}

/** Leaves the co-op session (if any) and returns to the title. */
export function leaveSession(game: Phaser.Game, s: NetSession | null): void {
  if (s) {
    s.events.removeAllListeners();
    setNetSession(null);
    s.close();
  }
  goTo(game, SCENES.title);
}

/** Host: starts a run with everyone in the lobby. */
export function hostStartRun(game: Phaser.Game, s: NetSession): void {
  s.inGame = true;
  const seed = seedFromUrl() ?? String(Math.floor(Math.random() * 1e9));
  const slots = [...s.slots];
  const profiles = s.profiles;
  s.broadcast({ t: 'start', seed, slots, profiles });
  goTo(game, SCENES.game, { seed, slots, profiles });
}

/** Host: takes everyone back to the lobby, where new players can join again. */
export function hostToLobby(game: Phaser.Game, s: NetSession): void {
  s.inGame = false;
  s.broadcast({ t: 'toLobby' });
  goTo(game, SCENES.lobby, { mode: 'resume' });
}
