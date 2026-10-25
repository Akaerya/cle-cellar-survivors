import Phaser from 'phaser';
import { buildAllTextures, loadSpriteSheets } from '../art/textures';
import { SCENES } from '../constants';

/** Loads the sprite sheets, builds every texture, font and animation, then shows the title. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.boot);
  }

  preload(): void {
    loadSpriteSheets(this);
  }

  create(): void {
    buildAllTextures(this);
    // ?play skips the title screen (handy while developing).
    const params = new URLSearchParams(window.location.search);
    // ?join=CODE (the host's invite link) opens the lobby with the code filled in.
    const join = params.get('join');
    if (join) this.scene.start(SCENES.lobby, { mode: 'join', code: join });
    else this.scene.start(params.has('play') ? SCENES.game : SCENES.title, {});
  }
}
