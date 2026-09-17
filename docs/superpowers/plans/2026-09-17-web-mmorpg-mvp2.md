# WEB MMORPG MVP 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current technical prototype into one polished vertical slice: forest settlement -> NPC interaction -> wolf encounter -> tactical hex combat -> loot/injuries -> return to the shared world.

**Architecture:** Keep the existing TypeScript monorepo and authoritative Node/Socket.IO server. Add small in-memory character state, authored settlement data, NPC interactions, automatic wolf turns, richer player/battle state, and focused client render/UI helpers. Phaser remains responsible for world/battle rendering; DOM overlays remain responsible for HUDs and panels.

**Tech Stack:** TypeScript 5.9, Phaser 4.2.1, Socket.IO 4.8.3, Vite 8.2.2, Vitest 5.0.1, Node.js 22+ in CI.

**Spec:** `docs/superpowers/specs/2026-09-17-web-mmorpg-mvp2-design.md`

## Global Constraints

- The game remains classless; do not introduce fixed character classes.
- Browser client stays on GitHub Pages and server stays on Render.
- Server remains authoritative for position, encounter eligibility, AP, turn order, path validation, line of sight, damage, injuries, NPC turns, loot, inventory, and battle outcome.
- Client may preview movement/attacks but may not authoritatively set damage, HP, AP, loot, or final positions.
- Desktop supports WASD/arrows plus click-to-move.
- Mobile supports both tap-to-move and a compact virtual joystick.
- Touch targets stay approximately 44 CSS px minimum.
- Use original/simple assets or coherent placeholders; never copy Margonem or other commercial-game assets.
- In-memory persistence is acceptable for MVP 2; database accounts remain out of scope.
- Cover may be shown visually, but do not invent numeric cover bonuses yet.
- Continue on `feature/mvp-vertical-slice`; do not merge to `main` without explicit approval.

## Target File Boundaries

- `packages/shared/src/character.ts` — character/player-state contracts.
- `packages/shared/src/world.ts` — NPC/encounter/world contracts.
- `packages/shared/src/inventory.ts` — item metadata.
- `packages/shared/src/protocol.ts` — typed Socket.IO gameplay events.
- `apps/server/src/character/CharacterService.ts` — session character HP/stats/injuries.
- `apps/server/src/world/worldFixtures.ts` — authored forest settlement data.
- `apps/server/src/world/WorldService.ts` — position/range validation and spawn reset.
- `apps/server/src/battle/NpcBattleAi.ts` — deterministic wolf command selection.
- `apps/server/src/battle/BattleService.ts` — battle orchestration and NPC turn draining.
- `apps/server/src/server/createGameServer.ts` — service/socket orchestration only.
- `apps/client/src/state/PlayerStateStore.ts` — latest player snapshot.
- `apps/client/src/world/ForestSettlementLayout.ts` — pure authored layout constants.
- `apps/client/src/world/ForestSettlementRenderer.ts` — decorative map rendering.
- `apps/client/src/world/WorldEntitiesRenderer.ts` — players/NPCs/wolves.
- `apps/client/src/input/VirtualJoystick.ts` — mobile analog control.
- `apps/client/src/ui/WorldHud.ts`, `InventoryPanel.ts`, `CharacterPanel.ts`, `DialoguePanel.ts`, `LootSummary.ts` — DOM UI.
- `apps/client/src/battle/BattlePreview.ts` — pure reachability/range/LOS preview helpers.
- `apps/client/src/scenes/WorldScene.ts`, `BattleScene.ts` — scene coordination.

This remains one plan because each task contributes to one shared end-to-end vertical slice and depends on the same protocol/state path.

---

### Task 1: Restore a Green Baseline with Automatic Wolf Turns

**Files:**
- Create: `apps/server/src/battle/NpcBattleAi.ts`
- Create: `apps/server/tests/npcBattleAi.test.ts`
- Modify: `apps/server/src/battle/BattleService.ts`
- Modify: `apps/server/tests/battleService.test.ts`
- Test: `apps/server/tests/battleEngine.test.ts`
- Test: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- Consumes: `BattleState`, `BattleCommand`, `applyNpcBattleCommand`, `findPath`, `hexDistance`, `hexKey`, `hexNeighbors`.
- Produces: `chooseWolfCommand(state: BattleState, wolfId: string): BattleCommand`.

- [ ] **Step 1: Keep the existing RED service test and add a direct AI unit test**

Create a tiny synthetic `BattleState` with hero `{ q: 0, r: 0 }`, wolf `{ q: 1, r: 0 }`, wolf AP 4, and no blockers. Assert:

```ts
expect(chooseWolfCommand(state, "wolf")).toEqual({
  type: "meleeAttack",
  combatantId: "wolf",
  targetId: "hero"
});
```

Add a second case with hero and wolf separated by at least 2 hexes and assert the chosen command is `move`.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npm run test -w @web-mmorpg/server -- npcBattleAi.test.ts battleService.test.ts
```

Expected: `NpcBattleAi` missing, and the existing `battleService.test.ts` still reports that control remains on the wolf.

- [ ] **Step 3: Implement deterministic command selection**

Core logic:

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

  const goals = hexNeighbors(target.position)
    .filter((cell) => allowed.has(hexKey(cell)) && !blocked.has(hexKey(cell)))
    .sort((a, b) => hexDistance(wolf.position, a) - hexDistance(wolf.position, b));

  for (const goal of goals) {
    const path = findPath(wolf.position, goal, blocked, allowed);
    if (path?.length) return { type: "move", combatantId: wolf.id, target: path[0]! };
  }

  return { type: "endTurn", combatantId: wolf.id };
}
```

Moving one hex at a time keeps AP and injury movement-cost rules inside `BattleEngine`.

- [ ] **Step 4: Drain server-owned NPC turns in `BattleService`**

After a successful player command:

```ts
private runNpcTurns(state: BattleState): BattleState {
  let next = state;
  for (let guard = 0; guard < 32 && !next.finished; guard += 1) {
    const active = next.combatants[next.activeCombatantId];
    if (!active || active.ownerPlayerId !== undefined || active.side !== "enemy") break;

    const result = applyNpcBattleCommand(next, chooseWolfCommand(next, active.id));
    if (!result.ok) throw new Error(`NPC_COMMAND_REJECTED:${result.code}`);
    next = result.state;
  }
  return next;
}
```

- [ ] **Step 5: Verify regression safety**

```bash
npm run test -w @web-mmorpg/server -- npcBattleAi.test.ts battleService.test.ts battleEngine.test.ts socketFlow.test.ts
npm run build -w @web-mmorpg/server
```

Expected: PASS, including the existing `NOT_OWNER` cheating rejection.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/battle/NpcBattleAi.ts apps/server/src/battle/BattleService.ts apps/server/tests/npcBattleAi.test.ts apps/server/tests/battleService.test.ts
git commit -m "feat: run wolf npc turns automatically"
```

---

### Task 2: Add Character State, Item Metadata, and Player-State Protocol

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
- Produces `CharacterSnapshot`, `PlayerStateSnapshot`, richer `InventoryItem`, `CharacterService`.
- Adds client events `requestPlayerState()` and `requestWorldState()` and server event `playerState(snapshot)`.

- [ ] **Step 1: Write failing character tests**

```ts
it("creates stable base stats", () => {
  const characters = new CharacterService();
  expect(characters.createPlayer("p1", "Owczy")).toMatchObject({
    playerId: "p1", nickname: "Owczy", level: 1,
    hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
    severelyInjured: false, injuries: []
  });
});

it("healer restores HP without erasing injuries", () => {
  const characters = new CharacterService();
  characters.createPlayer("p1", "Owczy");
  characters.applyBattleResult("p1", {
    hp: 0, severelyInjured: true, injuries: ["legTrauma"]
  });
  characters.healHp("p1");
  expect(characters.getSnapshot("p1")).toMatchObject({
    hp: 100, severelyInjured: true, injuries: ["legTrauma"]
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/server -- characterService.test.ts
```

- [ ] **Step 3: Add exact shared contracts**

`packages/shared/src/character.ts`:

```ts
import type { InjuryKind } from "./battle";
import type { PlayerId } from "./ids";
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

Extend `InventoryItem` with:

```ts
export type ItemCategory = "material" | "medical";
category: ItemCategory;
description: string;
```

Export `./character` from `packages/shared/src/index.ts`.

- [ ] **Step 4: Implement `CharacterService`**

Required signatures:

```ts
createPlayer(playerId: PlayerId, nickname: string): CharacterSnapshot
getSnapshot(playerId: PlayerId): CharacterSnapshot | undefined
applyBattleResult(playerId: PlayerId, result: Pick<CharacterSnapshot, "hp" | "severelyInjured" | "injuries">): CharacterSnapshot
recoverAfterDefeat(playerId: PlayerId): CharacterSnapshot
healHp(playerId: PlayerId): CharacterSnapshot
removePlayer(playerId: PlayerId): void
```

`recoverAfterDefeat` sets HP to `Math.max(1, Math.ceil(maxHp * 0.25))` and preserves `severelyInjured` plus injury list. This prevents a 0-HP world state while retaining defeat consequences.

- [ ] **Step 5: Enrich wolf loot**

Use:

```ts
{ itemId: "wolf-pelt", name: "Wolf Pelt", quantity: 1, category: "material", description: "A rough pelt taken from a forest wolf." }
{ itemId: "field-bandage", name: "Field Bandage", quantity: 2, category: "medical", description: "A simple bandage for field treatment." }
```

`InventoryService.addItems` copies metadata on first stack and only increments quantity on later stacks.

- [ ] **Step 6: Extend protocol**

Add:

```ts
requestPlayerState: () => void;
requestWorldState: () => void;
```

and:

```ts
playerState: (snapshot: PlayerStateSnapshot) => void;
```

- [ ] **Step 7: Verify**

```bash
npm run test -w @web-mmorpg/server -- characterService.test.ts worldService.test.ts
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared apps/server/src/character apps/server/src/inventory apps/server/src/loot apps/server/tests/characterService.test.ts
git commit -m "feat: add session character state"
```

---

### Task 3: Author the Forest Settlement and NPC Rules

**Files:**
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/server/src/world/worldFixtures.ts`
- Modify: `apps/server/src/world/WorldService.ts`
- Modify: `apps/server/src/session/SessionStore.ts`
- Modify: `apps/server/tests/worldService.test.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- Produces `NpcSnapshot`, `NpcInteractionPayload`, `WorldService.interactNpc`, location id `forest-settlement-01`.

- [ ] **Step 1: Update tests first**

Change login location expectation to `forest-settlement-01`. Add:

```ts
it("exposes guide, healer and wolves", () => {
  const snapshot = new WorldService().snapshot("forest-settlement-01");
  expect(snapshot.npcs.map((n) => n.kind).sort()).toEqual(["guide", "healer"]);
  expect(snapshot.encounters.some((e) => e.id === "wolf-pack-01")).toBe(true);
});

it("rejects npc interaction outside radius", () => {
  const world = new WorldService();
  world.addPlayer({ id: "p1", nickname: "Owczy" }, 0);
  expect(() => world.interactNpc("p1", "healer-ada")).toThrow("NPC_OUT_OF_RANGE");
});
```

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/server -- worldService.test.ts socketFlow.test.ts
```

- [ ] **Step 3: Add world/NPC contracts**

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
```

Add `npcs: NpcSnapshot[]` to `WorldStateSnapshot`.

Add:

```ts
export interface NpcInteractionPayload {
  npcId: string;
  npcName: string;
  kind: NpcKind;
  title: string;
  lines: string[];
  canHeal: boolean;
}
```

Protocol client events:

```ts
interactNpc: (payload: { npcId: string }) => void;
healAtNpc: (payload: { npcId: string }) => void;
```

Server event:

```ts
npcInteraction: (payload: NpcInteractionPayload) => void;
```

- [ ] **Step 4: Replace `MEADOW_01` with the authored fixture**

Use `1600x900`, spawn `{ x: 360, y: 470 }`, Boran at `{ x: 610, y: 420 }`, Ada at `{ x: 720, y: 535 }`, and wolf encounter at `{ x: 1320, y: 455 }`. Both NPC interaction radii are 95. Keep encounter radius 90 and max world speed 220.

- [ ] **Step 5: Implement authoritative interaction/range checks**

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

Add `resetPlayerToSpawn(playerId)` for defeat recovery.

- [ ] **Step 6: Update default session location and socket test coordinates**

`SessionStore.login()` returns `forest-settlement-01`. Update `socketFlow.test.ts` to use wolf coordinate `1320,455`.

- [ ] **Step 7: Verify**

```bash
npm run test -w @web-mmorpg/server -- worldService.test.ts socketFlow.test.ts
npm run build -w @web-mmorpg/server
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/world.ts packages/shared/src/protocol.ts apps/server/src/world apps/server/src/session/SessionStore.ts apps/server/tests/worldService.test.ts apps/server/tests/socketFlow.test.ts
git commit -m "feat: add forest settlement and npcs"
```

---

### Task 4: Persist Battle Outcome and Wire Player/NPC State Through Socket.IO

**Files:**
- Modify: `apps/server/src/battle/BattleService.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/server/tests/battleService.test.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- `BattleService.startBattle(character: CharacterSnapshot, encounterId: string): BattleSnapshot`.
- `AppliedBattleCommand.playerOutcome` contains hero HP/severe/injuries when finished.
- `battleEnded` sends outcome, inventory, character.

- [ ] **Step 1: Write failing persistence tests**

Update battle-service tests to call the new signature using a complete `CharacterSnapshot`. Add a socket assertion that a battle-end character snapshot preserves hero injury state.

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/server -- battleService.test.ts socketFlow.test.ts
```

- [ ] **Step 3: Build hero combatant from character state**

Use character HP/maxHP/maxAP/initiative/severe/injuries instead of hard-coded player values. Wolf stays 60 HP, 4 AP, 7 initiative for this slice.

Add:

```ts
playerOutcome?: {
  hp: number;
  severelyInjured: boolean;
  injuries: InjuryKind[];
};
```

to `AppliedBattleCommand` and populate it from the player's combatant when battle finishes.

- [ ] **Step 4: Define battle-end protocol**

```ts
battleEnded: (payload: {
  outcome: "victory" | "defeat";
  inventory: InventorySnapshot;
  character: CharacterSnapshot;
}) => void;
```

- [ ] **Step 5: Wire service lifecycle in `createGameServer`**

On login:
1. Create/get character.
2. Add world player.
3. Emit `playerState`.
4. Broadcast `worldState`.

On `requestPlayerState`: emit character + inventory.

On `requestWorldState`: emit `world.snapshot(session.locationId)` only to that socket.

On encounter start: validate range, call `battles.startBattle(character, encounterId)`, leave world room, emit `battleStarted`.

On finished battle:
1. Apply `playerOutcome`.
2. If defeat, call `recoverAfterDefeat` and `world.resetPlayerToSpawn`.
3. If victory, add deterministic loot.
4. Emit a fresh `playerState`.
5. Emit `battleEnded` with outcome/inventory/character.
6. Remove battle, rejoin `location:forest-settlement-01`, broadcast world state.

On disconnect: remove battle/world/session/character state; add `InventoryService.removePlayer(playerId)` and call it too so disconnected sessions do not leak memory.

- [ ] **Step 6: Wire Boran and Ada**

`interactNpc` validates range. Boran emits:

```ts
{
  npcId: "guide-boran",
  npcName: "Boran",
  kind: "guide",
  title: "Droga przez las",
  lines: ["Wilki kręcą się przy wschodniej ścieżce.", "Trzymaj się drogi i nie lekceważ ran."],
  canHeal: false
}
```

Ada emits:

```ts
{
  npcId: "healer-ada",
  npcName: "Ada",
  kind: "healer",
  title: "Lecznica Ady",
  lines: ["Mogę opatrzyć cię i przywrócić siły.", "Ciężkie urazy pozostaną do czasu pełnego systemu leczenia."],
  canHeal: true
}
```

`healAtNpc` re-validates Ada's range, restores HP only, and emits `playerState`.

- [ ] **Step 7: Verify all server tests/build**

```bash
npm run test -w @web-mmorpg/server
npm run build -w @web-mmorpg/server
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/protocol.ts apps/server/src apps/server/tests
git commit -m "feat: persist battle and npc state"
```

---

### Task 5: Lock the Complete Socket Vertical Slice with Integration Tests

**Files:**
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- Verifies login -> player/world state -> personal battle -> automatic wolf turn -> battle end -> loot -> world return.

- [ ] **Step 1: Add a full-flow test**

Test sequence:
1. Login `Owczy`.
2. Receive initial `playerState` and `worldState`.
3. Move test player near wolves through `game.services.world.movePlayer`.
4. Start encounter.
5. Repeatedly issue legal player commands with a bounded loop (`turn < 40`) until `battleEnded`.
6. Expect victory, `wolf-pelt`, `field-bandage`.
7. Expect post-battle world state containing the player.

Use current snapshots to choose a legal player action; ranged attack when valid, otherwise move/end turn. Never issue commands for the wolf.

- [ ] **Step 2: Add defeat recovery coverage**

Use service-level state setup to force a hero to 0 HP, finish battle, then assert returned character HP is 25% max or at least 1, while `severelyInjured` and injuries remain.

- [ ] **Step 3: Add two-client isolation coverage**

Log in `Owczy` and `Karolina`. Assert both are present in the same world snapshot. Put only Owczy into battle and assert Karolina does not receive `battleStarted`. After Owczy returns, both appear in world again.

- [ ] **Step 4: Verify**

```bash
npm run test -w @web-mmorpg/server -- socketFlow.test.ts
npm run test -w @web-mmorpg/server
npm run build -w @web-mmorpg/server
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/tests/socketFlow.test.ts
git commit -m "test: cover complete mvp2 socket loop"
```

---

### Task 6: Add Client Player State, World HUD, Inventory, Character, and Dialogue Panels

**Files:**
- Create: `apps/client/src/state/PlayerStateStore.ts`
- Create: `apps/client/tests/playerStateStore.test.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Create: `apps/client/src/ui/WorldHud.ts`
- Create: `apps/client/src/ui/InventoryPanel.ts`
- Create: `apps/client/src/ui/CharacterPanel.ts`
- Create: `apps/client/src/ui/DialoguePanel.ts`
- Modify: `apps/client/src/style.css`

**Interfaces:**
- `PlayerStateStore.get(): PlayerStateSnapshot | null`.
- `PlayerStateStore.subscribe(handler): () => void`.
- `GameSocket` exposes `requestPlayerState`, `requestWorldState`, `interactNpc`, `healAtNpc`, `onPlayerState`, `onNpcInteraction`.

- [ ] **Step 1: Write store test**

```ts
it("publishes the latest player state", () => {
  const store = new PlayerStateStore();
  const seen: string[] = [];
  store.subscribe((state) => seen.push(state.character.nickname));
  store.set({
    character: {
      playerId: "p1", nickname: "Owczy", level: 1,
      hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
      severelyInjured: false, injuries: []
    },
    inventory: { items: [] }
  });
  expect(store.get()?.character.nickname).toBe("Owczy");
  expect(seen).toEqual(["Owczy"]);
});
```

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/client -- playerStateStore.test.ts
```

- [ ] **Step 3: Implement store and socket surface**

Keep a single Socket.IO connection. Add built-in connection callbacks (`connect`, `disconnect`, `connect_error`) in `GameSocket`; no custom retry timer.

- [ ] **Step 4: Implement `WorldHud`**

Show nickname, HP current/max, `AP max`, connection status, inventory button, character button. Required API:

```ts
update(state: PlayerStateSnapshot): void
setConnectionState(state: "connected" | "connecting" | "disconnected"): void
destroy(): void
```

- [ ] **Step 5: Implement inventory/character panels**

Inventory renders item name, quantity, category, description.

Character renders nickname, level, HP, initiative, severe-injury state and Polish injury labels. Reserve a `Specjalizacje` section with text `Rozwój biegłości pojawi się w kolejnym etapie`; do not invent classes/trees.

- [ ] **Step 6: Implement dialogue panel**

Render NPC name/title/lines. If `canHeal`, show `Opatrz rany`, minimum 44px high, calling `healAtNpc(npcId)`.

- [ ] **Step 7: Style responsive panels**

Use a consistent dark-wood/forest palette, safe-area aware fixed positioning, readable mobile typography, and >=44px controls.

- [ ] **Step 8: Verify**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
```

- [ ] **Step 9: Commit**

```bash
git add apps/client/src/state apps/client/src/net/GameSocket.ts apps/client/src/ui apps/client/tests/playerStateStore.test.ts apps/client/src/style.css
git commit -m "feat: add world hud and player panels"
```

---

### Task 7: Replace the Debug Grid with the Forest Settlement Presentation

**Files:**
- Create: `apps/client/src/world/ForestSettlementLayout.ts`
- Create: `apps/client/src/world/ForestSettlementRenderer.ts`
- Create: `apps/client/src/world/WorldEntitiesRenderer.ts`
- Create: `apps/client/tests/worldPresentation.test.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/style.css`

**Interfaces:**
- `FOREST_SETTLEMENT_LAYOUT` is pure data and testable without Phaser.
- Renderer owns decoration only; entity renderer owns players/NPCs/wolves; `WorldScene` coordinates input/network/camera/UI.

- [ ] **Step 1: Write pure layout tests**

Define:

```ts
export const FOREST_SETTLEMENT_LAYOUT = {
  settlement: { x: 100, y: 160, width: 820, height: 570 },
  gate: { x: 930, y: 390, width: 70, height: 150 },
  forest: { x: 980, y: 0, width: 620, height: 900 }
} as const;
```

Test spawn `360,470` lies inside settlement and wolf `1320,455` lies inside forest.

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/client -- worldPresentation.test.ts
```

- [ ] **Step 3: Render an authored forest-settlement background**

Use deterministic Phaser shapes/graphics: layered grass/earth, clearing, two timber buildings, fences/gate, dirt path, tree/rock/bush clusters, wolf clearing. Remove the old 64px debug grid. Keep decoration at negative depth.

- [ ] **Step 4: Render readable world entities**

Use original shape-based stylized placeholders: humanoid body/head/facing marker for players, role-specific NPC accents, 2-3 wolf silhouettes/markers for the encounter. Keep nickname/name labels. Local player gets a distinct accent.

`WorldEntitiesRenderer` exposes:

```ts
onNpcSelected?: (npcId: string) => void;
onEncounterSelected?: (encounterId: string) => void;
```

- [ ] **Step 5: Refactor `WorldScene`**

On create:
1. Build background and entity renderers.
2. Build world HUD/panels.
3. Subscribe to `worldState`, `playerState`, `npcInteraction`, rejections, connection state.
4. Call `requestWorldState()` and `requestPlayerState()`.
5. Preserve WASD/arrows + click/tap movement.
6. Clicking NPC emits `interactNpc`; clicking wolves emits `startEncounter`.
7. Camera follows local player and remains clamped to `1600x900`.

- [ ] **Step 6: Smooth authoritative corrections**

Remote entities interpolate to latest server target with `Phaser.Math.Linear(current, target, 0.25)`. Local prediction remains immediate but converges toward authoritative snapshots rather than snapping.

- [ ] **Step 7: Verify**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
```

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/world apps/client/src/scenes/WorldScene.ts apps/client/tests/worldPresentation.test.ts apps/client/src/style.css
git commit -m "feat: render forest settlement world"
```

---

### Task 8: Add Mobile Virtual Joystick While Keeping Tap-to-Move

**Files:**
- Create: `apps/client/src/input/VirtualJoystick.ts`
- Modify: `apps/client/src/input/WorldInput.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/tests/worldInput.test.ts`
- Modify: `apps/client/src/style.css`

**Interfaces:**
- `VirtualJoystick.getIntent(): { dx: number; dy: number }`.
- `normalizeAnalogIntent(offset, radius)` is pure/tested.

- [ ] **Step 1: Add failing analog tests**

```ts
expect(normalizeAnalogIntent({ x: 50, y: 0 }, 80)).toEqual({ dx: 0.625, dy: 0 });
const diagonal = normalizeAnalogIntent({ x: 100, y: 100 }, 80);
expect(Math.hypot(diagonal.dx, diagonal.dy)).toBeLessThanOrEqual(1);
```

Keep existing keyboard diagonal-speed and pointer overshoot tests.

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/client -- worldInput.test.ts
```

- [ ] **Step 3: Implement analog normalization**

8px dead zone, magnitude clamped to radius, then normalized to `[-1,1]` range.

- [ ] **Step 4: Implement DOM joystick**

Fixed lower-left base/thumb, Pointer Events with pointer capture. Show on coarse pointers, hide on fine-pointer desktop. Prevent default only on joystick events so world taps still work.

- [ ] **Step 5: Integrate movement priority**

1. Keyboard if non-zero.
2. Joystick if non-zero.
3. Pointer/tap target.

Directional input clears pointer target.

- [ ] **Step 6: Verify and commit**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
git add apps/client/src/input apps/client/src/scenes/WorldScene.ts apps/client/tests/worldInput.test.ts apps/client/src/style.css
git commit -m "feat: add mobile world joystick"
```

---

### Task 9: Overhaul Tactical Battle UX

**Files:**
- Create: `apps/client/src/battle/BattlePreview.ts`
- Create: `apps/client/tests/battlePreview.test.ts`
- Modify: `apps/client/src/scenes/BattleScene.ts`
- Modify: `apps/client/src/ui/BattleHud.ts`
- Modify: `apps/client/src/style.css`

**Interfaces:**
- `reachableCells(snapshot, combatantId): Set<string>`.
- `attackPreview(snapshot, combatantId, targetId, mode): AttackPreviewResult`.
- `BattleActionMode = "move" | "meleeAttack" | "rangedAttack"`.

- [ ] **Step 1: Write failing preview tests**

Use a small synthetic battle snapshot. Assert blocked cells are never reachable, AP limits are respected, melee requires distance 1, ranged max distance is 6, `brokenArm` costs 4 AP instead of 3, and blocked LOS returns `NO_LINE_OF_SIGHT`.

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/client -- battlePreview.test.ts
```

- [ ] **Step 3: Implement pure hex helpers inside `BattlePreview.ts`**

Define local `hexKey`, `hexNeighbors`, `hexDistance`, axial-to-cube rounding, and line sampling so preview semantics match server LOS without importing server source. Use the same six axial directions as server:

```ts
[{q:1,r:0},{q:1,r:-1},{q:0,r:-1},{q:-1,r:0},{q:-1,r:1},{q:0,r:1}]
```

- [ ] **Step 4: Implement reachability**

BFS over `snapshot.cells`, excluding `blockedCells` and living combatant positions. Step cost = 2 with `legTrauma`, else 1. Stop when cumulative cost exceeds current AP.

- [ ] **Step 5: Implement attack preview**

```ts
interface AttackPreviewResult {
  valid: boolean;
  reason?: "INSUFFICIENT_AP" | "OUT_OF_RANGE" | "NO_LINE_OF_SIGHT" | "INVALID_TARGET";
  apCost: number;
}
```

Melee: 2 AP, distance exactly 1. Ranged: 3 AP, or 4 with `brokenArm`, max distance 6, blockers = `blockedCells`. Do not assign numeric cover bonuses.

- [ ] **Step 6: Restyle/render battle scene**

Forest-clearing background, subtle integrated hexes, reachable-cell highlight, stylized tree/rock hard blockers, log/bush cover, active-combatant halo, hover/selection feedback. Default mode is `move`; melee/ranged buttons set explicit target mode.

- [ ] **Step 7: Expand battle HUD**

Show round, active unit, HP/AP, injuries, turn-order strip, and four >=44px controls: `Ruch`, `Atak wręcz`, `Atak dystansowy`, `Koniec tury`.

Change HUD update boundary to:

```ts
update(snapshot: BattleSnapshot, playerId: PlayerId, mode: BattleActionMode): void
```

- [ ] **Step 8: Map server rejections to friendly Polish messages**

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

- [ ] **Step 9: Verify and commit**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
git add apps/client/src/battle apps/client/src/scenes/BattleScene.ts apps/client/src/ui/BattleHud.ts apps/client/tests/battlePreview.test.ts apps/client/src/style.css
git commit -m "feat: overhaul tactical battle presentation"
```

---

### Task 10: Finish Battle Return, Loot Summary, Deployment, and Acceptance

**Files:**
- Create: `apps/client/src/ui/LootSummary.ts`
- Modify: `apps/client/src/scenes/BattleScene.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/scenes/LoginScene.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Modify: `apps/client/src/style.css`
- Modify: `.github/workflows/feature-ci.yml`
- Modify: `.github/workflows/pages.yml`
- Modify: `README.md`

**Interfaces:**
- Completes deployed world -> battle -> result -> world loop without adding new combat rules.

- [ ] **Step 1: Handle `battleEnded` in the battle scene**

Victory: show loot summary and `Wróć do świata`. Defeat: show `Porażka — wracasz do osady` plus visible severe/injury state. Return uses:

```ts
this.scene.start("WorldScene", { playerId: this.playerId });
```

Reuse the existing socket/session; never reconnect/login during scene transition.

- [ ] **Step 2: Refresh state on world re-entry**

`WorldScene.create()` calls:

```ts
gameSocket.requestWorldState();
gameSocket.requestPlayerState();
```

Do not abuse `moveIntent` as a snapshot request.

- [ ] **Step 3: Add connection feedback**

Show `Połączono`, `Ponowne łączenie…`, and `Brak połączenia z serwerem` using Socket.IO built-in reconnect events. Do not add a custom polling loop.

- [ ] **Step 4: Ensure CI verifies all workspaces**

`feature-ci.yml` runs:

```bash
npm install
npm run test
npm run build
```

`pages.yml` keeps:

```yaml
env:
  VITE_GAME_SERVER_URL: https://web-mmorpg-server.onrender.com
```

and uploads `apps/client/dist`.

- [ ] **Step 5: Update README**

Document:
- client: `https://owca217.github.io/WEB_MMORPG/`
- server: `https://web-mmorpg-server.onrender.com`
- Render free instance may sleep when idle,
- progress is in-memory and resets on server restart,
- MVP 2 scope: one settlement, guide, healer, wolf encounter, inventory, injuries, tactical battle.

- [ ] **Step 6: Run full verification**

```bash
npm install
npm run test
npm run build
```

Expected: all workspaces PASS.

- [ ] **Step 7: Manual desktop acceptance**

Login; see settlement instead of grid; move with WASD and click; talk to Boran; use Ada; enter wolf fight; see AP/turn order/reachable cells/obstacles/cover; observe automatic wolf turn; win; see loot; return; open inventory and confirm rewards.

- [ ] **Step 8: Manual mobile acceptance**

Login; move by joystick and tap; open inventory/character; talk to NPC; complete battle with usable controls and no critical arena obstruction.

- [ ] **Step 9: Manual multiplayer acceptance**

Two different nicknames see each other; one enters personal battle without pulling the other in; after battle both appear together again.

- [ ] **Step 10: Commit**

```bash
git add apps/client .github/workflows README.md
git commit -m "feat: complete mvp2 vertical slice"
```

---

## Final Verification Checklist

Before claiming MVP 2 complete:

```bash
npm run test
npm run build
```

Then verify the latest GitHub Actions `Feature CI` and `Deploy client to GitHub Pages` runs are green. Confirm Render has deployed the latest `feature/mvp-vertical-slice` commit before public testing.

Do not merge into `main` as part of this plan. Merge/release requires a separate explicit approval after the deployed MVP 2 has been tested.