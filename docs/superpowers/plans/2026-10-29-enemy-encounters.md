# Level 1–10 Enemy Encounters Implementation Plan

> **For agentic workers:** Use the existing shared contracts and keep the client, server and art tasks independent.

**Goal:** Add five visible, playable hostile characters with fixed, solo-balanced statistics for player levels 1–10.

**Architecture:** A shared enemy catalog supplies server combat statistics and client information. World encounters reference catalog IDs; battle snapshots retain the ID to select the same sprite in combat. Preserve the existing scalable wolf pack.

**Tech Stack:** TypeScript, Phaser, existing authoritative battle engine, Vitest, built-in image_gen.

**Scope:** The user's request authorizes five new enemies and approximate balance. Use current melee AI and existing game art conventions; no new combat abilities or database migrations.

## Tasks

- [x] Add failing server tests covering reachable encounters, fixed statistics, solo victories on all ten recommended levels, XP once per victory, and faster enemy opening turns.
- [x] Add `packages/shared/src/enemies.ts`: EnemyId, EnemyDefinition, ENEMY_DEFINITIONS and getEnemyDefinition; add optional enemyId to world and battle snapshots.
- [x] Add five fixtures outside the settlement and resolve their combatants in BattleService, including opening NPC turns. Keep legacy wolf behavior.
- [x] Generate five transparent PNGs under `apps/client/public/assets/characters/enemies/`, save original prompts and crop metadata under `docs/art/`.
- [x] Add enemy asset loading, map and battle sprites and encounter information with focused client tests. Preserve interactions and fallbacks.
- [x] Verify relevant tests and workspace build; inspect generated sprites. Document balance assumptions and resulting statistics.

## Balance targets

Healthy solo character with the current base statistics, current arena and automatic combat should win in 3–12 rounds with 25–85% HP remaining on both levels of its recommended interval. Existing injuries, starting HP and player decisions still affect results.

| Enemy ID | Enemy level | Player levels | HP | Melee | Armor | AP | Initiative | XP |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| feral-rat | 1 | 1–2 | 110 | 9 | 0 | 4 | 9 | 40 |
| forest-wolf | 3 | 3–4 | 170 | 15 | 4 | 4 | 10 | 70 |
| wild-boar | 5 | 5–6 | 230 | 18 | 8 | 4 | 11 | 100 |
| forest-bandit | 7 | 7–8 | 280 | 23 | 12 | 4 | 12 | 130 |
| outlaw-guard | 10 | 9–10 | 340 | 27 | 16 | 4 | 13 | 160 |

## Review focus

- Faster NPCs must finish their opening turn before accepting player commands.
- Snapshot enemy IDs and statistics must survive cloning and command application.
- High-level players must not silently raise the fixed enemy statistics.
- Missing textures must leave selectable visible enemies.
- Same assets must load after direct battle resume as after walking from the world.

## Verification results

- Server: `npm test -w @web-mmorpg/server -- tests/enemyEncounters.test.ts tests/battleService.test.ts tests/worldService.test.ts tests/npcBattleAi.test.ts tests/autoBattleAi.test.ts` — 47 passed.
- Client: focused runs covering `enemySkinAssets.test.ts`, `encounterMenu.test.ts`, `worldEntitiesRenderer.test.ts`, `battleScene.test.ts` and `worldSceneProgression.test.ts` — 34 passed.
- `npm run build -w @web-mmorpg/shared`, `npm run build -w @web-mmorpg/server` and `npm run build -w @web-mmorpg/client` passed. Client retains the Vite bundle-size advisory.
- All five generated PNGs were visually inspected and their production copies match source SHA-256 hashes. Art prompts, original dimensions and alpha crop frames are recorded in `docs/art/enemy-skin-prompts.json`.
- Browser gameplay was not inspected. Database and hosting configuration are outside this change.
