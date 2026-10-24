import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, MAX_PLAYERS, PLAYER_COLORS, PLAYER_TINTS, SCENES, VIEW_H, VIEW_W } from '../constants';
import { NAME_MAX, displayName, isNameChar, loadProfile, sanitizeName, saveProfile } from '../core/profile';
import { sfx } from '../core/sfx';
import { characterDef } from '../data';
import { hostStartRun, installSession, leaveSession } from '../net/flow';
import { CODE_LENGTH, NET_EV, NetSession, isCodeChar, netSession, normaliseCode } from '../net/Net';
import { Button, Menu, drawPanel, onKey, text } from '../ui/widgets';

type LobbyMode = 'host' | 'join' | 'resume';

const PANEL_X = 40;
const CARD_W = 128;
const CARD_Y = 132;
const CARD_H = 140;
const BUTTON_Y = 292;

/**
 * Co-op lobby. Host: gets an invite code and link, sees who has joined, starts the run.
 * Join: types or pastes a code, then waits for the host to start.
 * Everyone can pick a character (CHARACTER opens the select screen) and type a display name.
 */
export class LobbyScene extends Phaser.Scene {
  private session: NetSession | null = null;
  private live = false;
  private code = '';
  private connecting = false;
  private status!: Phaser.GameObjects.BitmapText;
  private codeText!: Phaser.GameObjects.BitmapText;
  private roster!: Phaser.GameObjects.Container;
  private controls: { destroy(): void }[] = [];
  private menu: Menu | null = null;
  /** Name being typed, or null when not editing. */
  private editing: string | null = null;
  private statusBeforeEdit = '';
  /** Removes the typing handler. */
  private endEditHook: (() => void) | null = null;
  private onLobby = () => this.drawRoster();

  constructor() {
    super(SCENES.lobby);
  }

  create(data: { mode?: LobbyMode; code?: string }): void {
    this.live = true;
    this.session = null;
    this.connecting = false;
    this.controls = [];
    this.menu = null;
    this.editing = null;
    this.endEditHook = null;
    this.code = normaliseCode(data?.code?.includes('join=') ? data.code.split('join=')[1] : (data?.code ?? ''));
    this.cameras.main.setBackgroundColor(0x120d18);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);

    const g = this.add.graphics();
    drawPanel(g, PANEL_X, 24, VIEW_W - PANEL_X * 2, VIEW_H - 48);
    text(this, VIEW_W / 2, 46, 'CO-OP', { scale: 3, origin: [0.5, 0.5], color: COLOR.gold });
    this.codeText = text(this, VIEW_W / 2, 88, '', { scale: 3, origin: [0.5, 0.5], color: COLOR.text });
    this.status = text(this, VIEW_W / 2, 114, '', { origin: [0.5, 0.5], color: COLOR.textDim });
    this.roster = this.add.container(0, 0);

    this.events.once('shutdown', () => {
      this.live = false;
      this.session?.events.off(NET_EV.lobby, this.onLobby);
    });

    const mode = data?.mode ?? 'host';
    const existing = netSession();
    if (mode === 'resume' && existing) this.enterLobby(existing);
    else if (mode === 'join') this.showJoinForm();
    else this.createHost();
  }

  // ---------------------------------------------------------------- host

  private createHost(): void {
    this.status.setText('CREATING A GAME...');
    this.setControls([new Button(this, VIEW_W / 2 - 60, BUTTON_Y, 120, 24, 'BACK', () => this.back())]);
    NetSession.host(loadProfile()).then(
      (s) => {
        if (!this.live) {
          s.close();
          return;
        }
        installSession(this.game, s);
        this.enterLobby(s);
      },
      (err: Error) => {
        if (!this.live) return;
        this.status.setText(err.message).setTint(COLOR.bad);
      },
    );
  }

  // ---------------------------------------------------------------- join

  private showJoinForm(): void {
    this.status.setText('TYPE OR PASTE THE INVITE CODE').setTint(COLOR.textDim);
    this.drawCode();
    const join = () => this.tryJoin();
    this.setControls([
      new Button(this, VIEW_W / 2 - 130, BUTTON_Y, 120, 24, 'JOIN (ENTER)', join),
      new Button(this, VIEW_W / 2 + 10, BUTTON_Y, 120, 24, 'BACK (ESC)', () => this.back()),
    ]);

    const seen = new WeakSet<KeyboardEvent>();
    const kb = this.input.keyboard!;
    const onKeyDown = (e: KeyboardEvent) => {
      if (seen.has(e) || this.session || this.connecting) return;
      seen.add(e);
      if (e.key === 'Enter') join();
      else if (e.key === 'Escape') this.back();
      else if (e.key === 'Backspace') this.setCode(this.code.slice(0, -1));
      else if (isCodeChar(e.key) && !e.ctrlKey && !e.metaKey) this.setCode(this.code + e.key);
    };
    kb.on('keydown', onKeyDown);
    const onPaste = (e: ClipboardEvent) => {
      if (this.session || this.connecting) return;
      let t = e.clipboardData?.getData('text') ?? '';
      if (t.includes('join=')) t = t.split('join=')[1];
      this.setCode(t);
    };
    window.addEventListener('paste', onPaste);
    this.events.once('shutdown', () => {
      kb.off('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    });

    // Opened from an invite link: connect straight away.
    if (this.code.length === CODE_LENGTH) join();
  }

  private setCode(raw: string): void {
    const next = normaliseCode(raw);
    if (next !== this.code) sfx.play('hover');
    this.code = next;
    this.drawCode();
  }

  private drawCode(): void {
    const shown = this.code.padEnd(CODE_LENGTH, '_').split('').join(' ');
    this.codeText.setText(shown);
  }

  private tryJoin(): void {
    if (this.connecting || this.session) return;
    if (this.code.length !== CODE_LENGTH) {
      this.status.setText(`THE CODE HAS ${CODE_LENGTH} CHARACTERS`).setTint(COLOR.bad);
      return;
    }
    this.connecting = true;
    this.status.setText('CONNECTING...').setTint(COLOR.textDim);
    NetSession.join(this.code, loadProfile()).then(
      (s) => {
        this.connecting = false;
        if (!this.live) {
          s.close();
          return;
        }
        installSession(this.game, s);
        this.enterLobby(s);
      },
      (err: Error) => {
        this.connecting = false;
        if (!this.live) return;
        this.status.setText(err.message).setTint(COLOR.bad);
      },
    );
  }

  // ---------------------------------------------------------------- shared lobby

  private enterLobby(s: NetSession): void {
    this.session = s;
    this.code = s.code;
    this.codeText.setText(s.code.split('').join(' '));
    s.events.on(NET_EV.lobby, this.onLobby);
    const character = () => this.scene.start(SCENES.select, { from: 'lobby' });
    const name = () => this.startEdit();
    if (s.isHost) {
      this.status.setText('SHARE THIS CODE OR THE LINK WITH UP TO 3 FRIENDS').setTint(COLOR.textDim);
      const start = () => hostStartRun(this.game, s);
      const copy = () => this.copyLink(s.code);
      const w = 100;
      const x0 = VIEW_W / 2 - (w * 5 + 8 * 4) / 2;
      const labels: [string, () => void][] = [
        ['START', start],
        ['CHARACTER', character],
        ['NAME', name],
        ['COPY LINK', copy],
        ['BACK', () => this.back()],
      ];
      this.setControls(
        labels.map(([label, fn], i) => new Button(this, x0 + i * (w + 8), BUTTON_Y, w, 24, label, fn)),
        true,
      );
    } else {
      this.status.setText('CONNECTED. WAITING FOR THE HOST TO START...').setTint(COLOR.good);
      const w = 110;
      const x0 = VIEW_W / 2 - (w * 3 + 8 * 2) / 2;
      const labels: [string, () => void][] = [
        ['CHARACTER', character],
        ['NAME', name],
        ['LEAVE', () => this.back()],
      ];
      this.setControls(
        labels.map(([label, fn], i) => new Button(this, x0 + i * (w + 8), BUTTON_Y, w, 24, label, fn)),
        true,
      );
    }
    this.drawRoster();
  }

  private drawRoster(): void {
    const s = this.session;
    if (!s || !this.live) return;
    this.roster.removeAll(true);
    const x0 = VIEW_W / 2 - (MAX_PLAYERS * CARD_W) / 2;
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const cx = x0 + slot * CARD_W + CARD_W / 2;
      const here = s.slots.includes(slot);
      const mine = slot === s.mySlot;
      const g = this.add.graphics();
      const edge = here ? PLAYER_COLORS[slot] : COLOR.panelEdge;
      drawPanel(g, cx - CARD_W / 2 + 5, CARD_Y, CARD_W - 10, CARD_H, edge, COLOR.inkSoft, here ? 0.9 : 0.5);
      this.roster.add(g);
      this.roster.add(text(this, cx, CARD_Y + 11, `P${slot + 1}`, { origin: [0.5, 0.5], color: here ? PLAYER_COLORS[slot] : COLOR.textDim }));
      if (!here) {
        this.roster.add(text(this, cx, CARD_Y + 70, 'OPEN', { origin: [0.5, 0.5], color: 0x5a4f73 }));
        continue;
      }
      const profile = s.profiles[slot];
      const c = characterDef(profile?.character);
      const editingMine = mine && this.editing !== null;
      const shownName = editingMine ? `${this.editing}_` : displayName(profile?.name, slot);
      this.roster.add(text(this, cx, CARD_Y + 25, shownName, { origin: [0.5, 0.5], color: editingMine ? COLOR.gold : COLOR.text }));
      const m = this.add.sprite(cx, CARD_Y + 68, ATLAS, c.firstFrame).setScale(3).play(`${c.anim}-idle`).setTint(PLAYER_TINTS[slot]);
      this.roster.add(m);
      this.roster.add(text(this, cx, CARD_Y + 108, c.name.toUpperCase(), { origin: [0.5, 0.5], color: COLOR.gold }));
      const tag = mine ? 'YOU' : slot === 0 ? 'HOST' : 'READY';
      this.roster.add(text(this, cx, CARD_Y + 124, tag, { origin: [0.5, 0.5], color: mine ? COLOR.gold : COLOR.textDim }));
    }
  }

  // ---------------------------------------------------------------- display name

  private startEdit(): void {
    const s = this.session;
    if (!s || this.editing !== null) return;
    this.editing = s.profiles[s.mySlot]?.name ?? '';
    this.statusBeforeEdit = this.status.text;
    this.status.setText(`TYPE A NAME (UP TO ${NAME_MAX}) · ENTER SAVES · ESC CANCELS`).setTint(COLOR.gold);
    if (this.menu) this.menu.enabled = false;
    const kb = this.input.keyboard!;
    const seen = new WeakSet<KeyboardEvent>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.editing === null || seen.has(e)) return;
      seen.add(e);
      if (e.key === 'Enter') this.endEdit(true);
      else if (e.key === 'Backspace') this.editing = this.editing.slice(0, -1);
      else if (isNameChar(e.key) && !e.ctrlKey && !e.metaKey && this.editing.length < NAME_MAX) this.editing += e.key.toUpperCase();
      else return;
      sfx.play('hover');
      this.drawRoster();
    };
    kb.on('keydown', onKeyDown);
    this.endEditHook = () => kb.off('keydown', onKeyDown);
    this.events.once('shutdown', () => this.endEditHook?.());
    this.drawRoster();
  }

  private endEdit(save: boolean): void {
    const s = this.session;
    if (this.editing === null) return;
    const name = sanitizeName(this.editing);
    this.editing = null;
    this.endEditHook?.();
    this.endEditHook = null;
    this.status.setText(this.statusBeforeEdit).setTint(s?.isHost ? COLOR.textDim : COLOR.good);
    if (this.menu) this.menu.enabled = true;
    if (save && s) {
      const profile = { ...loadProfile(), name };
      saveProfile(profile);
      s.setMyProfile({ name, character: s.profiles[s.mySlot]?.character ?? profile.character });
    }
    this.drawRoster();
  }

  private copyLink(code: string): void {
    const url = `${window.location.origin}${window.location.pathname}?join=${code}`;
    const done = () => this.status.setText('LINK COPIED. SEND IT TO YOUR FRIENDS').setTint(COLOR.good);
    const fail = () => this.status.setText(`COPY FAILED. CODE: ${code}`).setTint(COLOR.bad);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, fail);
    else fail();
  }

  // ---------------------------------------------------------------- helpers

  private setControls(buttons: Button[], menu = false): void {
    for (const c of this.controls) c.destroy();
    this.controls = buttons.map((b) => ({
      destroy: () => {
        b.g.destroy();
        b.label.destroy();
        b.zone.destroy();
      },
    }));
    if (menu) {
      this.menu = new Menu(this, buttons, true);
      // ESC cancels a name being typed before it leaves the lobby.
      onKey(this, 'keydown-ESC', () => (this.editing !== null ? this.endEdit(false) : this.back()));
    }
  }

  private back(): void {
    leaveSession(this.game, this.session ?? netSession());
  }
}
