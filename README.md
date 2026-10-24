# Cle Cellar Survivors

A survivor-like for desktop browsers where you play as members of the Cle Cellar Discord server. Pick a character, run around a walled graveyard while your weapons fire on their own, and survive the waves of bats, zombies, ghouls and brutes until 15:00, when dawn breaks. Play solo or with up to 3 friends online.

## Characters

| Character | Kit | Ultimate (Q) |
| --- | --- | --- |
| **rsncle**, the banana monkey | Banana Throw (start), Tail Whip, Coconut Orbit, Howler Aura | **Banana Storm**: a spiral of bananas around you for 15 s, 150 s cooldown |
| **yookers**, the storm knight | Stormblade (start; a sword stab that reaches further with levels), Thunder Breath (a lightning cone on a cooldown), Thunderstrike (bolts land at random around you; more bolts and more often with levels), Storm Shield (blocks a hit every 30 s, absorbs 10-25% of the rest) | **Storm Drake**: a small dragon follows you and spits lightning orbs at enemies for 25 s, 150 s cooldown |

Each character has its own four weapons (level-up cards only offer your character's); items, modifications, powerups and base stats are shared.

Level-up cards can also offer:

- **Modifications** (up to level 5, no slots) change every weapon that shares one of their tags. Projectile: Pierce, Splits, Chain. AoE: Increased AoE, Reduced AoE, Echo Strike. Duration: Increase Duration, Less Duration, Reiterate. A modification is offered once you own a weapon it changes. rsncle's Banana Throw is tagged projectile, Coconut Orbit projectile and AoE, Tail Whip and Howler Aura AoE; yookers' weapons have no tags yet, and no weapon has the duration tag yet.
- **Generic powerups** (up to level 20, no slots): Damage, Maximum Health, Ability Haste, Movement Speed, Health Regen, Damage Taken. The HUD shows your ultimate under your build: green edge when ready, gold with a bar while it runs, greyed out with the seconds left while it recharges. In co-op every teammate's ultimate is shown the same way next to their name and HP.

After every run the **party screen** lists each player's damage, DPS, kills, damage taken, healing, shield blocks, deaths, revives and ultimates cast, and for the selected player every weapon (and the ultimate) with its level, damage, DPS, kills and share of their damage.

Phaser 4.2.1, TypeScript, Vite, Arcade Physics. No backend, no asset files: all pixel art, fonts and sounds are generated at boot from data in `src/art`.

## Run it

```bash
npm install
npm run dev            # dev server with hot reload
npm run build          # static site in dist/
npm run build:single   # one self-contained dist/index.html
npm run typecheck
```

### Deploy to GitHub Pages

`.github/workflows/deploy.yml` builds the game and publishes `dist/` on every push to `main`.

1. Push this folder to a GitHub repository with `main` as the default branch.
2. In the repository, open Settings > Pages and set Build and deployment > Source to **GitHub Actions**.
3. Push again, or run the workflow from the Actions tab. The game appears at `https://<user>.github.io/<repo>/`.

`base: './'` in `vite.config.ts` keeps every asset path relative, so the same build works at any sub-path. Commit the `package-lock.json` that `npm install` creates and the workflow switches to `npm ci` for reproducible installs.

URL options:

| Param | Effect |
| --- | --- |
| `?seed=1234` | Fixed RNG seed. The same seed replays the same spawns, card offers and arena layout. The seed is shown on the end screen and in the debug overlay. |
| `?play` | Skip the title screen (plays the last character you picked). |
| `?canvas` | Force Phaser's canvas renderer (deprecated in v4; only for machines without WebGL). |

## Co-op (up to 4 players)

Title screen > **HOST CO-OP** gives a 5-character invite code and a **COPY LINK** button (`?join=CODE`). Friends press **JOIN CO-OP** and type or paste the code, or just open the link. In the lobby everyone picks a character (**CHARACTER**) and can set a display name (**NAME**, up to 10 characters; without one you are P1 to P4). Names show over each character, in the teammate list and on the party screen. Name and character are remembered in `localStorage`. The host presses **START** when everyone is in.

- **Networking**: peer to peer over WebRTC with [PeerJS](https://peerjs.com). PeerJS's free public broker only introduces the browsers (the invite code is the host's peer id); game traffic goes directly between them. No server of our own is needed, so it still deploys to GitHub Pages.
- **Host-authoritative**: the host's browser simulates enemies, weapons, damage and gems and sends each joiner a binary snapshot 20 times a second (only what is near their screen), plus effects and sounds. Joiners move their own character locally and report its position, so movement has no input lag. Pressing Q asks the host to cast; ultimate timers come back in the snapshots.
- **Shared EXP**: one EXP bar and level for the team. Each level gives every player their own card pick; the run is held until everyone has chosen. A gem goes to whichever player's pickup radius it enters, using that player's EXP Gain.
- **Enemy HP** is multiplied by `1 + 0.75 x (players - 1)` (`HP_SCALE_PER_EXTRA_PLAYER` in `data/waves.ts`). Enemies chase the nearest living player and spawn around a random one.
- A fallen player spectates a teammate. Standing on the body for 5 seconds revives them at 80% HP; the team's deaths are counted for the run and each later death revives with less (80, 75, 65, 50, 30%, floor 10%; `data/coop.ts`). Fallen players keep their level-up picks for when they are back. The run ends when all are down. Players who disconnect are removed; if the host leaves, the run ends for everyone.
- The co-op menu (Esc) does not pause the run, and the game does not auto-pause on blur. Browsers stop animating hidden tabs, so the host should keep the game tab visible.
- After a run the host can play again with the same group or go back to the lobby so others can join.

Code lives in `src/net/` (session, lobby profiles, message and snapshot format, the joiner-side renderer) and `scenes/LobbyScene.ts`.

## Wiki

Title screen > **WIKI** (also in the pause menu) lists every character, ultimate, weapon, item, monster, wave, drop and co-op rule with its numbers, read straight from `src/data`. The prose lives in `src/wiki/pages.ts`; keep it current when adding content or mechanics (see `CLAUDE.md`).

## Controls

WASD or arrow keys to move. Weapons fire on their own. Q casts your ultimate. Esc or P pauses (the game also pauses when the window loses focus). M mutes. F3 opens the debug overlay. Level-up cards: 1, 2, 3, arrows and Enter, or click.

## Layout

```
src/
  main.ts              game config: 640x360, pixelArt, FIT scaling, Arcade at a fixed 60 Hz
  constants.ts         engine constants (arena size, caps, depths, colours, scene keys)
  data/                everything a designer tunes
    characters.ts ultimates.ts weapons.ts modifications.ts items.ts powerups.ts enemies.ts waves.ts drops.ts coop.ts player.ts types.ts
  wiki/pages.ts        in-game wiki pages, built from data/
  core/
    progression.ts     level curve, weapon stats per level, player stat calculation
    rng.ts             seeded RNG (one per run)
    spatialGrid.ts     64 px grid for enemy push-apart and area hit queries
    sfx.ts             placeholder sound effects synthesised with WebAudio
    events.ts          event names between scenes, run summary and per-player stats
    profile.ts         display name and character, kept in localStorage
  art/
    spriteData.ts      every sprite and tile as a character grid + palette
    font.ts            hand-drawn pixel fonts
    textures.ts        builds the texture atlas, tileset, bitmap fonts and animations
  entities/            Player, Enemy, Projectile, Gem, Potion (pooled)
  systems/             Arena, Enemies, Weapons, Ultimate, Gems, Potions, Spawner, Fx
  scenes/              Boot, Title, CharacterSelect, Lobby, Game, UI (HUD), LevelUp, Pause, GameOver (party screen), Wiki
  ui/widgets.ts        bitmap text, panels, buttons, keyboard menus
```

## Adding content

Every character, ultimate, weapon, item, enemy and wave is a data entry. Engine code reads them generically.

**A character** goes in `data/characters.ts`: a name, art (`anim` prefix with `-idle`, `-walk` and `-hurt` animations in `art/textures.ts`), a starting weapon, its weapon kit (the ids level-up cards may offer) and an ultimate id.

**An ultimate** goes in `data/ultimates.ts`. `kind: 'storm'` fires `count` projectiles from the caster every `interval` in a spiral turning `spin` degrees per second; `kind: 'pet'` summons a pet that follows the caster and fires at the closest enemy within `attack.stats.range`. `duration` and `cooldown` are in seconds. `attack` is a weapon definition for the projectile, so it shares the projectile pool, the co-op sync and the damage counting. The HUD greys out the `icon`, using an `_grey` copy that `textures.ts` builds for every `icon_ult_*` sprite.

**A weapon** goes in `data/weapons.ts` (and in a character's `weapons` list). `tags` (`projectile`, `aoe`, `duration`) decide which modifications change it. `stats.repeat` repeats each attack that many times, `repeatDelay` seconds apart. `effect` (damage, interval, duration) makes every hit leave a damage-over-time stack on the enemy; give such a weapon the `duration` tag. Behaviour comes from `targeting`:

- `nearest`: projectiles aimed at the closest enemy within `range`; holds fire when nothing is in range.
- `facing`: projectiles in the facing direction, or a melee sweep of `arc` degrees and `size` reach when `speed` is 0.
- `random`: projectiles in a random direction.
- `orbit`: `projectileCount` objects circle the owner at `range`, hitting each enemy at most once per `cooldown`.
- `aura`: everything within `size` takes damage every `cooldown`.
- `stab`: a blade `size` px long and `arc` px wide thrust at the closest enemy.
- `breath`: a cone of `arc` degrees and `size` reach sprayed at the closest enemy every `cooldown`.
- `strike`: `projectileCount` bolts every `cooldown`, each on a random enemy within `range` (or a random spot), hitting everything within `size`.
- `shield`: blocks one hit, then recharges for `cooldown`; `reduction` is the fraction of other hits it absorbs.

`levels` holds the changes for levels 2 to 5, each with card text and `add` (flat), `pct` (percent of the base value), `faster` (attack rate) or `set` stat changes. Percents and `faster` add up over levels: four `pct: { size: 0.15 }` levels are +60%, and four `faster: 0.4` levels divide the cooldown by 2.6. Example, a bone that flies in a random direction:

```ts
{
  id: 'bone', name: 'Bone Toss', description: 'Throws a bone in a random direction.',
  icon: 'icon_banana', targeting: 'random', projectileAnim: 'banana-spin', artRadius: 5,
  stats: { cooldown: 0.9, damage: 8, projectileCount: 1, speed: 300, pierce: 2, lifetime: 1.2,
           size: 5, knockback: 6, spread: 0, range: 0, arc: 0, boomerang: false },
  levels: [
    { text: '+1 bone.', add: { projectileCount: 1 } },
    { text: '+25% damage.', pct: { damage: 0.25 } },
    { text: '+1 bone.', add: { projectileCount: 1 } },
    { text: 'Bones return.', set: { boomerang: true } },
  ],
}
```

**An item** goes in `data/items.ts` with `perLevel` modifiers. Each modifier changes one stat from `data/player.ts` by `flat` and/or `percent`. Final stat = (base + flat) x (1 + percent), summed over item and powerup levels.

**A generic powerup** goes in `data/powerups.ts`. It has the same shape as an item, plus `maxLevel` (20), and takes no slot.

**A modification** goes in `data/modifications.ts`: `tags` (the weapons it changes) and five `levels`, each with card text and `add` (summed over levels) or `set` (replaces the total) changes to pierce, damage, split, splitDepth, chain, area, echo, echoArea, echoRepeats, duration or reiterate. Split fan, chain range and echo radius and gap are constants at the top of that file.

**An enemy** goes in `data/enemies.ts`, then gets a weight in a `data/waves.ts` row. New art needs a grid in `art/spriteData.ts` and an animation line in `art/textures.ts`.

**Waves** are rows keyed by minute (`from` inclusive, `to` exclusive) with a target count and spawn weights. HP scales by `HP_SCALE_PER_MINUTE`; speed starts at `SPEED_SCALE_START` (70%) and reaches full speed by 4:00.

**Drops**: every enemy has a `potionChance` for a health potion that heals 30% of max HP (`data/drops.ts`). A player at full HP leaves potions on the ground. Timed events (the 5:00 and 10:00 bat swarms) are in `WAVE_EVENTS`.

## Art

All art is drawn on the 16 px grid as character grids in `src/art/spriteData.ts`: one character per pixel, mapped through `PALETTE`. Edit a grid to redraw a sprite. At boot, `textures.ts` packs every sprite into one atlas and the tiles into an extruded tileset.

The spec names 0x72's CC0 [16x16 DungeonTileset II](https://0x72.itch.io/dungeontileset-ii) for enemies and tiles. The build machine could not reach itch.io, so enemies and tiles are hand-drawn placeholders in the same palette family and frame sizes (zombie 16x18, ghoul 16x16, brute 28x30, tiles 16x16). To use the pack, load its sheet in `BootScene`, register frames named like the existing ones (`zombie_0`..`zombie_3`, `floor_a`, `wall_top` and so on), and drop the matching grids. Nothing else references art by anything but frame name.

## Debug overlay (F3)

FPS, live enemies against the wave target, projectiles, gems, damage numbers, physics bodies, minute and seed, with Arcade debug bodies drawn over the world. Buttons spawn 50 enemies, add a level, skip a minute, toggle god mode, and make every ultimate ready.

## Decisions made while building

Where the spec left room, these are the calls taken. All are easy to change.

- **Ultimates** start ready, and their cooldown counts from the cast and ignores the Cooldown stat (so the HUD number is exact). Falling ends a running ultimate early.
- **Character weapon kits**: each character has exactly four weapons, which fills the four weapon slots; items are shared by everyone.
- **Pierce** counts enemies hit before the projectile vanishes, so the starting banana hits one enemy. A boomerang projectile (none at the moment) turns around when its outbound pierce runs out or after 0.9 s, whichever comes first, and gets a fresh pierce for the return trip.
- **Projectile modifications** resolve a hit in this order: split if the projectile still can (it is replaced by its splits, which fan out over 90 degrees and skip enemies it already hit), otherwise use up pierce, then chain to the closest unhit enemy within 140 px (a random direction if none). Orbiting coconuts never vanish, so they only get Pierce's damage bonus.
- **Bonuses add up.** Area: a weapon's own size levels, the AREA stat and area modifications are one sum (Howler Aura: 100% + 15% per level after the first + 20% per Increased AoE level - 10% per Reduced AoE level), scaling radius or reach. Damage: a weapon's own damage levels and every modification's damage bonus are one sum, then multiplied by DAMAGE (the Damage powerup, +5% per level added up), the only damage multiplier. Coconut Orbit is tagged projectile and AoE, so area modifications grow the coconuts and both kinds of damage bonus count.
- **Echo Strike** echoes have a 20 px radius before area bonuses. Echoes on one enemy in the same frame are added into one hit, so a big aura pulse does not flood the screen with numbers.
- **Duration effects**: a new hit refreshes the stack that weapon applied; Reiterate copies keep the time left and are never refreshed. At most 30 stacks of one weapon sit on one enemy.
- **Howler Aura** "deals damage 40% faster" means 40% more pulses per second per level, added up: level 5 pulses 2.6 times as often as level 1. Every "X% faster" or "X% more often" upgrade works this way. Ability Haste then shortens that cooldown by its own formula.
- **Ability Haste** multiplies cooldowns by 100 / (100 + haste) on top of the COOLDOWN stat. Ultimates ignore both.
- **Banana range** is 340 px. With nothing in range it holds fire and shoots the moment a target appears.
- **Coconut Orbit and Howler Aura** use `cooldown` as the time between hits on the same enemy (orbit) or between pulses (aura), so Ability Haste speeds them up too.
- **Tail Whip** "area" is its reach. It hits everything in a 150 degree arc in the facing direction.
- **Maximum Health** adds the extra max HP to current HP as well, so taking it never makes the bar look emptier.
- **Spawner** tops up at most a sixth of the target per 0.5 s tick, so a cleared screen refills as a stream rather than one ring.
- **Stragglers**: an enemy more than 1.5 screen widths away horizontally, or 1.5 screen heights vertically, is moved back to the ring just outside the view, keeping its HP.
- **Fallback card** when everything is maxed is called Banana Bunch and heals 30 HP.
- **Keyboard**: Phaser 4 re-scans its key queue on every DOM key event until the frame ends, so two keys pressed within one frame re-emit the first. `onKey` in `ui/widgets.ts` ignores events a handler has already seen.

## Performance

Checked in headless Chromium on a 2-core 2.1 GHz VM with software-rendered WebGL: 300 enemies, 200 projectiles, 180 gems and 90 damage numbers on screen at once. The main thread was 83% idle while profiling; frame time there is dominated by the software GPU. Enemy push-apart runs on the spatial grid, not enemy-vs-enemy physics, and enemies, projectiles, gems and damage numbers are all pooled.
