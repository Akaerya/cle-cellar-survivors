import Phaser from 'phaser';
import { buildAllTextures } from '../art/textures';
import { SCENES } from '../constants';

/** Builds every texture, font and animation from the pixel data, then shows the title. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.boot);
  }

  create(): void {
    buildAllTextures(this);
    // ?play skips the title screen (handy while developing).
    const play = new URLSearchParams(window.location.search).has('play');
    this.scene.start(play ? SCENES.game : SCENES.title, {});
  }
}
