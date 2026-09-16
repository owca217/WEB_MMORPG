# WEB MMORPG MVP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a locally playable multiplayer vertical slice with one world map and a server-authoritative hex battle foundation, structured for later MMORPG systems.

**Architecture:** A TypeScript npm workspace separates Phaser/Vite client, Node/Socket.IO server and framework-independent shared contracts. The authoritative server owns world and battle rules; the client only sends intent and renders state. Pure rules are isolated so Vitest can cover them without browser/network dependencies.

**Tech Stack:** TypeScript, Phaser 4.2.1, Vite 8.2.2, Socket.IO 4.8.3, Vitest 5.0.1, Node.js.

**Spec:** `docs/superpowers/specs/2026-09-17-web-mmorpg-mvp-design.md`

## Global Constraints

- Browser client must support desktop and mobile layouts.
- Server is authoritative for movement, combat, AP, damage and results.
- Client and server share protocol types from `packages/shared`.
- Hex coordinates use axial `q,r` representation.
- Battle arena generation must accept a deterministic seed.
- Static client must be deployable to GitHub Pages.
- Do not copy Margonem art, maps, names or other proprietary content.

---

### Task 1: Workspace and shared protocol

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/world.ts`
- Create: `packages/shared/src/battle.ts`
- Test: `packages/shared/src/battle.test.ts`

**Interfaces:**
- Produces: `HexCoord`, `hexDistance(a,b)`, `hexNeighbors(hex)`, world/battle DTOs and typed socket event maps.

- [ ] Write failing tests for axial hex distance and six neighbors.
- [ ] Run shared tests and confirm failure.
- [ ] Implement the shared coordinate helpers and protocol types.
- [ ] Run shared tests and confirm pass.
- [ ] Commit as `feat: add shared game protocol`.

### Task 2: Authoritative world server

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/world/worldState.ts`
- Create: `apps/server/src/world/worldState.test.ts`

**Interfaces:**
- Consumes: shared world DTOs.
- Produces: `WorldState.joinPlayer`, `movePlayer`, `leavePlayer`, `snapshot`.

- [ ] Write failing tests for join, bounded movement and disconnect.
- [ ] Run server tests and confirm failure.
- [ ] Implement in-memory authoritative world state.
- [ ] Add Socket.IO adapters for join/move/disconnect.
- [ ] Run tests and confirm pass.
- [ ] Commit as `feat: add authoritative world server`.

### Task 3: Browser world client

**Files:**
- Create: `apps/client/package.json`
- Create: `apps/client/tsconfig.json`
- Create: `apps/client/index.html`
- Create: `apps/client/src/main.ts`
- Create: `apps/client/src/style.css`
- Create: `apps/client/src/game/WorldScene.ts`
- Create: `apps/client/src/net/socket.ts`

**Interfaces:**
- Consumes: world snapshot/movement events.
- Produces: rendered player entities and move intents from click/WASD/touch.

- [ ] Create a minimal Phaser scene using generated placeholder graphics.
- [ ] Connect to the server and render authoritative player positions.
- [ ] Add WASD and pointer/tap movement intent.
- [ ] Verify responsive scaling for desktop/mobile.
- [ ] Build the client.
- [ ] Commit as `feat: add multiplayer world client`.

### Task 4: Pure hex battle engine

**Files:**
- Create: `apps/server/src/battle/battleEngine.ts`
- Create: `apps/server/src/battle/battleEngine.test.ts`
- Create: `apps/server/src/battle/arenaGenerator.ts`
- Create: `apps/server/src/battle/arenaGenerator.test.ts`

**Interfaces:**
- Produces: deterministic arena generation and `BattleEngine.applyCommand(command)`.
- Commands: move, meleeAttack, rangedAttack, endTurn.

- [ ] Write failing deterministic generation tests.
- [ ] Implement seeded arena generation.
- [ ] Write failing AP/turn/movement tests.
- [ ] Implement turn order and AP spending.
- [ ] Write failing range/blocking tests.
- [ ] Implement basic melee/ranged validation.
- [ ] Run all battle tests.
- [ ] Commit as `feat: add hex battle engine`.

### Task 5: Battle networking and UI

**Files:**
- Create: `apps/server/src/battle/battleSessions.ts`
- Create: `apps/client/src/game/BattleScene.ts`
- Create: `apps/client/src/game/hexLayout.ts`

**Interfaces:**
- Consumes: battle commands/snapshots.
- Produces: server-created battle sessions and clickable hex battle UI.

- [ ] Add encounter-to-battle server event.
- [ ] Render valid hex cells, combatants and obstacles.
- [ ] Highlight reachable cells for the active combatant.
- [ ] Send move/attack/end-turn intent.
- [ ] Render authoritative state after every accepted action.
- [ ] Verify two clients can observe the same battle state.
- [ ] Commit as `feat: connect tactical battle flow`.

### Task 6: Injuries, loot and return flow

**Files:**
- Create: `apps/server/src/battle/injuries.ts`
- Create: `apps/server/src/battle/injuries.test.ts`
- Modify: battle result flow.
- Modify: client HUD.

**Interfaces:**
- Produces: `applyDefeatInjuries` and battle result DTO with injuries/loot.

- [ ] Write failing tests for severe injury and one specific injury at 0 HP.
- [ ] Implement minimal injury table and deterministic selection.
- [ ] Add simple loot result.
- [ ] Return players to the world after result acknowledgement.
- [ ] Run all tests.
- [ ] Commit as `feat: add battle consequences`.

### Task 7: Character/session persistence boundary

**Files:**
- Create: `apps/server/src/accounts/accountRepository.ts`
- Create: `apps/server/src/accounts/memoryAccountRepository.ts`
- Create: `apps/server/src/accounts/sessionService.ts`
- Create: corresponding tests.
- Modify: client startup/login UI.

**Interfaces:**
- Produces: repository abstraction that can be replaced by PostgreSQL without changing client protocol.

- [ ] Test account/session/character creation behavior.
- [ ] Implement development in-memory repository.
- [ ] Add character create/select flow.
- [ ] Keep passwords/production auth explicitly out of the development repository.
- [ ] Commit as `feat: add character session flow`.

### Task 8: Build, Pages workflow and developer instructions

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md`
- Modify: root scripts/config.

**Interfaces:**
- Produces: repeatable `npm test`, `npm run build`, `npm run dev` workflows and static Pages artifact.

- [ ] Configure client base path for repository Pages hosting.
- [ ] Add build workflow.
- [ ] Document local server/client startup and `VITE_SERVER_URL`.
- [ ] Run full tests and builds.
- [ ] Commit as `chore: add build and pages deployment`.
