import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { ARENA_SIZE, DEPTH } from '../constants';
import { ENEMIES, WEAPONS } from '../data';
import { EF, type SnapEntity } from './protocol';

export const SNAPSHOT_HZ = 20;
const STEP = 1 / SNAPSHOT_HZ;
const GEM_COLORS = ['blue', 'green', 'red'] as const;

interface Shown {
  s: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Bob | null;
  kind: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  frame: number;
}

/**
 * One kind of host-simulated object drawn on a joiner's screen. Each snapshot gives target
 * positions; sprites glide from where they are to there over one snapshot interval.
 */
class Layer {
  private shown = new Map<number, Shown>();
  private pool: Shown[] = [];
  private frame = 0;

  constructor(
    private scene: Phaser.Scene,
    private setup: (o: Shown, e: SnapEntity, fresh: boolean) => void,
    private place: (o: Shown) => void,
    private shadows: Phaser.GameObjects.Blitter | null = null,
  ) {}

  apply(list: SnapEntity[]): void {
    const frame = ++this.frame;
    for (const e of list) {
      let o = this.shown.get(e.id);
      const fresh = !o;
      if (!o) {
        o = this.pool.pop() ?? {
          s: this.scene.add.sprite(0, 0, ATLAS, 'px'),
          shadow: null,
          kind: -1,
          fromX: 0,
          fromY: 0,
          toX: 0,
          toY: 0,
          t: 1,
          frame: 0,
        };
        o.s.setVisible(true).setActive(true);
        o.fromX = o.toX = e.x;
        o.fromY = o.toY = e.y;
        o.s.setPosition(e.x, e.y);
        this.shown.set(e.id, o);
      } else {
        o.fromX = o.s.x;
        o.fromY = o.s.y;
        o.toX = e.x;
        o.toY = e.y;
      }
      o.t = 0;
      o.frame = frame;
      this.setup(o, e, fresh);
    }
    for (const [id, o] of this.shown) {
      if (o.frame === frame) continue;
      o.s.setVisible(false).setActive(false);
      o.s.anims.stop();
      if (o.shadow) o.shadow.visible = false;
      o.kind = -1;
      this.shown.delete(id);
      this.pool.push(o);
    }
  }

  update(dt: number): void {
    for (const o of this.shown.values()) {
      o.t = Math.min(1, o.t + dt / STEP);
      o.s.setPosition(o.fromX + (o.toX - o.fromX) * o.t, o.fromY + (o.toY - o.fromY) * o.t);
      this.place(o);
    }
  }

  get count(): number {
    return this.shown.size;
  }

  /** Shadow bob for an object (created on first use). */
  shadowFor(o: Shown, frame: string): Phaser.GameObjects.Bob {
    if (!o.shadow) o.shadow = this.shadows!.create(0, 0, frame);
    else o.shadow.setFrame(frame);
    o.shadow.visible = true;
    return o.shadow;
  }
}

/** Joiner side: enemies, gems and projectiles as the host last reported them. */
export class Mirror {
  readonly enemies: Layer;
  readonly gems: Layer;
  readonly projectiles: Layer;
  readonly potions: Layer;

  constructor(scene: Phaser.Scene) {
    const shadows = scene.add.blitter(0, 0, ATLAS).setDepth(DEPTH.shadows);
    this.enemies = new Layer(
      scene,
      (o, e, fresh) => {
        const def = ENEMIES[e.kind];
        if (!def) return;
        if (fresh || o.kind !== e.kind) {
          o.kind = e.kind;
          o.s.setTexture(ATLAS, def.firstFrame).play({ key: def.anim, startFrame: Math.floor(Math.random() * 4) }, true);
          o.s.setAlpha(1).setScale(1);
          this.enemies.shadowFor(o, def.shadow);
        }
        o.s.setFlipX((e.extra & EF.flip) !== 0);
        if (e.extra & EF.flash) o.s.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        else o.s.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      },
      (o) => {
        const def = ENEMIES[o.kind];
        if (!def) return;
        o.s.setDepth(DEPTH.units + o.s.y / ARENA_SIZE);
        if (o.shadow) {
          const sw = def.shadow === 'shadow_l' ? 24 : 12;
          o.shadow.x = o.s.x - sw / 2;
          o.shadow.y = o.s.y + o.s.height / 2 - 3 + def.hover;
        }
      },
      shadows,
    );
    this.gems = new Layer(
      scene,
      (o, e, fresh) => {
        if (!fresh && o.kind === e.kind) return;
        o.kind = e.kind;
        o.s.setDepth(DEPTH.gems).setScale(1).clearTint().setAlpha(1);
        o.s.play({ key: `gem-${GEM_COLORS[e.kind] ?? 'blue'}`, startFrame: Math.floor(Math.random() * 2) }, true);
      },
      () => {},
    );
    this.projectiles = new Layer(
      scene,
      (o, e, fresh) => {
        if (fresh || o.kind !== e.kind) {
          o.kind = e.kind;
          const anim = WEAPONS[e.kind]?.projectileAnim;
          if (anim) o.s.play(anim, true);
          o.s.setDepth(DEPTH.projectiles).clearTint().setAlpha(1);
        }
        o.s.setScale(e.extra / 32);
      },
      () => {},
    );
    this.potions = new Layer(
      scene,
      (o, e, fresh) => {
        if (fresh) {
          o.kind = 0;
          o.s.anims.stop();
          o.s.setTexture(ATLAS, 'potion').setDepth(DEPTH.gems).setScale(1).clearTint();
        }
        o.s.setAlpha(e.extra ? 0.3 : 1);
      },
      () => {},
    );
  }

  update(dt: number): void {
    this.potions.update(dt);
    this.enemies.update(dt);
    this.gems.update(dt);
    this.projectiles.update(dt);
  }
}
