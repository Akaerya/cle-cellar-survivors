import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { COLOR, MAX_PLAYERS, PLAYER_COLORS, PLAYER_TINTS, SCENES, VIEW_H, VIEW_W } from '../constants';
import { sfx } from '../core/sfx';
import { hostStartRun, installSession, leaveSession } from '../net/flow';
import { CODE_LENGTH, NET_EV, NetSession, isCodeChar, netSession, normaliseCode } from '../net/Net';
import { Button, Menu, drawPanel, onKey, text } from '../ui/widgets';

type LobbyMode = 'host' | 'join' | 'resume';

/**
 * Co-op lobby. Host: gets an invite code and link, sees who has joined, starts the run.
 * Join: types or pastes a code, then waits for the host to start.
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
  private onLobby = () => this.drawRoster();

  constructor() {
    super(SCENES.lobby);
  }

  create(data: { mode?: LobbyMode; code?: string }): void {
    this.live = true;
    this.session = null;
    this.connecting = false;
    this.controls = [];
    this.code = normaliseCode(data?.code?.includes('join=') ? data.code.split('join=')[1] : (data?.code ?? ''));
    this.cameras.main.setBackgroundColor(0x120d18);
    this.add.image(0, 0, 'vignette').setOrigin(0).setDisplaySize(VIEW_W, VIEW_H);

    const g = this.add.graphics();
    drawPanel(g, 90, 24, VIEW_W - 180, VIEW_H - 48);
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
    this.setControls([new Button(this, VIEW_W / 2 - 60, 290, 120, 24, 'BACK', () => this.back())]);
    NetSession.host().then(
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
      new Button(this, VIEW_W / 2 - 130, 290, 120, 24, 'JOIN (ENTER)', join),
      new Button(this, VIEW_W / 2 + 10, 290, 120, 24, 'BACK (ESC)', () => this.back()),
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
    NetSession.join(this.code).then(
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
    if (s.isHost) {
      this.status.setText('SHARE THIS CODE OR THE LINK WITH UP TO 3 FRIENDS').setTint(COLOR.textDim);
      const start = () => hostStartRun(this.game, s);
      const copy = () => this.copyLink(s.code);
      this.setControls(
        [
          new Button(this, VIEW_W / 2 - 190, 290, 120, 24, 'START', start),
          new Button(this, VIEW_W / 2 - 60, 290, 120, 24, 'COPY LINK', copy),
          new Button(this, VIEW_W / 2 + 70, 290, 120, 24, 'BACK', () => this.back()),
        ],
        true,
      );
    } else {
      this.status.setText('CONNECTED. WAITING FOR THE HOST TO START...').setTint(COLOR.good);
      this.setControls([new Button(this, VIEW_W / 2 - 60, 290, 120, 24, 'LEAVE', () => this.back())], true);
    }
    this.drawRoster();
  }

  private drawRoster(): void {
    const s = this.session;
    if (!s || !this.live) return;
    this.roster.removeAll(true);
    const w = 96;
    const x0 = VIEW_W / 2 - (MAX_PLAYERS * w) / 2;
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const cx = x0 + slot * w + w / 2;
      const here = s.slots.includes(slot);
      const g = this.add.graphics();
      drawPanel(g, cx - w / 2 + 6, 136, w - 12, 128, here ? PLAYER_COLORS[slot] : COLOR.panelEdge, COLOR.inkSoft, here ? 0.9 : 0.5);
      this.roster.add(g);
      this.roster.add(text(this, cx, 148, `P${slot + 1}`, { scale: 2, origin: [0.5, 0.5], color: here ? PLAYER_COLORS[slot] : COLOR.textDim }));
      if (here) {
        const m = this.add.sprite(cx, 202, ATLAS, 'monkey_idle_0').setScale(3).play('monkey-idle').setTint(PLAYER_TINTS[slot]);
        this.roster.add(m);
        const tag = slot === s.mySlot ? 'YOU' : slot === 0 ? 'HOST' : 'READY';
        this.roster.add(text(this, cx, 250, tag, { origin: [0.5, 0.5], color: slot === s.mySlot ? COLOR.gold : COLOR.text }));
      } else {
        this.roster.add(text(this, cx, 202, 'OPEN', { origin: [0.5, 0.5], color: 0x5a4f73 }));
      }
    }
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
      new Menu(this, buttons, true);
      onKey(this, 'keydown-ESC', () => this.back());
    }
  }

  private back(): void {
    leaveSession(this.game, this.session ?? netSession());
  }
}
