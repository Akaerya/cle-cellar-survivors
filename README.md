# Cle Cellar Survivors

A survivor-like for desktop browsers where you play as members of the Cle Cellar Discord server. Pick a character, run around a walled graveyard while your weapons fire on their own, and survive the waves of bats, zombies, ghouls and brutes until 15:00, when dawn breaks. Play solo or with up to 3 friends online.

## Characters

| Character | Kit | Ultimate (Q) | Passive |
| --- | --- | --- | --- |
| **rsncle**, the banana monkey | Banana Throw (start), Tail Whip, Coconuts, Howler Aura | **Banana Storm**: a spiral of bananas around you for 15 s, 150 s cooldown | **Ragebaiter**: on falling, stand right back up with 50% HP (2 s invulnerable, like a revive) and tell everyone to put a random other player (bearizm when alone) in the bin; 120 s cooldown |
| **yookers**, the storm knight | Stormblade (start; a melee sword stab that reaches further and stabs faster with every level), Thunder Breath (an AoE lightning cone on a cooldown), Thunderstrike (AoE bolts land at random around you; more bolts and more often with levels), Storm Shield (melee, duration: puts Aegis on you every 30 s, which blocks a hit; absorbs 10-25% of the rest and deals 40% of every hit back to the attacker) | **Storm Drake**: a small dragon follows you and spits lightning orbs at enemies for 25 s, 150 s cooldown | **Dragonborn**: every minute, for the rest of the run, +8% damage, +8 ability haste, +1% life steal and 1% less damage taken |
| **yuko**, arrow of novae | Hailing Arrows (start), Crystalline Bloom, Infinite Helix, Original Pristinity | **The Beginning of You and I**: a pink dome with beams for 10 s, 150 s cooldown | **Death Defied**: damage that would leave you below 25% HP is not taken; you heal 40% of your max HP over 2 s instead; 120 s cooldown |
| **zorus**, the weeblord | Iaijutsu (start; projectile: a short sword wave that cuts through everything until it reaches its target), Blade Flurry (melee, AoE: the katana swings all around you), Flicker Strike (melee: teleports onto a random enemy on screen; hits and kills give Shadow Charges, each an instant extra strike), Unstable Infusion (attacks that hit can give Brutal, Siphoning or Vicissitude charges) | **Mistwalker**: 5 s as mist (no attacks, no damage taken, enemies ignore you), then +50% damage for 12 s; 150 s cooldown | **Shroud**: 20% chance to dodge a hit |
| **rabbit**, the bunny conjurer | Arcane Bolt (start; projectile: a slow magic orb, cast faster and a little harder with levels), Carrot Sword (melee: a carrot sword floats around you, dashes through the nearest enemy and flies back), Carrot Rations (your bunnies deal more damage, attack faster and run faster), Bunny Armory (every bunny carries a sword, bow or spellbook and swaps it every 8 s; levels add damage to all three) | **Giant Bunny**: a giant hardhat bunny joins your bunnies for 20 s; it gets every bunny bonus, deals 3x their damage and stomps around the enemy it reaches; 150 s cooldown | **Warren**: start with 2 hardhat bunnies and gain another every minute (up to 12); they chase enemies near you and headbutt them |
| **Licras**, humanity's nemesis (a goldfish on human legs) | Midnight Tumult (start; projectile: a submachine gun burst at the nearest enemy; each bullet sets off 50% of the Shock its target still has to take), Caressing Moonlight (melee, AoE: a katana swing all around you that sets off 75% of each enemy's Shock), Gentle But Cruel (projectile: any hit you land may fire a follow-up shot at that enemy), Vulnerability (duration, AoE: a web that slows by 60% and puts Shock on enemies four times a second; enemies dying on it hand their stacks on; one more web per level) | **Twilight Trill**: flashes the screen and sets off 200% of the Shock every enemy still has to take; 55 s cooldown | **Plunder**: every hit you land puts a stack of Shock on the enemy (3 damage every 0.5 s for 5 s; stacks pile up) |

Each character has its own four weapons (level-up cards only offer your character's), ultimate and passive; items, modifications, powerups and base stats are shared.

Level-up cards can also offer:

- **Modifications** (up to level 5, no slots) change every weapon that shares one of their tags. Projectile: Pierce, Splits, Chain, Additional Projectiles. AoE: Increased AoE, Reduced AoE, Echo Strike. Duration: Increase Duration, Less Duration, Reiterate. Melee: Multistrike, Stun, Momentum, Impact (melee hits splash, and AoE modifications then change the splash), Ruthless. DoT (damage over time): Deadly Ailments, Sadism, Virulent Chain. A weapon whose effect deals damage over time counts as DoT, and DoT counts as Duration. A modification is offered once you own a weapon, or have an ultimate or passive, it changes. Tags per weapon are on the wiki's WEAPONS page.
- **Generic powerups** (up to level 20, no slots): Damage, Maximum Health, Ability Haste, Movement Speed, Health Regen, Damage Taken (only offered while you own a melee weapon). The HUD shows your ultimate under your build: green edge when ready, gold with a bar while it runs, greyed out with the seconds left while it recharges. Your passive is under it, and a gold line lists what is running on you (Aegis, Shadow Charges, Unstable Infusion charges, Mistwalker's damage); Warren shows how many bunnies you have and when the next one comes. In co-op every teammate's ultimate is shown the same way next to their name and HP.

Each player has **5 rerolls** per run: R (or the REROLL button) replaces all three cards. When the run resumes after a pick you are invulnerable for 0.25 s. That and the 2 s after any revive (a co-op revive, Ragebaiter; `REVIVE.invulnSeconds` in `data/coop.ts`) are the only invulnerability: taking a hit gives none, so every enemy touching you can hurt you, each at most once every 0.5 s (`ENEMY_HIT_COOLDOWN` in `constants.ts`; boss hazards have their own timers too).

## Bosses

A boss arrives at 5:00, 10:00 and 15:00: each run picks three different ones at random (seeded). The one at 15:00 holds dawn back: the run is won once it is defeated. Bosses are big, ignore knockback, have an HP bar over them and at the top of the screen, and scale their HP with time and players like every enemy.

| Boss | Skills |
| --- | --- |
| **Broodmother**, a giant many-eyed spider (the fastest boss) | Spits webs on the ground near you that cut your move speed by 65% while you stand in them; they fade after 20 s |
| **Corpse Bloom**, a carnivorous flower | Grows Bloom Sprouts around itself that spit slow petals at you; puffs pollen clouds that drift after you and hurt while you are inside |
| **Leviathan**, a sea monster | Charges a water beam at you (a red line shows where); opens whirlpools around the players that hurt while you are inside |
| **Cyclops**, a one-eyed giant with a club | Slams the ground (a red circle shows the reach) for a shockwave that rolls outward; throws clubs in every direction that slow down and fly back |

Spawn pressure also grows over the run: the number of enemies kept on the field is multiplied by +4% per minute and +15% per extra player (`data/waves.ts`).

## Rare enemies

Any enemy the spawner brings in (waves and bat swarms, not bosses or minions) can come out **rare** with extra modifiers, all different, picked at random: 6 modifiers 0.4% of the time, 4 modifiers 0.8%, 2 modifiers 1.5%. Each modifier adds 70% of the enemy's base HP. Rare enemies get a 1 px border in the colour of their tier (gold, purple, blue), and some modifiers have a look of their own (rings, motes, spikes, wisps, a bubble), so an enemy with several shows them all. Modifier names stay in the code: players learn them by their look and in the wiki's RARE page.

The 16 modifiers (`data/enemyModifiers.ts`, run by `systems/EnemyModifiers.ts`) leave void fields that slow and chain you, keep nearby monsters from dropping below 1 HP, enrage as they lose HP, resist damage, leave caustic ground on death, grow crystal buds under whoever hits them, empower nearby monsters, hit harder the more HP you are missing, have extra HP, ignore debuffs, reflect damage, teleport to you, gather souls from nearby deaths, bring nearby monsters back from death once, block half of all hits, or halve hits from outside a bubble that breaks for 5 s after 10 of them (damage over time still gets through). Thorns never takes you below 10% of your max HP.

After every run the **party screen** lists each player's damage, DPS, kills, damage taken, healing (life steal and passives included), Aegis blocks, deaths, revives and ultimates cast, and for the selected player every weapon (and the ultimate, Warren's headbutts and Plunder's Shock; Bunny Armory counts its gear) with its level, damage, DPS, kills and share of their damage.

Phaser 4.2.1, TypeScript, Vite, Arcade Physics. No backend. Sprites and tiles are Aseprite files in `src/art/sprites` (exported to PNG); fonts and sounds are generated at boot.

## Run it

```bash
npm install
npm run dev            # dev server with hot reload
npm run build          # static site in dist/
npm run build:single   # one self-contained dist/index.html
npm run typecheck
npm run sprites        # re-export src/art/sprites/*.aseprite after editing art (needs Aseprite)
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
- **Host-authoritative**: the host's browser simulates enemies, weapons, damage and gems and sends each joiner a binary snapshot 20 times a second (only what is near their screen), plus effects and sounds. Joiners move their own character locally and report its position and speed (for Momentum), so movement has no input lag; when Flicker Strike teleports a joiner the host tells it to move and ignores positions sent before that. Pressing Q asks the host to cast; ultimate timers, buffs, charges and passive cooldowns come back in the snapshots.
- **Shared EXP**: one EXP bar and level for the team. Each level gives every player their own card pick; the run is held until everyone has chosen. A gem goes to whichever player's pickup radius it enters, using that player's EXP Gain.
- **Enemy HP** is multiplied by `1 + 0.75 x (players - 1)` (`HP_SCALE_PER_EXTRA_PLAYER` in `data/waves.ts`). Enemies chase the nearest living player and spawn around a random one.
- A fallen player spectates a teammate. Standing on the body for 5 seconds revives them at 80% HP; the team's deaths are counted for the run and each later death revives with less (80, 75, 65, 50, 30%, floor 10%; `data/coop.ts`). Fallen players keep their level-up picks for when they are back. The run ends when all are down. Players who disconnect are removed; if the host leaves, the run ends for everyone.
- The co-op menu (Esc) does not pause the run, and the game does not auto-pause on blur. Browsers stop animating hidden tabs, so the host should keep the game tab visible.
- After a run the host can play again with the same group or go back to the lobby so others can join.

Code lives in `src/net/` (session, lobby profiles, message and snapshot format, the joiner-side renderer) and `scenes/LobbyScene.ts`.

## Wiki

Title screen > **WIKI** (also in the pause menu) lists every character, ultimate, weapon, modification, item, powerup, monster, rare enemy modifier, boss, wave, drop and co-op rule with its numbers, read straight from `src/data`. Long pages have filter chips under the tabs (click, 1-9, or Q/E): by character on CHARACTERS and WEAPONS, by tag on MODS, by entry on POWERUPS and BOSSES. The prose lives in `src/wiki/pages.ts`; keep it current when adding content or mechanics (see `CLAUDE.md`).

## Controls

WASD or arrow keys to move. Weapons fire on their own. Q casts your ultimate. Esc or P pauses (the game also pauses when the window loses focus). M mutes. F3 opens the debug overlay. Level-up cards: 1, 2, 3, arrows and Enter, or click; R rerolls.

## Layout

```
src/
  main.ts              game config: 640x360, pixelArt, FIT scaling, Arcade at a fixed 60 Hz
  constants.ts         engine constants (arena size, caps, depths, colours, scene keys)
  data/                everything a designer tunes
    characters.ts ultimates.ts passives.ts weapons.ts modifications.ts items.ts powerups.ts enemies.ts enemyModifiers.ts bosses.ts waves.ts drops.ts coop.ts player.ts types.ts
  wiki/pages.ts        in-game wiki pages, built from data/
  core/
    progression.ts     level curve, weapon stats per level, player stat calculation
    rng.ts             seeded RNG (one per run)
    spatialGrid.ts     64 px grid for enemy push-apart and area hit queries
    sfx.ts             placeholder sound effects synthesised with WebAudio
    events.ts          event names between scenes, run summary and per-player stats
    profile.ts         display name and character, kept in localStorage
  art/
    sprites/           Aseprite sources (*.aseprite), their PNG exports and sprites.json
    font.ts            hand-drawn pixel fonts
    textures.ts        loads the sheets; builds the texture atlas, tileset, bitmap fonts and animations
scripts/
  export-sprites.mjs   npm run sprites: Aseprite -> PNG strips + sprites.json
  entities/            Player, Enemy, Projectile, Gem, Potion (pooled)
  systems/             Arena, Enemies, EnemyModifiers (rare enemies), RareVisuals, Weapons, Ultimate, Passive, Pets, Bosses, Gems, Potions, Spawner, Fx
  scenes/              Boot, Title, CharacterSelect, Lobby, Game, UI (HUD), LevelUp, Pause, GameOver (party screen), Wiki
  ui/widgets.ts        bitmap text, panels, buttons, keyboard menus
```

## Adding content

Every character, ultimate, weapon, item, enemy and wave is a data entry. Engine code reads them generically.

**A character** goes in `data/characters.ts`: a name, art (`anim` prefix with `-idle`, `-walk` and `-hurt` animations: a sheet with `<anim>_idle`, `<anim>_walk` and `<anim>_hurt` tags, listed in `ANIMS` in `art/textures.ts`), a starting weapon, its weapon kit (the ids level-up cards may offer), an ultimate id and a passive id.

**A passive** goes in `data/passives.ts`, run by `systems/Passive.ts`. `kind: 'dodge'` dodges hits by `chance`; `'rebirth'` stands the character back up at 0 HP; `'growth'` adds a stack of stat changes (`perStack`, like an item's `perLevel`) every `every` seconds; `'reprieve'` refuses damage that would leave the character below `below` of max HP and heals instead; `'pets'` gives the character `start` pets and another every `every` seconds up to `max`, run by `systems/Pets.ts` (move `speed`, `aggro` and `leash` ranges, the pet's `anim` and its `attack`); `'ailment'` puts a stack of `attack.effect` on every enemy the character hits (Plunder), and `attack.tags` decide which modifications change those stacks. A new kind needs a case in `Passive.ts` and in the wiki's `passiveText`.

**An ultimate** goes in `data/ultimates.ts`. `kind: 'storm'` fires `count` projectiles from the caster every `interval` in a spiral turning `spin` degrees per second; `kind: 'pet'` summons a pet that follows the caster and fires at the closest enemy within `attack.stats.range`; `kind: 'dome'` raises a dome that fires beams; `kind: 'mist'` turns the caster to mist (no attacks, no damage taken, not targeted) and then adds `amp` to DAMAGE for `after` seconds; `kind: 'giant'` adds a giant pet to the caster's pets (`scale` times as large, `power` times their damage, `speedMult` times as fast), whose `attack` is a stomp around the enemy it reaches; `kind: 'detonate'` is instant: the screen flashes `color` and every enemy's stacks of the effect named in `attack.detonate` are set off. `duration` and `cooldown` are in seconds. `attack` is a weapon definition for the projectile, so it shares the projectile pool, the co-op sync and the damage counting; its `tags` decide which modifications change the ultimate. The HUD greys out the `icon`, using an `_grey` copy that `textures.ts` builds for every `icon_ult_*` sprite.

**A weapon** goes in `data/weapons.ts` (and in a character's `weapons` list). `tags` (`projectile`, `aoe`, `duration`, `melee`, `dot`) decide which modifications change it; a weapon whose `effect` deals damage counts as `dot` and `duration` anyway. `stats.repeat` repeats each attack that many times, `repeatDelay` seconds apart. `effect` (damage, interval, duration) makes every hit leave a damage-over-time stack on the enemy; `effect.id` names an ailment shared by several sources (Shock), which `detonate: { effect, share }` sets off on every hit of a weapon. `buff` marks an effect it puts on its owner instead (Aegis), which Reiterate can copy. Behaviour comes from `targeting`:

- `nearest`: projectiles aimed at the closest enemy within `range`; holds fire when nothing is in range.
- `facing`: projectiles in the facing direction, or a melee sweep of `arc` degrees and `size` reach when `speed` is 0.
- `random`: projectiles in a random direction.
- `orbit`: `projectileCount` objects circle the owner at `range`, hitting each enemy at most once per `cooldown`.
- `aura`: everything within `size` takes damage every `cooldown`.
- `stab`: a blade `size` px long and `arc` px wide thrust at the closest enemy.
- `breath`: a cone of `arc` degrees and `size` reach sprayed at the closest enemy every `cooldown`.
- `strike`: `projectileCount` bolts every `cooldown`, each on a random enemy within `range` (or a random spot), hitting everything within `size`.
- `shield`: puts Aegis on the owner, which blocks one hit, then recharges for `cooldown` (only while no Aegis is left); `reduction` is the fraction of other hits it absorbs and `reflect` the share of every hit dealt back to the attacker.
- `bomb`: thrown at the closest enemy within `range`. The projectile flies at `speed`, touches nothing else and explodes on reaching that enemy (or where it died, or after `lifetime` seconds), hitting everything within `size`. `burst` throws extra projectiles one at a time over that fraction of the cooldown, each after the first at a random enemy on screen.
- `wave`: a projectile at the closest enemy within `range` that flies `range` px and passes through everything (no pierce used) until it touches that enemy; extra projectiles go at random enemies in range.
- `spin`: once an enemy is within `size`, swings all around the owner, hitting everything within `size`.
- `field`: `projectileCount` fields of `size` px under enemies within `range`, lasting `lifetime`; they slow by `slow` and apply the weapon's `effect` every `fieldInterval` seconds. `fieldStyle: 'web'` draws a spider web, and `transferOnDeath` hands the stacks of enemies dying on the field to the closest enemy on the owner's screen.
- `followup`: no cooldown; every hit the owner lands with another weapon has `stats.procChance` to fire it at that enemy.
- `flicker`: teleports the owner next to a random enemy on screen and hits it. `shadow` (check interval, cap) and `stats.chargeChance` give Shadow Charges, each spent on an extra strike. `strikeTime` is how long one strike takes; strikes that come up meanwhile queue by priority (cooldown, Multistrike repeat, Shadow Charge).
- `infusion`: no attack; `charges` and `stats.chargeChance` / `chargeEffect` give the owner Unstable Infusion charges.
- `seeker`: a blade floats `hover` px from the owner; every `cooldown` it dashes at `speed` to the closest enemy within `range`, cutting everything within `size` of it on the way there and back (each enemy once per dash).
- `petbuff`: no attack; `stats.petDamage`, `petHaste` and `petSpeed` make the owner's pets stronger.
- `armory`: no attack; each of the owner's pets carries one of its `gear` weapons (a `stab` or a `nearest` weapon, drawn with its `petAnim`), swapped every `cooldown` seconds. The armory's level is every gear weapon's level.

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

**A generic powerup** goes in `data/powerups.ts`. It has the same shape as an item, plus `maxLevel` (20), and takes no slot. `requiresTag` (items too) only offers it while the player owns a weapon with that tag.

**A modification** goes in `data/modifications.ts`: `tags` (the weapons it changes) and five `levels`, each with card text and `add` (summed over levels) or `set` (replaces the total) changes to the `ModEffect` fields in `data/types.ts` (pierce, damage, split, splitLess, splitAgain, chain, chainLess, chainSpeed, area, echo, duration, reiterate, multistrike, repeatChance, stunChance, stunBonus, momentum, impact, ruthless, projectileLess, hitLess, dotDamage, dotLess, dotRate, dotDuration, virulent, ...). Split fan, chain range and speed, echo radius and gap, Multistrike's gap, the stun length, Impact's radius and Ruthless' count are constants at the top of that file.

**An enemy** goes in `data/enemies.ts`, then gets a weight in a `data/waves.ts` row. New art needs a sheet in `art/sprites` (see Art) and an animation line in `ANIMS` in `art/textures.ts`. `scale` draws it larger (its `radius` stays in world px) and `mass` makes it shove lighter enemies aside.

**A boss** goes in `data/bosses.ts`: an enemy definition with a `boss` block (title, description, HP bar colour and `skills`). Skills are data: `webs`, `summon` (minions from `MINIONS`; a minion with `shooter` fires hazards), `pollen`, `beam`, `whirlpools`, `slam` and `clubs`, each with its own cooldown and numbers. What they leave in the world (webs, pollen, whirlpools, petals, clubs) is in `BOSS_HAZARDS`: size, art, spin, fade and slow. `BOSS_TIMES` is the schedule. The boss logic is `systems/Bosses.ts`; a new skill kind needs a case there and a line in the wiki's `skillText`.

**A rare enemy modifier** goes in `ENEMY_MODIFIERS` in `data/enemyModifiers.ts`: a new `id` in the `EnemyModifierDef` union in `data/types.ts` with its numbers, an internal `name` (never shown to players) and the `color` of its look. What it does goes in `systems/EnemyModifiers.ts` (the hooks are `update`, `incoming`, `afterHit`, `outgoing`/`damageMult`, `onDeath` and `revive`), a look in `systems/RareVisuals.ts` if it should have one, and a line in the wiki's `rareText` and `rareLook`. `RARE_TIERS` sets how often an enemy rolls 2, 4 or 6 modifiers and the border colours, `RARE_HP_PER_MODIFIER` the HP per modifier. What modifiers leave in the world (void fields, caustic ground, crystal buds) is in `RARE_HAZARDS`, added to `HAZARDS` so joiners draw it like boss hazards. Snapshots send the modifier list as a bit mask, so there is room for 32.

**Waves** are rows keyed by minute (`from` inclusive, `to` exclusive) with a target count and spawn weights. HP scales by `HP_SCALE_PER_MINUTE`; speed starts at `SPEED_SCALE_START` (70%) and reaches full speed by 4:00. The target is multiplied by `spawnScaleFor` (`SPAWN_SCALE_PER_MINUTE`, `SPAWN_SCALE_PER_EXTRA_PLAYER`).

**Drops**: every enemy has a `potionChance` for a health potion that heals 30% of max HP (`data/drops.ts`). A player at full HP leaves potions on the ground. Timed events (the 5:00 and 10:00 bat swarms) are in `WAVE_EVENTS`.

## Art

Every sprite and tile is an [Aseprite](https://www.aseprite.org) file in `src/art/sprites/`. Open one, draw, save, then run `npm run sprites` (set `ASEPRITE` to the Aseprite executable if it is not on your PATH). The script exports each file to a PNG strip next to it and rewrites `sprites.json`; commit all three. The game loads the PNGs at boot, so building and deploying never needs Aseprite.

Frames are named from the file and its tags:

- Frames inside a tag are `<tag>_0`, `<tag>_1`, ... (just `<tag>` when the tag has one frame). `monkey.aseprite` has tags `monkey_idle`, `monkey_walk` and `monkey_hurt`; `icons.aseprite` has one single-frame tag per icon.
- Untagged frames are `<file>_0`, `<file>_1`, ... (just `<file>` for a one-frame file): `bat.aseprite` gives `bat_0`..`bat_3`, `potion.aseprite` gives `potion`.
- Every frame of a file is the same size. Frame durations set in Aseprite are the animation timings.

At boot, `textures.ts` packs every frame into one atlas (and an `_grey` copy of each `icon_ult_*`), builds the extruded tileset from `tiles.aseprite` (one tag per tile, looked up by name) and creates the animations in `ANIMS`. A new animation is a line there: its key and the frame prefix. Nothing else references art by anything but frame name.

Style: a single dark outline (`#1c1322`), light from the top left, 3-4 shades per material, enemies and bosses facing right (the game flips them). Characters are 16x20, wave enemies 16x16 to 28x30, bosses 40x30 to 44x34 drawn at 2x, icons 16x16.

## Debug overlay (F3)

FPS, live enemies against the wave target, projectiles, gems, damage numbers, physics bodies, minute and seed, with Arcade debug bodies drawn over the world. Buttons spawn 50 enemies, add a level, skip a minute, toggle god mode, make every ultimate ready, bring in a random boss, and spawn a rare enemy with 6 random modifiers next to you.

## Decisions made while building

Where the spec left room, these are the calls taken. All are easy to change.

- **Ultimates** start ready, and their cooldown counts from the cast and ignores the Cooldown stat (so the HUD number is exact). Falling ends a running ultimate early.
- **Character weapon kits**: each character has exactly four weapons, which fills the four weapon slots; items are shared by everyone.
- **Pierce** counts enemies hit before the projectile vanishes, so the starting banana hits one enemy. A boomerang projectile (none at the moment) turns around when its outbound pierce runs out or after 0.9 s, whichever comes first, and gets a fresh pierce for the return trip.
- **Projectile modifications** resolve a hit in this order: split if the projectile still can (it is replaced by its splits, which fan out over 90 degrees, skip enemies it already hit and deal Splits' "less damage" share less than it did), otherwise use up pierce, then chain to the closest unhit enemy within 140 px (a random direction if none), each bounce dealing Chain's "less damage" share less than the hit before. Splits level 5 gives each projectile from a first split a 20% chance to split once more. Coconuts never hit anything on the way (infinite pierce), so Splits and Chain do nothing for them and Pierce only adds damage. Additional Projectiles adds to a weapon's projectile count (Banana Throw fans the extra bananas out, Coconuts and Midnight Tumult fire theirs one after another) and makes the weapon deal 35% less damage at level 1, down to 15% less at level 5.
- **Increased AoE** follows the revised modification sheet: +20% area and +5% damage per level (it had been nerfed to +10% area before).
- **Melee modifications**: Multistrike's repeats come 0.15 s apart (or at the weapon's own repeat delay) and count as attacks for Ruthless; shields have no attack to repeat. Stunned enemies stand still and take the bonus from every hit; bosses and hexproof enemies cannot be stunned. Momentum adds its share of the current move speed to the hit's base damage, so damage bonuses scale it too. Impact splash leaves the enemy that was hit out, and splash from one weapon on one enemy in one frame is one hit.
- **Storm Shield**: Aegis only recharges while none is left; duration modifications make it come back faster (Increase Duration) or slower (Less Duration, which also raises the reflected damage); Reiterate rolls once each time Aegis is applied. The reflect also happens on blocked hits, at 40% of the hit before armor, shields or blocks.
- **Zorus**: Blade Flurry's description radius (40) is its level 1 radius; levels 2-5 add 10% each. Unstable Infusion rolls once per attack, on the attack's first hit. Flicker Strike does one strike at a time (0.1 s each): the cooldown's strike, then its Multistrike repeats, then Shadow Charge strikes, each kind waiting behind the ones before; repeats never spend a Shadow Charge. Shadow Charges cap at 6. Besides the chance per enemy reached, every enemy a strike (or its splash or echo) kills has a 14% chance to give one. Mistwalker uses the same 150 s cooldown as the other ultimates; while the only player is mist, the horde stands still.
- **rabbit**: bunnies cannot be hurt and do not block enemies; they pick the closest enemy within 170 px of you, counting enemies other bunnies already chase as 40 px further away, so a pack spreads out. Modifications do not change bunnies (their attacks have no tags); DAMAGE and critical strikes do. Falling sends the bunnies away until you are back up. Carrot Sword's cooldown counts from the start of each dash, and Multistrike repeats are extra dashes once it is back. The Giant Bunny also carries gear (Bunny Armory) and headbutts like a bunny, on top of its stomp.
- **Ragebaiter** names a random other player in the run (fallen ones included), never yourself; standing back up is not a death, and counts as a revive: 2 s of invulnerability, like a co-op revive.
- **No invulnerability between hits**: instead each enemy, and each boss hazard, has its own 0.5 s timer per player, started by any hit it lands, misses (dodge) or has blocked. Without it a single touching enemy would hit every frame. Thorns shares its enemy's timer with the touch. Revives (co-op, Ragebaiter) keep their 2 s of invulnerability.
- **Coconuts** flies at 240 px/s and homes in on the enemy it was thrown at, exploding on touching it. If that enemy dies first, the coconut explodes where it was last seen; after 4 s it explodes wherever it is. With several coconuts, they are spread evenly over half the cooldown after Ability Haste: 5 coconuts at a 1.6 s cooldown go out every 0.16 s, the last at 0.64 s.
- **Bonuses add up.** Area: a weapon's own size levels, the AREA stat and area modifications are one sum (Howler Aura: 100% + 15% per level after the first + 20% per Increased AoE level - 10% per Reduced AoE level), scaling radius or reach. Damage: a weapon's own damage levels and every modification's damage bonus are one sum, then multiplied by DAMAGE (the Damage powerup, +5% per level added up, plus Dragonborn stacks and Mistwalker), the only damage multiplier. Coconuts is tagged projectile and AoE, so area modifications grow its blast and both kinds of damage bonus count.
- **Echo Strike** echoes have a 20 px radius before area bonuses. Echoes on one enemy in the same frame are added into one hit, so a big aura pulse does not flood the screen with numbers.
- **Duration effects**: a new hit refreshes the stack that weapon applied; Reiterate copies keep the time left and are never refreshed. At most 30 stacks of one weapon sit on one enemy (Shock: 150, only so Reiterate cannot copy without end). Infinite Helix is tagged DoT and its fields apply Rime Trauma every 0.25 s.
- **Damage over time** is not a hit: it applies no Plunder stack or follow-up shot, Thorns and Crystalline ignore it, and a rare enemy's bubble does not stop it. Each stack keeps the bonuses of the weapon that put it on (Vulnerability's Shock gets Vulnerability's AoE and Duration bonuses). The ticks of one weapon's stacks on one enemy in one frame land as one number. Setting stacks off (Midnight Tumult, Caressing Moonlight, Twilight Trill) deals a share of what they would still deal, at once, and leaves them ticking.
- **Howler Aura** "deals damage 40% faster" means 40% more pulses per second per level, added up: level 5 pulses 2.6 times as often as level 1. Every "X% faster" or "X% more often" upgrade works this way. Ability Haste then shortens that cooldown by its own formula.
- **Ability Haste** multiplies cooldowns by 100 / (100 + haste) on top of the COOLDOWN stat. Ultimates ignore both.
- **Banana range** is 340 px. With nothing in range it holds fire and shoots the moment a target appears.
- **Howler Aura** uses `cooldown` as the time between pulses, so Ability Haste speeds it up too.
- **Tail Whip** "area" is its reach. It hits everything in a 150 degree arc in the facing direction.
- **Maximum Health** adds the extra max HP to current HP as well, so taking it never makes the bar look emptier.
- **Spawner** tops up at most a sixth of the target per 0.5 s tick, so a cleared screen refills as a stream rather than one ring.
- **Stragglers**: an enemy more than 1.5 screen widths away horizontally, or 1.5 screen heights vertically, is moved back to the ring just outside the view, keeping its HP.
- **Fallback card** when everything is maxed is called Banana Bunch and heals 30 HP.
- **Keyboard**: Phaser 4 re-scans its key queue on every DOM key event until the frame ends, so two keys pressed within one frame re-emit the first. `onKey` in `ui/widgets.ts` ignores events a handler has already seen.

## Performance

Checked in headless Chromium on a 2-core 2.1 GHz VM with software-rendered WebGL: 300 enemies, 200 projectiles, 180 gems and 90 damage numbers on screen at once. The main thread was 83% idle while profiling; frame time there is dominated by the software GPU. Enemy push-apart runs on the spatial grid, not enemy-vs-enemy physics, and enemies, projectiles, gems and damage numbers are all pooled.
