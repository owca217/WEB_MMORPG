# WEB MMORPG MVP 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current technical prototype into one polished vertical slice: forest settlement -> NPC interaction -> wolf encounter -> tactical hex combat -> loot/injuries -> return to the shared world.

**Architecture:** Keep the existing TypeScript monorepo and authoritative Node/Socket.IO server. Add a small persistent-in-session character state, authored settlement world data, NPC interaction messages, server-run wolf turns, richer battle snapshots, and focused client UI/rendering helpers. Phaser remains responsible for world/battle rendering; DOM overlays remain responsible for HUDs and panels.

**Tech Stack:** TypeScript 5.9, Phaser 4.2.1, Socket.IO 4.8.3, Vite 8.2.2, Vitest 5.0.1, Node.js 22+ in CI.

**Spec:** `docs/superpowers/specs/2026-09-17-web-mmorpg-mvp2-design.md`

## Global Constraints

- The game remains classless; do not introduce fixed character classes.
- Browser client stays on GitHub Pages and server stays on Render.
- Server remains authoritative for position, encounter eligibility, AP, turn order, path validation, line of sight, damage, injuries, NPC turns, loot, inventory, and battle outcome.
- Client may preview movement/attacks but may not authoritatively set damage, HP, AP, loot, or final positions.
- Desktop must support WASD/arrow movement plus click-to-move.
- Mobile must support both tap-to-move and a compact virtual joystick.
- Touch targets must remain approximately 44 CSS px minimum.
- MVP 2 uses original/simple assets or coherent placeholders; no copied Margonem/commercial-game assets.
- Existing in-memory session persistence remains acceptable; database accounts are out of scope.
- Cover may be represented visually, but do not invent new numeric cover bonuses until those values are explicitly designed.
- Continue work on `feature/mvp-vertical-slice`; do not merge to `main` without explicit approval.

---

## File Structure Map

The implementation should converge on these responsibilities:

- `packages/shared/src/character.ts` — session character snapshot contract.
- `packages/shared/src/world.ts` — world/NPC/encounter snapshot contracts.
- `packages/shared/src/inventory.ts` — inventory item category/purpose contract.
- `packages/shared/src/protocol.ts` — typed Socket.IO events for player state and NPC interaction.
- `apps/server/src/character/CharacterService.ts` — in-memory character HP/level/initiative/injury state.
- `apps/server/src/world/worldFixtures.ts` — authored forest-settlement fixture, NPCs, encounter positions.
- `apps/server/src/world/WorldService.ts` — authoritative world position/range checks and NPC interaction validation.
- `apps/server/src/battle/NpcBattleAi.ts` — deterministic server-owned wolf command selection.
- `apps/server/src/battle/BattleService.ts` — player command application plus automatic NPC-turn draining.
- `apps/server/src/server/createGameServer.ts` — orchestration only: socket handlers, service wiring, state broadcasts.
- `apps/client/src/state/PlayerStateStore.ts` — latest `PlayerStateSnapshot` cache for HUD/panels.
- `apps/client/src/world/ForestSettlementRenderer.ts` — authored visual map layers and decorative props.
- `apps/client/src/world/WorldEntitiesRenderer.ts` — player/NPC/wolf visual entities.
- `apps/client/src/input/VirtualJoystick.ts` — touch joystick state and DOM lifecycle.
- `apps/client/src/ui/WorldHud.ts` — HP/AP/status bar and panel buttons.
- `apps/client/src/ui/InventoryPanel.ts` — inventory modal/panel.
- `apps/client/src/ui/CharacterPanel.ts` — character/injury panel.
- `apps/client/src/ui/DialoguePanel.ts` — guard/healer interaction UI.
- `apps/client/src/battle/BattlePreview.ts` — pure reachable-cell/action preview helpers.
- `apps/client/src/ui/BattleHud.ts` — action mode, AP/HP, turn order, round, errors.
- `apps/client/src/scenes/WorldScene.ts` — scene coordination, not all rendering/UI implementation.
- `apps/client/src/scenes/BattleScene.ts` — scene coordination, battle rendering, server command dispatch.

This remains one plan rather than multiple sub-project plans because every task directly contributes to one end-to-end vertical slice and shares the same protocol/state path.

---

### Task 1: Restore a Green Battle Baseline with Automatic Wolf Turns

**Files:**
- Create: `apps/server/src/battle/NpcBattleAi.ts`
- Modify: `apps/server/src/battle/BattleService.ts`
- Modify: `apps/server/tests/battleService.test.ts`
- Test: `apps/server/tests/battleEngine.test.ts`
- Test: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- Consumes: `BattleState`, `BattleCommand`, `applyNpcBattleCommand`, `findPath`, `hexDistance`, `hexKey`.
- Produces: `chooseWolfCommand(state: BattleState, wolfId: string): BattleCommand` and a `BattleService` that automatically processes server-owned enemy turns before returning its snapshot.

- [ ] **Step 1: Strengthen the existing failing test**

Keep the existing “returns control to the player” assertion and add one case where the wolf starts adjacent and must attack rather than only move:

```ts
it("attacks when the wolf is adjacent and then returns control", () => {
  const service = new BattleService();
  const playerId = "player-1";
  const initial = service.startBattle(playerId, "Hero", "encounter:wolf");
  const hero = initial.combatants.find((c) => c.ownerPlayerId === playerId)!;

  const result = service.applyCommand(playerId, {
    type: "endTurn",
    combatantId: hero.id
  });

  expect(result.result.ok).toBe(true);
  expect(result.snapshot?.activeCombatantId).toBe(hero.id);
});
```

The existing movement assertion remains useful because the generated arena starts units apart.

- [ ] **Step 2: Run the focused test and confirm the current failure**

Run:

```bash
npm run test -w @web-mmorpg/server -- battleService.test.ts
```

Expected before implementation: FAIL because `activeCombatantId` remains the wolf after the hero ends the turn.

- [ ] **Step 3: Implement deterministic wolf command selection**

Create `NpcBattleAi.ts` around this behavior:

```ts
export function chooseWolfCommand(state: BattleState, wolfId: string): BattleCommand {
  const wolf = state.combatants[wolfId];
  if (!wolf) throw new Error("NPC_COMBATANT_NOT_FOUND");

  const target = Object.values(state.combatants)
    .filter((c) => c.side === "player" && c.hp > 0)
    .sort((a, b) => hexDistance(wolf.position, a.position) - hexDistance(wolf.position, b.position))[0];

  if (!target) return { type: "endTurn", combatantId: wolf.id };
  if (hexDistance(wolf.position, target.position) === 1 && wolf.ap >= 2) {
    return { type: "meleeAttack", combatantId: wolf.id, targetId: target.id };
  }

  const allowed = new Set(state.arena.cells.map(hexKey));
  const blocked = new Set(state.arena.blockedCells.map(hexKey));
  for (const combatant of Object.values(state.combatants)) {
    if (combatant.id !== wolf.id && combatant.hp > 0) blocked.add(hexKey(combatant.position));
  }

  for (const neighbor of hexNeighbors(target.position)) blocked.delete(hexKey(neighbor));
  const candidateGoals = hexNeighbors(target.position)
    .filter((cell) => allowed.has(hexKey(cell)) && !blocked.has(hexKey(cell)))
    .sort((a, b) => hexDistance(wolf.position, a) - hexDistance(wolf.position, b));

  for (const goal of candidateGoals) {
    const path = findPath(wolf.position, goal, blocked, allowed);
    if (path?.length) {
      return { type: "move", combatantId: wolf.id, target: path[0]! };
    }
  }

  return { type: "endTurn", combatantId: wolf.id };
}
```

Import `hexNeighbors` from `hex.ts`. Moving one hex at a time keeps AP accounting inside `BattleEngine` and avoids duplicating injury movement-cost rules in the AI.

- [ ] **Step 4: Drain NPC turns inside `BattleService`**

After a successful player command, repeatedly execute server-owned enemy commands until a player-owned combatant becomes active or the battle finishes:

```ts
private runNpcTurns(state: BattleState): BattleState {
  let next = state;
  for (let guard = 0; guard < 32 && !next.finished; guard += 1) {
    const active = next.combatants[next.activeCombatantId];
    if (!active || active.ownerPlayerId !== undefined || active.side !== "enemy") break;

    const command = chooseWolfCommand(next, active.id);
    const result = applyNpcBattleCommand(next, command);
    if (!result.ok) throw new Error(`NPC_COMMAND_REJECTED:${result.code}`);
    next = result.state;
  }
  return next;
}
```

Call it only after a successful player command. The guard prevents a malformed AI loop from hanging the server.

- [ ] **Step 5: Run focused and regression tests**

Run:

```bash
npm run test -w @web-mmorpg/server -- battleService.test.ts battleEngine.test.ts socketFlow.test.ts
npm run build -w @web-mmorpg/server
```

Expected: PASS. The existing cheating test must still return `NOT_OWNER` when a player tries to issue a command for the wolf.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/battle/NpcBattleAi.ts apps/server/src/battle/BattleService.ts apps/server/tests/battleService.test.ts
git commit -m "feat: run wolf npc turns automatically"
```

---

### Task 2: Add Session Character State and Rich Player-State Contracts

**Files:**
- Create: `packages/shared/src/character.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/inventory.ts`
- Modify: `packages/shared/src/protocol.ts`
- Create: `apps/server/src/character/CharacterService.ts`
- Create: `apps/server/tests/characterService.test.ts`
- Modify: `apps/server/src/inventory/InventoryService.ts`
- Modify: `apps/server/src/loot/LootService.ts`

**Interfaces:**
- Produces `CharacterSnapshot`, `PlayerStateSnapshot`, item categories, and `CharacterService`.
- Later tasks consume `CharacterService.createPlayer`, `getSnapshot`, `applyBattleResult`, and `healHp`.

- [ ] **Step 1: Write failing character-state tests**

Create `characterService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CharacterService } from "../src/character/CharacterService";

describe("CharacterService", () => {
  it("creates an MVP 2 character with stable base stats", () => {
    const characters = new CharacterService();
    expect(characters.createPlayer("p1", "Owczy")).toMatchObject({
      playerId: "p1",
      nickname: "Owczy",
      level: 1,
      hp: 100,
      maxHp: 100,
      maxAp: 5,
      initiative: 10,
      severelyInjured: false,
      injuries: []
    });
  });

  it("persists battle HP and injuries, while healer restores only HP", () => {
    const characters = new CharacterService();
    characters.createPlayer("p1", "Owczy");
    characters.applyBattleResult("p1", {
      hp: 0,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });

    characters.healHp("p1");
    expect(characters.getSnapshot("p1")).toMatchObject({
      hp: 100,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test -w @web-mmorpg/server -- characterService.test.ts
```

Expected: FAIL because `CharacterService` does not exist.

- [ ] **Step 3: Add shared contracts**

Create `packages/shared/src/character.ts`:

```ts
import type { InjuryKind, PlayerId } from "./battle";
import type { InventorySnapshot } from "./inventory";

export interface CharacterSnapshot {
  playerId: PlayerId;
  nickname: string;
  level: number;
  hp: number;
  maxHp: number;
  maxAp: number;
  initiative: number;
  severelyInjured: boolean;
  injuries: InjuryKind[];
}

export interface PlayerStateSnapshot {
  character: CharacterSnapshot;
  inventory: InventorySnapshot;
}
```

If the `PlayerId` import must come from `./ids`, use that exact source instead; keep type names unchanged.

Extend `InventoryItem` with:

```ts
export type ItemCategory = "material" | "medical";

export interface InventoryItem {
  instanceId: ItemInstanceId;
  itemId: string;
  name: string;
  quantity: number;
  category: ItemCategory;
  description: string;
}
```

Export `./character` from `packages/shared/src/index.ts`.

- [ ] **Step 4: Implement `CharacterService`**

Use an in-memory `Map<PlayerId, CharacterSnapshot>`. `createPlayer` returns the existing entry if called twice, `getSnapshot` returns a copy, `applyBattleResult` updates only HP/severe/injuries, and `healHp` restores HP to max without clearing injuries.

Core signatures:

```ts
createPlayer(playerId: PlayerId, nickname: string): CharacterSnapshot
getSnapshot(playerId: PlayerId): CharacterSnapshot | undefined
applyBattleResult(playerId: PlayerId, result: Pick<CharacterSnapshot, "hp" | "severelyInjured" | "injuries">): CharacterSnapshot
healHp(playerId: PlayerId): CharacterSnapshot
removePlayer(playerId: PlayerId): void
```

- [ ] **Step 5: Enrich deterministic loot metadata**

Change `LootItemDefinition` to include `category` and `description`. Wolf loot becomes:

```ts
{ itemId: "wolf-pelt", name: "Wolf Pelt", quantity: 1, category: "material", description: "A rough pelt taken from a forest wolf." }
{ itemId: "field-bandage", name: "Field Bandage", quantity: 2, category: "medical", description: "A simple bandage for field treatment." }
```

`InventoryService.addItems` copies these fields into new stacks and preserves them when quantities stack.

- [ ] **Step 6: Extend Socket.IO contracts**

Add client event:

```ts
requestPlayerState: () => void;
```

Add server event:

```ts
playerState: (snapshot: PlayerStateSnapshot) => void;
```

Update imports in `protocol.ts` accordingly.

- [ ] **Step 7: Run tests/build**

```bash
npm run test -w @web-mmorpg/server -- characterService.test.ts worldService.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared apps/server/src/character apps/server/src/inventory apps/server/src/loot apps/server/tests/characterService.test.ts
git commit -m "feat: add session character state"
```

---

### Task 3: Author the Forest Settlement and NPC Interaction Rules

**Files:**
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/server/src/world/worldFixtures.ts`
- Modify: `apps/server/src/world/WorldService.ts`
- Modify: `apps/server/tests/worldService.test.ts`
- Modify: `apps/server/src/session/SessionStore.ts`

**Interfaces:**
- Produces `NpcSnapshot`, `NpcInteractionPayload`, `WorldService.interactNpc`, and the location id `forest-settlement-01`.
- Later client tasks render NPCs directly from `WorldStateSnapshot.npcs`.

- [ ] **Step 1: Update tests first**

Change the expected login location from `meadow-01` to `forest-settlement-01`, and add:

```ts
it("exposes guide, healer and wolf encounter in the settlement snapshot", () => {
  const world = new WorldService();
  const snapshot = world.snapshot("forest-settlement-01");
  expect(snapshot.npcs.map((npc) => npc.kind).sort()).toEqual(["guide", "healer"]);
  expect(snapshot.encounters.some((encounter) => encounter.id === "wolf-pack-01")).toBe(true);
});

it("requires player to be inside npc interaction radius", () => {
  const world = new WorldService();
  world.addPlayer({ id: "p1", nickname: "Owczy" }, 0);
  expect(() => world.interactNpc("p1", "healer-ada")).toThrow("NPC_OUT_OF_RANGE");
});
```

- [ ] **Step 2: Run the world tests and verify RED**

```bash
npm run test -w @web-mmorpg/server -- worldService.test.ts
```

Expected: FAIL on missing `npcs`, old location id, and missing `interactNpc`.

- [ ] **Step 3: Extend world contracts**

Add to `world.ts`:

```ts
export type NpcKind = "guide" | "healer";

export interface NpcSnapshot {
  id: string;
  kind: NpcKind;
  name: string;
  x: number;
  y: number;
  interactionRadius: number;
}

export interface WorldStateSnapshot {
  locationId: LocationId;
  players: WorldPlayerSnapshot[];
  npcs: NpcSnapshot[];
  encounters: EncounterSnapshot[];
}
```

Add protocol payload:

```ts
export interface NpcInteractionPayload {
  npcId: string;
  npcName: string;
  kind: "guide" | "healer";
  title: string;
  lines: string[];
  canHeal: boolean;
}
```

Add client events `interactNpc({ npcId })` and `healAtNpc({ npcId })`; add server event `npcInteraction(payload)`.

- [ ] **Step 4: Replace `MEADOW_01` with an authored fixture**

Keep dimensions `1600x900`, but use:

```ts
export const FOREST_SETTLEMENT_01: WorldFixture = {
  id: "forest-settlement-01",
  width: 1600,
  height: 900,
  spawn: { x: 360, y: 470 },
  npcs: [
    { id: "guide-boran", kind: "guide", name: "Boran", x: 610, y: 420, interactionRadius: 95 },
    { id: "healer-ada", kind: "healer", name: "Ada", x: 720, y: 535, interactionRadius: 95 }
  ],
  encounters: [
    { id: "wolf-pack-01", x: 1320, y: 455, label: "Forest Wolves" }
  ]
};
```

Use `ENCOUNTER_ACTIVATION_RADIUS = 90` and `MAX_WORLD_SPEED = 220` unchanged.

- [ ] **Step 5: Add authoritative NPC range validation**

Implement:

```ts
interactNpc(playerId: PlayerId, npcId: string): NpcSnapshot {
  const player = this.requirePlayer(playerId);
  const npc = FOREST_SETTLEMENT_01.npcs.find((item) => item.id === npcId);
  if (!npc) throw new Error("NPC_NOT_FOUND");
  if (Math.hypot(npc.x - player.x, npc.y - player.y) > npc.interactionRadius) {
    throw new Error("NPC_OUT_OF_RANGE");
  }
  return { ...npc };
}
```

Extract a small private `requirePlayer` helper so movement/interaction/encounter code shares the lookup.

- [ ] **Step 6: Update session default location**

`SessionStore.login()` must return `forest-settlement-01`.

- [ ] **Step 7: Run tests/build**

```bash
npm run test -w @web-mmorpg/server -- worldService.test.ts socketFlow.test.ts
npm run build -w @web-mmorpg/server
```

Update `socketFlow.test.ts` fixture coordinates from the old encounter position to `1320,455` and expected location id to `forest-settlement-01`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/world.ts packages/shared/src/protocol.ts apps/server/src/world apps/server/src/session/SessionStore.ts apps/server/tests/worldService.test.ts apps/server/tests/socketFlow.test.ts
git commit -m "feat: add forest settlement and npcs"
```

---

### Task 4: Persist Battle Outcome, Resolve Defeat, and Wire Healer/Player State

**Files:**
- Modify: `apps/server/src/battle/BattleService.ts`
- Modify: `apps/server/src/character/CharacterService.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/server/tests/battleService.test.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- `BattleService.startBattle` consumes a `CharacterSnapshot` rather than duplicated hard-coded player stats.
- `AppliedBattleCommand` produces `playerOutcome` when finished.
- Server emits `battleEnded({ outcome, inventory, character })` and `playerState`.

- [ ] **Step 1: Add a failing battle persistence test**

```ts
it("returns the hero outcome when a battle finishes", () => {
  const service = new BattleService();
  const snapshot = service.startBattle({
    playerId: "p1",
    nickname: "Owczy",
    level: 1,
    hp: 100,
    maxHp: 100,
    maxAp: 5,
    initiative: 10,
    severelyInjured: false,
    injuries: []
  }, "wolf-pack-01");

  expect(snapshot.combatants.find((c) => c.ownerPlayerId === "p1")?.hp).toBe(100);
});
```

Also add an end-to-end socket test that after a completed fight/forced test resolution the emitted `playerState.character` matches the battle hero's HP/injuries.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm run test -w @web-mmorpg/server -- battleService.test.ts socketFlow.test.ts
```

Expected: FAIL because the new `startBattle` signature/outcome does not exist yet.

- [ ] **Step 3: Change the `BattleService.startBattle` boundary**

Use:

```ts
startBattle(character: CharacterSnapshot, encounterId: string): BattleSnapshot
```

Create the hero combatant from `character.hp`, `maxHp`, `maxAp`, `initiative`, `severelyInjured`, and `injuries`; keep wolf stats at 60 HP / 4 AP / 7 initiative for this slice.

Add to `AppliedBattleCommand`:

```ts
playerOutcome?: {
  hp: number;
  severelyInjured: boolean;
  injuries: InjuryKind[];
};
```

When `active.state.finished`, read the combatant with `ownerPlayerId === playerId` and return a copy of those fields.

- [ ] **Step 4: Define clean battle-end protocol**

Change the server event to:

```ts
battleEnded: (payload: {
  outcome: "victory" | "defeat";
  inventory: InventorySnapshot;
  character: CharacterSnapshot;
}) => void;
```

- [ ] **Step 5: Wire services in `createGameServer`**

Instantiate `CharacterService`. On successful login:

```ts
const character = characters.createPlayer(result.playerId, session.nickname);
socket.emit("playerState", { character, inventory: inventory.getSnapshot(result.playerId) });
```

On `requestPlayerState`, emit the same combined snapshot.

On encounter start, pass `characters.getSnapshot(playerId)!` to `BattleService.startBattle`.

On finished battle:
1. Apply `playerOutcome` to `CharacterService`.
2. Roll loot only on victory.
3. Emit `battleEnded` with character/inventory/outcome.
4. Remove battle.
5. Rejoin `location:forest-settlement-01`.
6. On defeat, move the player to spawn with a new `WorldService.resetPlayerToSpawn(playerId)` helper.
7. Broadcast world state.

- [ ] **Step 6: Implement guard/healer interaction socket handlers**

For guide:

```ts
socket.emit("npcInteraction", {
  npcId: npc.id,
  npcName: npc.name,
  kind: "guide",
  title: "Droga przez las",
  lines: ["Wilki kręcą się przy wschodniej ścieżce.", "Trzymaj się drogi i nie lekceważ ran."],
  canHeal: false
});
```

For healer:

```ts
socket.emit("npcInteraction", {
  npcId: npc.id,
  npcName: npc.name,
  kind: "healer",
  title: "Lecznica Ady",
  lines: ["Mogę opatrzyć cię i przywrócić siły.", "Ciężkie urazy pozostaną do czasu pełnego systemu leczenia."],
  canHeal: true
});
```

`healAtNpc` must call `world.interactNpc` again for range validation, require `kind === "healer"`, call `characters.healHp`, and emit a fresh `playerState`.

- [ ] **Step 7: Run all server tests and build**

```bash
npm run test -w @web-mmorpg/server
npm run build -w @web-mmorpg/server
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/protocol.ts apps/server/src/battle/BattleService.ts apps/server/src/character/CharacterService.ts apps/server/src/server/createGameServer.ts apps/server/tests
git commit -m "feat: persist battle outcome and healer state"
```

---

### Task 5: Complete the End-to-End Socket Vertical Slice

**Files:**
- Modify: `apps/server/tests/socketFlow.test.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `apps/server/src/world/WorldService.ts`

**Interfaces:**
- Validates the contract used by all client tasks: login -> playerState/worldState -> NPC -> battle -> NPC turns -> battleEnded -> playerState/worldState.

- [ ] **Step 1: Expand `socketFlow.test.ts` into a full-flow test**

Add a second test that:
1. Logs in as `Owczy`.
2. Receives initial `playerState` and `worldState`.
3. Server-moves the test player near the wolf using the service test hook.
4. Starts the wolf encounter.
5. Repeatedly issues legal player commands until the battle finishes. To keep the test deterministic and short, use ranged attacks when line of sight is available and `endTurn` otherwise.
6. Expects `battleEnded.outcome === "victory"`.
7. Expects `wolf-pelt` and `field-bandage` in inventory.
8. Expects a post-battle `worldState` containing the player again.

Use a bounded loop:

```ts
for (let turn = 0; turn < 40 && !ended; turn += 1) {
  // read current snapshot and issue one legal player action
}
expect(ended).toBe(true);
```

- [ ] **Step 2: Run and observe the first failing boundary**

```bash
npm run test -w @web-mmorpg/server -- socketFlow.test.ts
```

Fix only the failing boundary revealed by the test; do not add client code in this task.

- [ ] **Step 3: Add a two-client visibility regression**

Start two Socket.IO clients, log them in as `Owczy` and `Karolina`, and assert both ids are present in the same `worldState` before either enters a personal battle. After one client enters battle, the other must remain connected and keep receiving world state without inheriting the first player's battle state.

- [ ] **Step 4: Run full server verification**

```bash
npm run test -w @web-mmorpg/server
npm run build -w @web-mmorpg/server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/tests/socketFlow.test.ts apps/server/src/server/createGameServer.ts apps/server/src/world/WorldService.ts
git commit -m "test: cover complete mvp2 socket loop"
```

---

### Task 6: Add Client Player-State Store, Socket Events, and World Panels

**Files:**
- Create: `apps/client/src/state/PlayerStateStore.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Create: `apps/client/src/ui/WorldHud.ts`
- Create: `apps/client/src/ui/InventoryPanel.ts`
- Create: `apps/client/src/ui/CharacterPanel.ts`
- Create: `apps/client/src/ui/DialoguePanel.ts`
- Create: `apps/client/tests/playerStateStore.test.ts`
- Modify: `apps/client/src/style.css`

**Interfaces:**
- `playerStateStore.get()` returns the latest `PlayerStateSnapshot | null`.
- `playerStateStore.subscribe(handler)` returns an unsubscribe function.
- `WorldHud` opens/closes inventory and character panels but does not own gameplay state.

- [ ] **Step 1: Write the pure store test**

```ts
import { describe, expect, it, vi } from "vitest";
import { PlayerStateStore } from "../src/state/PlayerStateStore";

it("publishes immutable player-state snapshots", () => {
  const store = new PlayerStateStore();
  const listener = vi.fn();
  store.subscribe(listener);
  store.set({
    character: {
      playerId: "p1", nickname: "Owczy", level: 1,
      hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
      severelyInjured: false, injuries: []
    },
    inventory: { items: [] }
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.get()?.character.nickname).toBe("Owczy");
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test -w @web-mmorpg/client -- playerStateStore.test.ts
```

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the store and socket surface**

Add `onPlayerState`, `onNpcInteraction`, `onConnect`, `onDisconnect`, `requestPlayerState`, `interactNpc`, and `healAtNpc` to `GameSocket`.

Keep one socket instance; do not create a second connection for UI events.

- [ ] **Step 4: Implement `WorldHud`**

The HUD constructor receives callbacks:

```ts
interface WorldHudHandlers {
  onInventory: () => void;
  onCharacter: () => void;
}
```

It renders nickname, `HP current/max`, `AP max`, connection status, and two >=44px buttons. It exposes:

```ts
update(state: PlayerStateSnapshot): void
setConnectionState(state: "connected" | "disconnected" | "connecting"): void
destroy(): void
```

- [ ] **Step 5: Implement inventory and character panels**

`InventoryPanel.update(snapshot)` renders each item name, quantity, category, and description.

`CharacterPanel.update(character)` renders nickname, level, HP, initiative, severe-injury label and human-readable injury names:

```ts
const INJURY_LABELS = {
  brokenArm: "Złamana ręka",
  legTrauma: "Uraz nogi",
  bleeding: "Krwawienie",
  concussion: "Wstrząśnienie",
  chestWound: "Rana klatki piersiowej",
  burn: "Oparzenie",
  poison: "Zatrucie"
} satisfies Record<InjuryKind, string>;
```

Reserve a visible section titled `Specjalizacje` with the text `Rozwój biegłości pojawi się w kolejnym etapie`; do not invent a class or skill tree.

- [ ] **Step 6: Implement `DialoguePanel`**

Render NPC name/title/lines. If `canHeal`, show a `Opatrz rany` button that calls `healAtNpc(npcId)`. After healing, keep the dialogue open and rely on `playerState` to refresh HUD.

- [ ] **Step 7: Add responsive CSS**

Use a shared dark-wood/forest panel language, fixed safe-area aware positioning, and a mobile media query. Every button uses `min-height: 44px; min-width: 44px;`.

- [ ] **Step 8: Run client tests/build**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/client/src/state apps/client/src/net/GameSocket.ts apps/client/src/ui apps/client/tests/playerStateStore.test.ts apps/client/src/style.css
git commit -m "feat: add world hud and player panels"
```

---

### Task 7: Replace the Debug Grid with a Forest Settlement Presentation

**Files:**
- Create: `apps/client/src/world/ForestSettlementRenderer.ts`
- Create: `apps/client/src/world/WorldEntitiesRenderer.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Create: `apps/client/tests/worldPresentation.test.ts`
- Modify: `apps/client/src/style.css`

**Interfaces:**
- `ForestSettlementRenderer.render(scene)` creates only decorative/background Phaser objects and returns a `destroy()` handle.
- `WorldEntitiesRenderer.sync(snapshot, localPlayerId)` owns visual player/NPC/encounter objects.
- `WorldScene` owns input, socket subscriptions, camera, and interaction dispatch.

- [ ] **Step 1: Write a pure presentation-layout test**

Extract authored non-Phaser layout constants:

```ts
export const FOREST_SETTLEMENT_LAYOUT = {
  settlement: { x: 100, y: 160, width: 820, height: 570 },
  gate: { x: 930, y: 390, width: 70, height: 150 },
  forest: { x: 980, y: 0, width: 620, height: 900 }
} as const;
```

Test that the wolf encounter coordinate `1320,455` lies in the forest region and spawn `360,470` lies in the settlement region. This keeps the authored visual layout aligned with server coordinates.

- [ ] **Step 2: Run and verify RED**

```bash
npm run test -w @web-mmorpg/client -- worldPresentation.test.ts
```

- [ ] **Step 3: Build the authored background renderer**

Use Phaser graphics/shapes rather than external copyrighted assets. The renderer should create:
- layered grass/earth background,
- a settlement clearing,
- two simple timber buildings,
- fences and gate,
- dirt path from settlement to forest,
- clusters of stylized trees/rocks/bushes,
- a forest clearing around the wolf area.

Do not render the old 64px debug grid.

Keep decorative objects behind entities via negative depths. Use repeated deterministic placement arrays, not random placement on every client.

- [ ] **Step 4: Build entity rendering**

Represent players as simple stylized humanoid sprites built from Phaser shapes/containers, with a body, head, small facing indicator, nickname label, and local-player accent. Represent NPCs with role-specific icons and labels. Represent the wolf encounter as 2-3 stylized wolf silhouettes/markers rather than a red circle.

`WorldEntitiesRenderer` should expose callbacks:

```ts
onNpcSelected?: (npcId: string) => void;
onEncounterSelected?: (encounterId: string) => void;
```

- [ ] **Step 5: Refactor `WorldScene` to coordinate instead of drawing everything**

`WorldScene.create()` should:
1. Create background renderer.
2. Create entity renderer.
3. Create `WorldHud`, `InventoryPanel`, `CharacterPanel`, `DialoguePanel`.
4. Subscribe to `worldState`, `playerState`, `npcInteraction`, command rejection, connect/disconnect.
5. Start camera follow on the local player view once available.
6. Keep click-to-move/WASD behavior and server intent rate limiting.

Interaction behavior:
- Clicking NPC clears click-to-move target and emits `interactNpc`.
- Clicking wolves clears click-to-move target and emits `startEncounter`.
- Server remains responsible for range rejection.

- [ ] **Step 6: Add smooth remote/local corrections**

For authoritative snapshots, keep a `serverTarget` position per player and visually interpolate toward it with `Phaser.Math.Linear(current, target, 0.25)` each frame. For the local player, continue immediate local movement prediction but converge toward the authoritative position when a snapshot differs materially.

Do not change the server's 220 px/s authority limit.

- [ ] **Step 7: Verify client tests/build**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/world apps/client/src/scenes/WorldScene.ts apps/client/tests/worldPresentation.test.ts apps/client/src/style.css
git commit -m "feat: render forest settlement world"
```

---

### Task 8: Add Mobile Virtual Joystick Without Breaking Tap-to-Move

**Files:**
- Create: `apps/client/src/input/VirtualJoystick.ts`
- Modify: `apps/client/src/input/WorldInput.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/tests/worldInput.test.ts`
- Modify: `apps/client/src/style.css`

**Interfaces:**
- `VirtualJoystick.getIntent(): { dx: number; dy: number }` returns normalized directional intent.
- `WorldScene` combines keyboard and joystick input; either active directional input cancels pointer-target movement.

- [ ] **Step 1: Add failing normalization tests**

Add pure helper:

```ts
expect(normalizeAnalogIntent({ x: 50, y: 0 }, 80)).toEqual({ dx: 0.625, dy: 0 });
expect(normalizeAnalogIntent({ x: 100, y: 100 }, 80)).toSatisfy(
  (v) => Math.hypot(v.dx, v.dy) <= 1
);
```

Also preserve the existing keyboard diagonal-speed test.

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/client -- worldInput.test.ts
```

- [ ] **Step 3: Implement `normalizeAnalogIntent`**

Clamp magnitude to `radius`, divide by radius, return zero inside a small 8px dead zone.

- [ ] **Step 4: Implement DOM joystick**

Create a fixed lower-left touch control with base and thumb. Use Pointer Events and `setPointerCapture`. Hide it for `(hover: hover) and (pointer: fine)` desktop environments; show it on coarse pointers.

The joystick must call `preventDefault` only for its own pointer events so tapping the game world still performs tap-to-move.

- [ ] **Step 5: Integrate in `WorldScene`**

Movement priority:
1. Keyboard intent if non-zero.
2. Joystick intent if non-zero.
3. Pointer/tap target.

Any keyboard/joystick directional intent clears `pointerTarget`.

- [ ] **Step 6: Run tests/build**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
```

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/input apps/client/src/scenes/WorldScene.ts apps/client/tests/worldInput.test.ts apps/client/src/style.css
git commit -m "feat: add mobile world joystick"
```

---

### Task 9: Add Battle Reachability Preview, Action Modes, and Turn Order HUD

**Files:**
- Create: `apps/client/src/battle/BattlePreview.ts`
- Create: `apps/client/tests/battlePreview.test.ts`
- Modify: `apps/client/src/scenes/BattleScene.ts`
- Modify: `apps/client/src/ui/BattleHud.ts`
- Modify: `apps/client/src/style.css`

**Interfaces:**
- Produces pure helpers `reachableCells(snapshot, combatantId)` and `attackPreview(snapshot, combatantId, targetId, mode)`.
- `BattleScene` uses helpers only for visual guidance; server still validates commands.

- [ ] **Step 1: Write failing preview tests**

Test a small synthetic snapshot:

```ts
it("does not mark blocked cells reachable and respects AP", () => {
  const cells = reachableCells(snapshot, "hero");
  expect(cells.has("1,0")).toBe(false); // blocker
  expect(cells.has("0,2")).toBe(false); // beyond AP budget in fixture
});

it("reports ranged line-of-sight and range state", () => {
  expect(attackPreview(snapshot, "hero", "wolf", "rangedAttack")).toMatchObject({
    valid: false,
    reason: "NO_LINE_OF_SIGHT"
  });
});
```

Reuse axial/hex math logic by moving generic pure client hex functions into `BattlePreview.ts`; do not import server source into the client package.

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/client -- battlePreview.test.ts
```

- [ ] **Step 3: Implement reachable-cell preview**

Use BFS over `snapshot.cells`, excluding `blockedCells` and living combatant positions. Per-step preview cost is 2 when the selected combatant has `legTrauma`, otherwise 1. Stop paths whose cumulative cost exceeds current AP.

Return a `Set<string>` keyed as `q,r`.

- [ ] **Step 4: Implement attack preview**

Return:

```ts
interface AttackPreviewResult {
  valid: boolean;
  reason?: "INSUFFICIENT_AP" | "OUT_OF_RANGE" | "NO_LINE_OF_SIGHT" | "INVALID_TARGET";
  apCost: number;
}
```

Melee cost/range: 2 AP, exactly 1 hex. Ranged cost: 4 AP with `brokenArm`, otherwise 3 AP; max range 6; blockers are `blockedCells`. Do not add numeric cover bonuses.

- [ ] **Step 5: Refactor `BattleScene` rendering**

Keep forest-clearing colors and remove the dark debug feel. Render:
- earth/grass arena background,
- subtle hex outlines,
- reachable cells with a translucent highlight only on player's turn,
- blocked cells as stylized trees/rocks,
- cover cells as logs/bushes,
- active combatant halo,
- hover/selection feedback.

Click behavior becomes mode-explicit:
- default mode = move,
- melee button = melee target mode,
- ranged button = ranged target mode,
- clicking the active action again returns to move mode.

- [ ] **Step 6: Expand `BattleHud`**

Render:
- round number,
- active combatant name,
- HP/AP,
- injuries,
- explicit `Ruch`, `Atak wręcz`, `Atak dystansowy`, `Koniec tury` controls,
- AP cost text on attack buttons,
- turn-order strip from `snapshot.turnOrder` using combatant names.

Change update signature to:

```ts
update(snapshot: BattleSnapshot, playerId: PlayerId, mode: BattleActionMode): void
```

This lets the HUD render round/turn order without duplicating state in `BattleScene`.

- [ ] **Step 7: Friendly rejection mapping**

Map server codes to Polish UI strings in one object:

```ts
const BATTLE_ERROR_LABELS: Record<string, string> = {
  INSUFFICIENT_AP: "Za mało punktów akcji.",
  OUT_OF_RANGE: "Cel jest poza zasięgiem.",
  NO_LINE_OF_SIGHT: "Linia strzału jest zablokowana.",
  NO_PATH: "Nie można dotrzeć na to pole.",
  NOT_ACTIVE_TURN: "To nie jest twoja tura.",
  NOT_OWNER: "Nie możesz sterować tą jednostką."
};
```

Fallback: `Akcja została odrzucona przez serwer.`

- [ ] **Step 8: Run tests/build**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/client/src/battle apps/client/src/scenes/BattleScene.ts apps/client/src/ui/BattleHud.ts apps/client/tests/battlePreview.test.ts apps/client/src/style.css
git commit -m "feat: overhaul tactical battle presentation"
```

---

### Task 10: Wire Scene Transitions, Loot Summary, Reconnection Feedback, and Final Acceptance

**Files:**
- Modify: `apps/client/src/scenes/LoginScene.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/scenes/BattleScene.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Create: `apps/client/src/ui/LootSummary.ts`
- Modify: `apps/client/src/style.css`
- Modify: `.github/workflows/feature-ci.yml`
- Modify: `.github/workflows/pages.yml`
- Modify: `README.md`

**Interfaces:**
- Completes the deployed flow without adding new gameplay rules.

- [ ] **Step 1: Add battle-end scene handling**

`BattleScene` subscribes to `battleEnded`. On victory, show `LootSummary` using the new inventory state and a `Wróć do świata` button. On defeat, show `Porażka — wracasz do osady` and the visible severe/injury state from `character`.

The return button executes:

```ts
this.scene.start("WorldScene", { playerId: this.playerId });
```

Do not create a new socket or new login session.

- [ ] **Step 2: Keep `WorldScene` state synchronized on re-entry**

On `WorldScene.create()`, call:

```ts
gameSocket.requestPlayerState();
gameSocket.sendMoveIntent(this.localPosition);
```

The world-state request continues to use the movement intent pattern already accepted by the server; `playerState` is requested explicitly.

- [ ] **Step 3: Add connection feedback**

`GameSocket` forwards Socket.IO `connect`, `disconnect`, and `connect_error`. `WorldHud`/login form display:
- `Połączono` when connected,
- `Ponowne łączenie…` on disconnect while Socket.IO reconnects,
- `Brak połączenia z serwerem` on connection error.

Do not implement custom retry timers; use Socket.IO's built-in reconnection behavior.

- [ ] **Step 4: Run full monorepo verification locally/in CI**

Run:

```bash
npm install
npm run test
npm run build
```

Expected: all workspaces PASS.

- [ ] **Step 5: Ensure CI covers both test and build**

`feature-ci.yml` must run `npm install`, `npm run test`, and `npm run build` on pushes to `feature/mvp-vertical-slice`.

`pages.yml` keeps:

```yaml
env:
  VITE_GAME_SERVER_URL: https://web-mmorpg-server.onrender.com
```

and uploads `apps/client/dist`.

- [ ] **Step 6: Update README with test URLs and known MVP 2 limits**

Document:
- client: `https://owca217.github.io/WEB_MMORPG/`
- server: `https://web-mmorpg-server.onrender.com`
- free Render instance may sleep when idle,
- progress is in-memory and resets on server restart,
- MVP 2 includes one settlement, two NPC roles, one wolf encounter, inventory, injuries, and tactical battle.

- [ ] **Step 7: Manual acceptance pass**

Verify on desktop:
1. Login.
2. See authored forest settlement instead of grid.
3. Move via WASD and click-to-move.
4. Talk to Boran.
5. Talk to Ada and use heal action.
6. Walk to wolves and enter combat.
7. See reachable cells, AP, turn order, obstacles, cover and explicit action mode.
8. End turn and observe wolf act automatically.
9. Win fight, see loot summary, return to world, open inventory and see wolf pelt/bandages.

Verify on mobile:
1. Login.
2. Move via virtual joystick.
3. Move via tap-to-move.
4. Open/close inventory and character panels.
5. Complete at least one battle without controls covering the active arena.

Verify multiplayer:
1. Open two browser sessions with different nicknames.
2. Confirm both players see each other in the settlement.
3. Put one player in battle; the other remains in shared world.
4. Return the battling player and confirm both are visible again.

- [ ] **Step 8: Commit**

```bash
git add apps/client .github/workflows README.md
git commit -m "feat: complete mvp2 vertical slice"
```

---

## Final Verification Checklist

Before claiming MVP 2 complete, run and record evidence for:

```bash
npm run test
npm run build
```

Then verify the latest GitHub Actions `Feature CI` and `Deploy client to GitHub Pages` runs are green. Confirm Render is running the latest `feature/mvp-vertical-slice` commit before manual public testing.

Do not merge the feature branch into `main` as part of this plan. Merge/release is a separate approval step after the user has tested the deployed MVP 2.
