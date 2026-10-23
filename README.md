# Banana Nocturne

A survivor-like for desktop browsers, built to the MVP spec. A monkey runs around a walled graveyard throwing bananas automatically while waves of bats, zombies, ghouls and brutes close in. Survive until 15:00 and dawn breaks.

Phaser 4.2.1, TypeScript, Vite, Arcade Physics. No backend, no asset files: all pixel art, fonts and sounds are generated at boot from data in `src/art`.

## Run it

```bash
npm install
npm run dev            # dev server with hot reload
npm run build          # static site in dist/
npm run build:single   # one self-contained dist/index.html
npm run typecheck
```

URL options:

| Param | Effect |
| --- | --- |
| `?seed=1234` | Fixed RNG seed. The same seed replays the same spawns, card offers and arena layout. The seed is shown on the end screen and in the debug overlay. |
| `?play` | Skip the title screen. |
| `?canvas` | Force Phaser's canvas renderer (deprecated in v4; only for machines without WebGL). |

## Controls

WASD or arrow keys to move. Weapons fire on their own. Esc or P pauses (the game also pauses when the window loses focus). M mutes. F3 opens the debug overlay. Level-up cards: 1, 2, 3, arrows and Enter, or click.

## Layout

```
src/
  main.ts              game config: 640x360, pixelArt, FIT scaling, Arcade at a fixed 60 Hz
  constants.ts         engine constants (arena size, caps, depths, colours, scene keys)
  data/                everything a designer tunes
    weapons.ts items.ts enemies.ts waves.ts player.ts types.ts
  core/
    progression.ts     level curve, weapon stats per level, player stat calculation
    rng.ts             seeded RNG (one per run)
    spatialGrid.ts     64 px grid for enemy push-apart and area hit queries
    sfx.ts             placeholder sound effects synthesised with WebAudio
    events.ts          event names between scenes
  art/
    spriteData.ts      every sprite and tile as a character grid + palette
    font.ts            hand-drawn pixel fonts
    textures.ts        builds the texture atlas, tileset, bitmap fonts and animations
  entities/            Player, Enemy, Projectile, Gem (pooled)
  systems/             Arena, Enemies, Weapons, Gems, Spawner, Fx
  scenes/              Boot, Title, Game, UI (HUD), LevelUp, Pause, GameOver
  ui/widgets.ts        bitmap text, panels, buttons, keyboard menus
```

## Adding content

Every weapon, item, enemy and wave is a data entry. Engine code reads them generically.

**A weapon** goes in `data/weapons.ts`. Behaviour comes from `targeting`:

- `nearest`: projectiles aimed at the closest enemy within `range`; holds fire when nothing is in range.
- `facing`: projectiles in the monkey's facing direction, or a melee sweep of `arc` degrees and `size` reach when `speed` is 0.
- `random`: projectiles in a random direction.
- `orbit`: `projectileCount` objects circle the monkey at `range`, hitting each enemy at most once per `cooldown`.
- `aura`: everything within `size` takes damage every `cooldown`.

`levels` holds the changes for levels 2 to 5, each with card text and `add`, `mul` or `set` stat changes. Example, a bone that flies in a random direction:

```ts
{
  id: 'bone', name: 'Bone Toss', description: 'Throws a bone in a random direction.',
  icon: 'icon_banana', targeting: 'random', projectileAnim: 'banana-spin', artRadius: 5,
  stats: { cooldown: 0.9, damage: 8, projectileCount: 1, speed: 300, pierce: 2, lifetime: 1.2,
           size: 5, knockback: 6, spread: 0, range: 0, arc: 0, boomerang: false },
  levels: [
    { text: '+1 bone.', add: { projectileCount: 1 } },
    { text: '+25% damage.', mul: { damage: 1.25 } },
    { text: '+1 bone.', add: { projectileCount: 1 } },
    { text: 'Bones return.', set: { boomerang: true } },
  ],
}
```

**An item** goes in `data/items.ts` with `perLevel` modifiers. Each modifier changes one stat from `data/player.ts` by `flat` and/or `percent`. Final stat = (base + flat) x (1 + percent), summed over item levels.

**An enemy** goes in `data/enemies.ts`, then gets a weight in a `data/waves.ts` row. New art needs a grid in `art/spriteData.ts` and an animation line in `art/textures.ts`.

**Waves** are rows keyed by minute (`from` inclusive, `to` exclusive) with a target count and spawn weights. HP scales by `HP_SCALE_PER_MINUTE`. Timed events (the 5:00 and 10:00 bat swarms) are in `WAVE_EVENTS`.

## Art

All art is drawn on the 16 px grid as character grids in `src/art/spriteData.ts`: one character per pixel, mapped through `PALETTE`. Edit a grid to redraw a sprite. At boot, `textures.ts` packs every sprite into one atlas and the tiles into an extruded tileset.

The spec names 0x72's CC0 [16x16 DungeonTileset II](https://0x72.itch.io/dungeontileset-ii) for enemies and tiles. The build machine could not reach itch.io, so enemies and tiles are hand-drawn placeholders in the same palette family and frame sizes (zombie 16x18, ghoul 16x16, brute 28x30, tiles 16x16). To use the pack, load its sheet in `BootScene`, register frames named like the existing ones (`zombie_0`..`zombie_3`, `floor_a`, `wall_top` and so on), and drop the matching grids. Nothing else references art by anything but frame name.

## Debug overlay (F3)

FPS, live enemies against the wave target, projectiles, gems, damage numbers, physics bodies, minute and seed, with Arcade debug bodies drawn over the world. Buttons spawn 50 enemies, add a level, skip a minute, and toggle god mode.

## Decisions made while building

Where the spec left room, these are the calls taken. All are easy to change.

- **Pierce** counts enemies hit before the projectile vanishes, so the starting banana hits one enemy. At level 5 the boomerang turns around when its outbound pierce runs out or after 0.9 s, whichever comes first, and gets a fresh pierce for the return trip.
- **Banana range** is 340 px. With nothing in range it holds fire and shoots the moment a target appears.
- **Coconut Orbit and Howler Aura** use `cooldown` as the time between hits on the same enemy (orbit) or between pulses (aura), so the Tome speeds them up too.
- **Tail Whip** "area" is its reach. It hits everything in a 150 degree arc in the facing direction.
- **Heart** adds the extra max HP to current HP as well, so taking it never makes the bar look emptier.
- **Spawner** tops up at most a sixth of the target per 0.5 s tick, so a cleared screen refills as a stream rather than one ring.
- **Stragglers**: an enemy more than 1.5 screen widths away horizontally, or 1.5 screen heights vertically, is moved back to the ring just outside the view, keeping its HP.
- **Fallback card** when everything is maxed is called Banana Bunch and heals 30 HP.
- **Keyboard**: Phaser 4 re-scans its key queue on every DOM key event until the frame ends, so two keys pressed within one frame re-emit the first. `onKey` in `ui/widgets.ts` ignores events a handler has already seen.

## Performance

Checked in headless Chromium on a 2-core 2.1 GHz VM with software-rendered WebGL: 300 enemies, 200 projectiles, 180 gems and 90 damage numbers on screen at once. The main thread was 83% idle while profiling; frame time there is dominated by the software GPU. Enemy push-apart runs on the spatial grid, not enemy-vs-enemy physics, and enemies, projectiles, gems and damage numbers are all pooled.
