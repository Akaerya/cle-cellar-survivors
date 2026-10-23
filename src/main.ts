import Phaser from 'phaser';
import { VIEW_H, VIEW_W } from './constants';
import { sfx } from './core/sfx';
import { BootScene } from './scenes/BootScene';
import { GameOverScene } from './scenes/GameOverScene';
import { GameScene } from './scenes/GameScene';
import { LevelUpScene } from './scenes/LevelUpScene';
import { PauseScene } from './scenes/PauseScene';
import { TitleScene } from './scenes/TitleScene';
import { UIScene } from './scenes/UIScene';

const params = new URLSearchParams(window.location.search);

const config: Phaser.Types.Core.GameConfig = {
  // WebGL by default; ?canvas forces the (deprecated) canvas renderer for very old machines.
  type: params.has('canvas') ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: VIEW_W,
  height: VIEW_H,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#120d18',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      // Fixed 60 Hz step: gameplay is the same on 60 Hz and 144 Hz screens.
      fps: 60,
      fixedStep: true,
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  audio: { noAudio: true }, // placeholder SFX are synthesised in core/sfx.ts
  input: { keyboard: true, mouse: true, touch: false, gamepad: false },
  disableContextMenu: true,
  // Scene order is draw order: HUD over the run, menus over the HUD.
  scene: [BootScene, TitleScene, GameScene, UIScene, LevelUpScene, PauseScene, GameOverScene],
};

new Phaser.Game(config);

// Keyboard focus: clicking anywhere on the page focuses the game (useful inside iframes).
window.addEventListener('pointerdown', () => {
  window.focus();
  sfx.unlock();
});
// Browsers only allow audio after a user gesture; any key press counts.
window.addEventListener('keydown', () => sfx.unlock());
