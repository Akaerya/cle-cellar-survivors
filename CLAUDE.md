# Cle Cellar Survivors

Survivor-like browser game where you play as members of the Cle Cellar Discord server: Phaser 4, TypeScript, Vite, Arcade Physics. No backend and no asset files (art, fonts and sounds are generated at boot from `src/art`). Solo, or online co-op for up to 4 players over WebRTC (PeerJS). Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

See `README.md` for the player-facing overview, URL options and how to add content.

## Commands

```bash
npm install
npm run dev          # dev server (http://localhost:5173)
npm run typecheck    # tsc --noEmit; run before committing
npm run build        # typecheck + static build in dist/
```

There are no automated tests. Check changes in the browser: `?play` skips the title, `?seed=N` fixes the RNG, F3 opens the debug overlay (spawn 50, +1 level, +1 minute, god mode, ultimates ready, boss). The running game scene is on `window.__cleCellar`. The last character and name picked are in `localStorage` (`cle-cellar-survivors-profile`).

## Where things live

- `src/data/`: every gameplay number. Characters (kit, ultimate), ultimates, weapons, items, enemies, bosses (skills, minions, hazards, schedule), waves (HP, speed and spawn scaling, co-op HP scaling), drops (potions, gem tiers), co-op revives, player base stats and rerolls. Engine code reads these generically.
- `src/constants.ts`: engine limits (run length, caps, slot counts, invulnerability).
- `src/core/progression.ts`: level curve, weapon stats per level, stat formula.
- `src/entities/`, `src/systems/`: pooled game objects and the systems that run them (Enemies, Weapons, Ultimate, Bosses, Gems, Potions, Spawner, Fx). `Player.runStats` and each weapon's `damage`/`kills` feed the party screen (`GameOverScene`).
- `src/core/profile.ts`: display name and character (localStorage, sent to the co-op lobby).
- `src/scenes/GameScene.ts`: the run. `mode` is `solo`, `host` (simulates for everyone) or `client` (draws the host's snapshots, moves only its own character).
- `src/net/`: co-op session (`Net.ts`), message and binary snapshot format (`protocol.ts`), joiner-side renderer (`Mirror.ts`), scene transitions (`flow.ts`).
- `src/wiki/pages.ts` + `src/scenes/WikiScene.ts`: the in-game wiki.

## Keep the wiki up to date

The in-game wiki (title screen > WIKI, or the pause menu) is how players and contributors see what is in the game and give balance feedback. **Every change to content or mechanics must keep it accurate.**

- Numbers in the wiki are read from `src/data` and `src/constants.ts`, so changing an existing value needs no wiki edit. Check the page still reads correctly.
- Prose in `src/wiki/pages.ts` is hand-written. Update it whenever you:
  - add a character, ultimate, weapon, item, enemy, boss, wave event or drop (also check its table has the right columns, e.g. a new stat or field; weapon tables pick their columns per targeting type in `COLUMNS`),
  - add a boss skill kind (`skillText`) or hazard,
  - add or change a mechanic or rule (damage, pickups, level-ups, spawning, co-op, revives, controls),
  - add a new targeting type (`TARGETING_NOTES` and `COLUMNS`), ultimate kind (the `how` text in the CHARACTERS page) or player stat (`STAT_LABELS`, `STAT_NOTES`),
  - add a tracked run stat (the PARTY SCREEN text on the RULES page),
  - add a new data file or tunable: show it on the matching page and list the file in that page's `source`.
- New kinds of content get a new page in `WIKI_PAGES`. Long pages get `filters` (chips under the tabs); `blocks(filter)` narrows the page to the picked chip.
- Also update the README when the change affects players or contributors.

## Co-op rules of thumb

- The host is authoritative. Gameplay randomness uses the run's seeded `rng` on the host; joiners never simulate enemies, hits or drops.
- Anything a joiner must see goes through the snapshot (`protocol.ts` writer and `decodeSnapshot` must stay in step) or a relayed `FxEvent` (`game.relay`, `fx.relay`, `game.playSfx`). New visible effects need a relay and a `replay` case in `GameScene`.
- Use `game.livePlayers()` and per-player state; never assume a single `player` in shared systems.
- Ultimates are cast on the host (joiners send `{ t: 'ult' }`); their timers travel in `SnapPlayer.ultCd`/`ultActive`. Per-weapon state a joiner must draw goes in `Weapons.phases()` / `setPhases` (orbit angle, shield charge).
- Projectile kinds in snapshots index `ATTACK_DEFS` (weapons, then ultimate attacks); keep new projectile-firing things in that list. Enemy kinds index `ALL_ENEMIES` (wave enemies, minions, bosses), hazard kinds index `HAZARDS`.
- Bosses run only on the host (`systems/Bosses.ts`). Joiners get hazards as a snapshot layer (drawn by `Mirror`), boss HP from the snapshot's boss list, and wind-ups and beams as relayed effects. Webs slow the character each browser moves, so `Mirror.slowAt` mirrors `Bosses.slowAt`. Boss attacks go through `GameScene.hurtPlayer`.
- Rerolls: joiners send `{ t: 'reroll' }`; the host checks `Player.rerolls` and answers with new `choices`.
- Test co-op with two browser windows that are both visible (hidden tabs stop the game loop): host in one, join with `?join=CODE` in the other.

## Style

Match the surrounding code: small data-driven systems, doc comments on classes and non-obvious fields, no magic numbers outside `src/data` and `src/constants.ts`. Bitmap fonts only have uppercase letters, digits and `.,:;!?-+=/%()[]'"<>*#·×—♥`; other characters do not render.
