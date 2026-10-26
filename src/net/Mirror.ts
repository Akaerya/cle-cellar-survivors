import Phaser from 'phaser';
import { ATLAS } from '../art/textures';
import { ARENA_SIZE, CHILL_TINT, DEPTH, STUN_TINT } from '../constants';
import { ALL_ENEMIES, ATTACK_DEFS, HAZARDS, enemyModifier } from '../data';
import { PLAYER_RADIUS } from '../data/player';
import type { ChainsDef } from '../data/types';
import { SHADOW_W, randomStartFrame } from '../entities/Enemy';
import type { RareView } from '../systems/RareVisuals';
import { EF, type SnapEntity, type SnapRare } from './protocol';

export const SNAPSHOT_HZ = 20;
const STEP = 1 / SNAPSHOT_HZ;
const GEM_COLORS = ['blue', 'green', 'red'] as const;
/** How see-through an enemy Spirit Walker brought back is drawn. */
const SPIRIT_ALPHA = enemyModifier('spirit_walker').alpha;

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
    private place: (o: Shown, dt: number) => void,
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
      this.place(o, dt);
    }
  }

  get count(): number {
    return this.shown.size;
  }

  /** The sprite drawn for net id `id`, if it is on screen. */
  get(id: number): Phaser.GameObjects.Sprite | undefined {
    return this.shown.get(id)?.s;
  }

  /** The kind of the object with net id `id`, if it is on screen. */
  kindOf(id: number): number | undefined {
    return this.shown.get(id)?.kind;
  }

  forEach(fn: (o: Shown) => void): void {
    for (const o of this.shown.values()) fn(o);
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
  readonly hazards: Layer;
  /** Rare enemies from the last snapshot that are on screen, for RareVisuals. */
  rareViews: RareView[] = [];

  constructor(scene: Phaser.Scene) {
    const shadows = scene.add.blitter(0, 0, ATLAS).setDepth(DEPTH.shadows);
    this.enemies = new Layer(
      scene,
      (o, e, fresh) => {
        const def = ALL_ENEMIES[e.kind];
        if (!def) return;
        if (fresh || o.kind !== e.kind) {
          o.kind = e.kind;
          o.s.setTexture(ATLAS, def.firstFrame).play({ key: def.anim, startFrame: randomStartFrame(scene, def.anim) }, true);
          o.s.setScale(def.scale ?? 1).setRotation(0);
          this.enemies.shadowFor(o, def.shadow);
        }
        o.s.setAlpha(e.extra & EF.spirit ? SPIRIT_ALPHA : 1);
        o.s.setFlipX((e.extra & EF.flip) !== 0);
        if (e.extra & EF.flash) o.s.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        else if (e.extra & EF.stun) o.s.setTint(STUN_TINT).setTintMode(Phaser.TintModes.MULTIPLY);
        else if (e.extra & EF.chill) o.s.setTint(CHILL_TINT).setTintMode(Phaser.TintModes.MULTIPLY);
        else o.s.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      },
      (o) => {
        const def = ALL_ENEMIES[o.kind];
        if (!def) return;
        o.s.setDepth(DEPTH.units + o.s.y / ARENA_SIZE);
        if (o.shadow) {
          o.shadow.x = o.s.x - SHADOW_W[def.shadow] / 2;
          o.shadow.y = o.s.y + o.s.displayHeight / 2 - 3 * (def.scale ?? 1) + def.hover;
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
          const anim = ATTACK_DEFS[e.kind]?.projectileAnim;
          if (anim) o.s.play(anim, true);
          o.s.setDepth(DEPTH.projectiles).clearTint().setAlpha(1).setRotation(0);
        }
        o.s.setScale(e.extra / 32);
      },
      (o) => {
        // Arrows face the way they move between snapshots.
        if (!ATTACK_DEFS[o.kind]?.orient) return;
        const dx = o.toX - o.fromX;
        const dy = o.toY - o.fromY;
        if (dx * dx + dy * dy > 0.25) o.s.setRotation(Math.atan2(dy, dx));
      },
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
    this.hazards = new Layer(
      scene,
      (o, e, fresh) => {
        const def = HAZARDS[e.kind];
        if (!def) return;
        if (fresh || o.kind !== e.kind) {
          o.kind = e.kind;
          o.s.anims.stop();
          o.s.setTexture(ATLAS, def.frame).setScale(def.radius / def.artRadius).clearTint().setRotation(0);
          if (def.anim) o.s.play(def.anim, true);
          o.s.setDepth(def.ground ? DEPTH.shadows + 0.5 : DEPTH.projectiles - 1);
        }
        o.s.setAlpha(e.extra / 255);
      },
      (o, dt) => {
        const spin = HAZARDS[o.kind]?.spin;
        if (spin) o.s.rotation += spin * dt;
      },
    );
  }

  /** Move speed multiplier for this joiner's own character at (x, y): webs from the last snapshot slow it. */
  slowAt(x: number, y: number): number {
    let slow = 0;
    this.hazards.forEach((o) => {
      const def = HAZARDS[o.kind];
      if (!def?.slow) return;
      const r = def.radius + PLAYER_RADIUS;
      if ((o.s.x - x) ** 2 + (o.s.y - y) ** 2 <= r * r) slow = Math.max(slow, def.slow);
    });
    return 1 - slow;
  }

  /** Mirrors Bosses.chainsAt: the void field's Astral Chains this joiner's character stands in, if any. */
  chainsAt(x: number, y: number): ChainsDef | null {
    let chains: ChainsDef | null = null;
    this.hazards.forEach((o) => {
      const def = HAZARDS[o.kind];
      if (chains || !def?.chains) return;
      const r = def.radius + PLAYER_RADIUS;
      if ((o.s.x - x) ** 2 + (o.s.y - y) ** 2 <= r * r) chains = def.chains;
    });
    return chains;
  }

  /** The snapshot's rare enemies; call after `enemies.apply` so their sprites are known. */
  applyRares(list: SnapRare[]): void {
    this.rareViews = [];
    for (const r of list) {
      const sprite = this.enemies.get(r.id);
      const def = ALL_ENEMIES[this.enemies.kindOf(r.id) ?? -1];
      if (sprite && def) this.rareViews.push({ sprite, radius: def.radius, mask: r.mask, enrage: r.enrage, souls: r.souls });
    }
  }

  update(dt: number): void {
    this.hazards.update(dt);
    this.potions.update(dt);
    this.enemies.update(dt);
    this.gems.update(dt);
    this.projectiles.update(dt);
  }
}
