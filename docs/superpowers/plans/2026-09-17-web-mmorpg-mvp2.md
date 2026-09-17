# WEB MMORPG MVP 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current technical prototype into one polished vertical slice: forest settlement -> NPC interaction -> wolf encounter -> tactical hex combat -> loot/injuries -> return to the shared world.

**Architecture:** Keep the existing TypeScript monorepo and authoritative Node/Socket.IO server. Add in-memory character state, authored settlement data, NPC interactions, automatic wolf turns, richer player/battle snapshots, and focused client render/UI helpers. Phaser remains responsible for world/battle rendering; DOM overlays remain responsible for HUDs and panels.

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

- [ ] **Step 1: Keep the existing RED service test and add direct AI tests**

Create `npcBattleAi.test.ts` with a helper that constructs a valid synthetic `BattleState`. The adjacent case must assert:

```ts
expect(chooseWolfCommand(state, "wolf")).toEqual({
  type: "meleeAttack",
  combatantId: "wolf",
  targetId: "hero"
});
```

For a separated state, assert:

```ts
expect(chooseWolfCommand(state, "wolf")).toMatchObject({
  type: "move",
  combatantId: "wolf"
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npm run test -w @web-mmorpg/server -- npcBattleAi.test.ts battleService.test.ts
```

Expected: `NpcBattleAi` missing, and existing service test still leaves control on the wolf.

- [ ] **Step 3: Implement deterministic command selection**

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

Inside `applyCommand`, after `applyBattleCommand` succeeds:

```ts
active.state = this.runNpcTurns(result.state);
const snapshot = this.toSnapshot(active.state);
```

- [ ] **Step 5: Verify regression safety**

```bash
npm run test -w @web-mmorpg/server -- npcBattleAi.test.ts battleService.test.ts battleEngine.test.ts socketFlow.test.ts
npm run build -w @web-mmorpg/server
```

Expected: PASS, including existing `NOT_OWNER` cheating rejection.

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

Extend `InventoryItem`:

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

```ts
export class CharacterService {
  private readonly characters = new Map<PlayerId, CharacterSnapshot>();

  createPlayer(playerId: PlayerId, nickname: string): CharacterSnapshot {
    const existing = this.characters.get(playerId);
    if (existing) return this.clone(existing);
    const character: CharacterSnapshot = {
      playerId, nickname, level: 1,
      hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
      severelyInjured: false, injuries: []
    };
    this.characters.set(playerId, character);
    return this.clone(character);
  }

  getSnapshot(playerId: PlayerId): CharacterSnapshot | undefined {
    const character = this.characters.get(playerId);
    return character ? this.clone(character) : undefined;
  }

  applyBattleResult(
    playerId: PlayerId,
    result: Pick<CharacterSnapshot, "hp" | "severelyInjured" | "injuries">
  ): CharacterSnapshot {
    const character = this.require(playerId);
    character.hp = result.hp;
    character.severelyInjured = result.severelyInjured;
    character.injuries = [...result.injuries];
    return this.clone(character);
  }

  recoverAfterDefeat(playerId: PlayerId): CharacterSnapshot {
    const character = this.require(playerId);
    character.hp = Math.max(1, Math.ceil(character.maxHp * 0.25));
    return this.clone(character);
  }

  healHp(playerId: PlayerId): CharacterSnapshot {
    const character = this.require(playerId);
    character.hp = character.maxHp;
    return this.clone(character);
  }

  removePlayer(playerId: PlayerId): void { this.characters.delete(playerId); }

  private require(playerId: PlayerId): CharacterSnapshot {
    const character = this.characters.get(playerId);
    if (!character) throw new Error("CHARACTER_NOT_FOUND");
    return character;
  }

  private clone(character: CharacterSnapshot): CharacterSnapshot {
    return { ...character, injuries: [...character.injuries] };
  }
}
```

- [ ] **Step 5: Enrich wolf loot and inventory cleanup**

`LootService` returns:

```ts
[
  {
    itemId: "wolf-pelt", name: "Wolf Pelt", quantity: 1,
    category: "material", description: "A rough pelt taken from a forest wolf."
  },
  {
    itemId: "field-bandage", name: "Field Bandage", quantity: 2,
    category: "medical", description: "A simple bandage for field treatment."
  }
]
```

Add to `InventoryService`:

```ts
removePlayer(playerId: PlayerId): void {
  this.inventories.delete(playerId);
}
```

On first stack, copy `category` and `description`; later stacks only increment quantity.

- [ ] **Step 6: Extend protocol**

Add to `ClientToServerEvents`:

```ts
requestPlayerState: () => void;
requestWorldState: () => void;
```

Add to `ServerToClientEvents`:

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

Change session/socket expectations from `meadow-01` to `forest-settlement-01`.

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

export interface NpcInteractionPayload {
  npcId: string;
  npcName: string;
  kind: NpcKind;
  title: string;
  lines: string[];
  canHeal: boolean;
}
```

Add `npcs: NpcSnapshot[]` to `WorldStateSnapshot`.

Protocol additions:

```ts
interactNpc: (payload: { npcId: string }) => void;
healAtNpc: (payload: { npcId: string }) => void;
```

and:

```ts
npcInteraction: (payload: NpcInteractionPayload) => void;
```

- [ ] **Step 4: Replace meadow fixture with authored forest settlement**

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

Extend `WorldFixture` with `npcs: NpcSnapshot[]`. Keep `ENCOUNTER_ACTIVATION_RADIUS = 90` and `MAX_WORLD_SPEED = 220`.

- [ ] **Step 5: Implement authoritative interaction and spawn reset**

```ts
private requirePlayer(playerId: PlayerId): WorldPlayerState {
  const player = this.players.get(playerId);
  if (!player) throw new Error("PLAYER_NOT_FOUND");
  return player;
}

interactNpc(playerId: PlayerId, npcId: string): NpcSnapshot {
  const player = this.requirePlayer(playerId);
  const npc = FOREST_SETTLEMENT_01.npcs.find((item) => item.id === npcId);
  if (!npc) throw new Error("NPC_NOT_FOUND");
  if (Math.hypot(npc.x - player.x, npc.y - player.y) > npc.interactionRadius) {
    throw new Error("NPC_OUT_OF_RANGE");
  }
  return { ...npc };
}

resetPlayerToSpawn(playerId: PlayerId, now = Date.now()): WorldPlayerSnapshot {
  const player = this.requirePlayer(playerId);
  player.x = FOREST_SETTLEMENT_01.spawn.x;
  player.y = FOREST_SETTLEMENT_01.spawn.y;
  player.lastMoveAt = now;
  return this.toSnapshot(player);
}
```

Use `FOREST_SETTLEMENT_01` everywhere `MEADOW_01` was used.

- [ ] **Step 6: Update default session location and socket coordinates**

```ts
const locationId: LocationId = "forest-settlement-01";
```

Update test-world movement near encounter to `{ x: 1320, y: 455 }`.

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

Update service setup:

```ts
const character: CharacterSnapshot = {
  playerId: "p1", nickname: "Owczy", level: 1,
  hp: 73, maxHp: 100, maxAp: 5, initiative: 10,
  severelyInjured: true, injuries: ["legTrauma"]
};
const snapshot = service.startBattle(character, "wolf-pack-01");
const hero = snapshot.combatants.find((c) => c.ownerPlayerId === "p1");
expect(hero).toMatchObject({ hp: 73, severelyInjured: true, injuries: ["legTrauma"] });
```

Add a finished-outcome assertion using a test battle state driven to completion:

```ts
expect(result.finished).toBe(true);
expect(result.playerOutcome).toMatchObject({
  severelyInjured: expect.any(Boolean),
  injuries: expect.any(Array)
});
```

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/server -- battleService.test.ts socketFlow.test.ts
```

- [ ] **Step 3: Build hero combatant from `CharacterSnapshot`**

Change signature:

```ts
startBattle(character: CharacterSnapshot, encounterId: string): BattleSnapshot
```

Hero input becomes:

```ts
{
  id: `hero:${character.playerId}`,
  ownerPlayerId: character.playerId,
  side: "player",
  name: character.nickname,
  hp: character.hp,
  maxHp: character.maxHp,
  maxAp: character.maxAp,
  initiative: character.initiative,
  position: playerStart,
  severelyInjured: character.severelyInjured,
  injuries: [...character.injuries]
}
```

Add to `AppliedBattleCommand`:

```ts
playerOutcome?: {
  hp: number;
  severelyInjured: boolean;
  injuries: InjuryKind[];
};
```

- [ ] **Step 4: Define battle-end protocol**

```ts
battleEnded: (payload: {
  outcome: "victory" | "defeat";
  inventory: InventorySnapshot;
  character: CharacterSnapshot;
}) => void;
```

- [ ] **Step 5: Wire service lifecycle in `createGameServer`**

Add helper:

```ts
function emitPlayerState(socket: SocketType, playerId: PlayerId): void {
  const character = characters.getSnapshot(playerId);
  if (!character) return;
  socket.emit("playerState", {
    character,
    inventory: inventory.getSnapshot(playerId)
  });
}
```

Login path:

```ts
const character = characters.createPlayer(result.playerId, session?.nickname ?? nickname.trim());
world.addPlayer({ id: result.playerId, nickname: character.nickname });
socket.join(`location:${result.locationId}`);
ack(result);
emitPlayerState(socket, result.playerId);
io.to(`location:${result.locationId}`).emit("worldState", world.snapshot(result.locationId));
```

Snapshot handlers:

```ts
socket.on("requestPlayerState", () => {
  if (playerId) emitPlayerState(socket, playerId);
});

socket.on("requestWorldState", () => {
  if (!playerId) return;
  const session = sessions.get(playerId);
  if (session) socket.emit("worldState", world.snapshot(session.locationId));
});
```

Battle start:

```ts
const character = characters.getSnapshot(playerId);
if (!character) return;
world.startEncounter(playerId, encounterId);
const snapshot = battles.startBattle(character, encounterId);
socket.leave(`location:${session.locationId}`);
socket.emit("battleStarted", snapshot);
```

Battle finish:

```ts
if (applied.playerOutcome) characters.applyBattleResult(playerId, applied.playerOutcome);
if (applied.victory && applied.encounterId && applied.seed !== undefined) {
  inventory.addItems(playerId, loot.rollEncounterLoot(applied.encounterId, applied.seed));
} else if (!applied.victory) {
  characters.recoverAfterDefeat(playerId);
  world.resetPlayerToSpawn(playerId);
}

const character = characters.getSnapshot(playerId)!;
const inventorySnapshot = inventory.getSnapshot(playerId);
emitPlayerState(socket, playerId);
socket.emit("battleEnded", {
  outcome: applied.victory ? "victory" : "defeat",
  inventory: inventorySnapshot,
  character
});
battles.removeBattleForPlayer(playerId);
socket.join("location:forest-settlement-01");
io.to("location:forest-settlement-01").emit("worldState", world.snapshot("forest-settlement-01"));
```

On disconnect, remove battle/world/session/character/inventory state.

- [ ] **Step 6: Wire Boran and Ada**

```ts
socket.on("interactNpc", ({ npcId }) => {
  if (!playerId) return;
  try {
    const npc = world.interactNpc(playerId, npcId);
    socket.emit("npcInteraction", npc.kind === "guide" ? {
      npcId: npc.id,
      npcName: npc.name,
      kind: "guide",
      title: "Droga przez las",
      lines: ["Wilki kręcą się przy wschodniej ścieżce.", "Trzymaj się drogi i nie lekceważ ran."],
      canHeal: false
    } : {
      npcId: npc.id,
      npcName: npc.name,
      kind: "healer",
      title: "Lecznica Ady",
      lines: ["Mogę opatrzyć cię i przywrócić siły.", "Ciężkie urazy pozostaną do czasu pełnego systemu leczenia."],
      canHeal: true
    });
  } catch (error) {
    socket.emit("commandRejected", {
      code: error instanceof Error ? error.message : "NPC_INTERACTION_REJECTED",
      message: "Podejdź bliżej, aby porozmawiać."
    });
  }
});
```

Heal handler:

```ts
socket.on("healAtNpc", ({ npcId }) => {
  if (!playerId) return;
  const npc = world.interactNpc(playerId, npcId);
  if (npc.kind !== "healer") return;
  characters.healHp(playerId);
  emitPlayerState(socket, playerId);
});
```

Wrap the heal handler in the same friendly rejection pattern as interaction.

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

- [ ] **Step 1: Add a full-flow test harness**

Extend test state to support two clients:

```ts
const clients: Socket[] = [];

async function connectClient(url: string): Promise<Socket> {
  const socket = createClient(url, { transports: ["websocket"], forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}
```

Close all clients in `afterEach`.

- [ ] **Step 2: Add victory/loot/world-return test**

Use the server service hook only to position the player near the encounter, not to alter battle outcome. Test skeleton:

```ts
const playerStatePromise = once<PlayerStateSnapshot>(client, "playerState");
const worldPromise = once<WorldStateSnapshot>(client, "worldState");
const login = await client.emitWithAck("login", { nickname: "Owczy" });
expect(login.ok).toBe(true);
await playerStatePromise;
await worldPromise;

if (!login.ok) throw new Error("login failed");
game.services.world.movePlayer(login.playerId, { x: 1320, y: 455 }, Date.now() + 10_000);

const battlePromise = once<BattleSnapshot>(client, "battleStarted");
client.emit("startEncounter", { encounterId: "wolf-pack-01" });
let battle = await battlePromise;

for (let turn = 0; turn < 40 && !battle.finished; turn += 1) {
  const hero = battle.combatants.find((c) => c.ownerPlayerId === login.playerId);
  const wolf = battle.combatants.find((c) => c.ownerPlayerId === undefined && c.hp > 0);
  if (!hero || !wolf) break;
  if (battle.activeCombatantId !== hero.id) throw new Error("NPC turn should be resolved server-side");

  const nextState = once<BattleSnapshot>(client, "battleState");
  client.emit("battleCommand", hero.ap >= 3 ? {
    type: "rangedAttack", combatantId: hero.id, targetId: wolf.id
  } : {
    type: "endTurn", combatantId: hero.id
  });
  battle = await nextState;
}
```

If deterministic blockers make ranged attacks invalid in this fixture, replace only the action chooser with a tested move/melee chooser; do not mutate battle internals from the integration test.

Await `battleEnded` and assert:

```ts
expect(ended.outcome).toBe("victory");
expect(ended.inventory.items.find((i) => i.itemId === "wolf-pelt")?.quantity).toBe(1);
expect(ended.inventory.items.find((i) => i.itemId === "field-bandage")?.quantity).toBe(2);
```

- [ ] **Step 3: Add defeat recovery coverage**

At service level, create a character, apply battle result `{ hp: 0, severelyInjured: true, injuries: ["chestWound"] }`, call `recoverAfterDefeat`, and assert:

```ts
expect(recovered.hp).toBe(25);
expect(recovered.severelyInjured).toBe(true);
expect(recovered.injuries).toEqual(["chestWound"]);
```

Keep socket-level coverage that a defeat emits `battleEnded.outcome === "defeat"` when a deterministic test setup reaches that state.

- [ ] **Step 4: Add two-client isolation coverage**

```ts
const owczy = await connectClient(url);
const karolina = await connectClient(url);
const a = await owczy.emitWithAck("login", { nickname: "Owczy" });
const b = await karolina.emitWithAck("login", { nickname: "Karolina" });
expect(a.ok && b.ok).toBe(true);
```

Collect a world snapshot containing both ids. Register `karolina.on("battleStarted", failHandler)`, start Owczy's battle, wait one tick, and assert failHandler was not called. After Owczy's `battleEnded`, assert a world snapshot contains both ids again.

- [ ] **Step 5: Verify**

```bash
npm run test -w @web-mmorpg/server -- socketFlow.test.ts characterService.test.ts
npm run test -w @web-mmorpg/server
npm run build -w @web-mmorpg/server
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/tests/socketFlow.test.ts apps/server/tests/characterService.test.ts
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
- `GameSocket` exposes request/state/interaction helpers.

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

- [ ] **Step 3: Implement store**

```ts
export class PlayerStateStore {
  private current: PlayerStateSnapshot | null = null;
  private readonly listeners = new Set<(state: PlayerStateSnapshot) => void>();

  get(): PlayerStateSnapshot | null { return this.current; }

  set(state: PlayerStateSnapshot): void {
    this.current = {
      character: { ...state.character, injuries: [...state.character.injuries] },
      inventory: { items: state.inventory.items.map((item) => ({ ...item })) }
    };
    for (const listener of this.listeners) listener(this.current);
  }

  subscribe(listener: (state: PlayerStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const playerStateStore = new PlayerStateStore();
```

- [ ] **Step 4: Extend `GameSocket` without creating extra connections**

```ts
requestPlayerState(): void { this.connect().emit("requestPlayerState"); }
requestWorldState(): void { this.connect().emit("requestWorldState"); }
interactNpc(npcId: string): void { this.connect().emit("interactNpc", { npcId }); }
healAtNpc(npcId: string): void { this.connect().emit("healAtNpc", { npcId }); }

onPlayerState(handler: (state: PlayerStateSnapshot) => void): () => void {
  const socket = this.connect();
  socket.on("playerState", handler);
  return () => socket.off("playerState", handler);
}

onNpcInteraction(handler: (payload: NpcInteractionPayload) => void): () => void {
  const socket = this.connect();
  socket.on("npcInteraction", handler);
  return () => socket.off("npcInteraction", handler);
}
```

Add equivalent unsubscribe wrappers for built-in `connect`, `disconnect`, and `connect_error`.

- [ ] **Step 5: Implement `WorldHud`**

Constructor:

```ts
constructor(handlers: { onInventory: () => void; onCharacter: () => void }) {
  this.root = document.createElement("div");
  this.root.className = "world-hud";
  this.root.innerHTML = `
    <div class="world-hud__identity" data-nickname></div>
    <div class="world-hud__bar"><span>HP</span><strong data-hp></strong></div>
    <div class="world-hud__bar"><span>AP</span><strong data-ap></strong></div>
    <div class="world-hud__connection" data-connection></div>
    <button data-inventory>Ekwipunek</button>
    <button data-character>Postać</button>
  `;
  document.body.appendChild(this.root);
  this.root.querySelector("[data-inventory]")!.addEventListener("click", handlers.onInventory);
  this.root.querySelector("[data-character]")!.addEventListener("click", handlers.onCharacter);
}
```

`update` sets nickname, `hp/maxHp`, and `maxAp`. `setConnectionState` maps to `Połączono`, `Ponowne łączenie…`, `Brak połączenia z serwerem`.

- [ ] **Step 6: Implement inventory and character panels**

Inventory item row template:

```ts
row.innerHTML = `
  <strong>${item.name}</strong>
  <span>x${item.quantity}</span>
  <small>${item.category === "medical" ? "Medyczne" : "Materiał"}</small>
  <p>${item.description}</p>
`;
```

Character injury labels:

```ts
const INJURY_LABELS: Record<InjuryKind, string> = {
  brokenArm: "Złamana ręka",
  legTrauma: "Uraz nogi",
  bleeding: "Krwawienie",
  concussion: "Wstrząśnienie",
  chestWound: "Rana klatki piersiowej",
  burn: "Oparzenie",
  poison: "Zatrucie"
};
```

Render nickname, level, HP, initiative, severe state, injury list, then:

```html
<section><h3>Specjalizacje</h3><p>Rozwój biegłości pojawi się w kolejnym etapie</p></section>
```

- [ ] **Step 7: Implement `DialoguePanel`**

```ts
show(payload: NpcInteractionPayload): void {
  this.title.textContent = `${payload.npcName} — ${payload.title}`;
  this.lines.innerHTML = payload.lines.map((line) => `<p>${line}</p>`).join("");
  this.healButton.hidden = !payload.canHeal;
  this.healButton.onclick = payload.canHeal ? () => this.onHeal(payload.npcId) : null;
  this.root.hidden = false;
}
```

Keep a close button and remove DOM on `destroy()`.

- [ ] **Step 8: Add responsive CSS**

At minimum:

```css
.world-hud button,
.game-panel button { min-width: 44px; min-height: 44px; }
.game-panel { position: fixed; inset: 50% auto auto 50%; transform: translate(-50%, -50%); }
@media (max-width: 600px) {
  .world-hud { left: 8px; right: 8px; top: max(8px, env(safe-area-inset-top)); }
  .game-panel { width: calc(100vw - 24px); max-height: 78vh; overflow: auto; }
}
```

Use the existing dark UI foundation but shift borders/background accents toward forest/wood tones.

- [ ] **Step 9: Verify and commit**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
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
- `FOREST_SETTLEMENT_LAYOUT` is pure/testable without Phaser.
- Renderer owns decoration; entity renderer owns players/NPCs/wolves; scene coordinates input/network/camera/UI.

- [ ] **Step 1: Write pure layout tests**

```ts
export const FOREST_SETTLEMENT_LAYOUT = {
  settlement: { x: 100, y: 160, width: 820, height: 570 },
  gate: { x: 930, y: 390, width: 70, height: 150 },
  forest: { x: 980, y: 0, width: 620, height: 900 }
} as const;
```

Test spawn `360,470` lies inside settlement and wolf `1320,455` lies inside forest using a pure `contains(rect, point)` helper.

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/client -- worldPresentation.test.ts
```

- [ ] **Step 3: Implement authored background renderer**

```ts
export class ForestSettlementRenderer {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  render(): void {
    this.objects.push(
      this.scene.add.rectangle(800, 450, 1600, 900, 0x274c2c).setDepth(-20),
      this.scene.add.ellipse(510, 455, 820, 570, 0x4f6b38).setDepth(-19),
      this.scene.add.rectangle(1130, 455, 520, 120, 0x7a6848).setDepth(-18)
    );

    this.addBuilding(420, 345, 210, 150);
    this.addBuilding(690, 555, 190, 135);
    for (const [x, y] of [[1030,120],[1120,180],[1240,110],[1450,170],[1510,300],[1180,760],[1400,720]]) {
      this.addTree(x, y);
    }
  }

  destroy(): void {
    for (const object of this.objects.splice(0)) object.destroy();
  }
}
```

`addBuilding` draws timber wall/roof rectangles; `addTree` draws trunk + layered foliage circles. Add fences/gate, bushes/rocks, and wolf clearing with fixed coordinate arrays. Remove old `this.add.grid(...)` from `WorldScene`.

- [ ] **Step 4: Implement readable entity renderer**

Store per-player containers:

```ts
interface PlayerView {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
}
```

Create player bodies from original shapes:

```ts
const body = scene.add.rectangle(0, 4, 18, 26, isLocal ? 0x6ea8d8 : 0xd7d2bd);
const head = scene.add.circle(0, -14, 8, 0xe0b998);
const facing = scene.add.triangle(0, 18, -4, 0, 4, 0, 0, 7, 0xe5d278);
const container = scene.add.container(player.x, player.y, [body, head, facing]);
```

NPCs use similar silhouettes with a guide/healer accent. Wolves use a dark low body, head, ears and tail shapes rather than circles.

Expose:

```ts
onNpcSelected?: (npcId: string) => void;
onEncounterSelected?: (encounterId: string) => void;
```

- [ ] **Step 5: Refactor `WorldScene` coordination**

Create members for renderers/HUD/panels/joystick-ready state. In `create()`:

```ts
this.background = new ForestSettlementRenderer(this);
this.background.render();
this.entities = new WorldEntitiesRenderer(this, this.playerId);
this.hud = new WorldHud({
  onInventory: () => this.inventoryPanel?.toggle(),
  onCharacter: () => this.characterPanel?.toggle()
});

this.entities.onNpcSelected = (npcId) => {
  this.pointerTarget = null;
  gameSocket.interactNpc(npcId);
};
this.entities.onEncounterSelected = (encounterId) => {
  this.pointerTarget = null;
  gameSocket.startEncounter(encounterId);
};

gameSocket.requestWorldState();
gameSocket.requestPlayerState();
```

On `playerState`, update `playerStateStore`, HUD, inventory, character panel. On `npcInteraction`, call `dialoguePanel.show(payload)`. Destroy all DOM/render subscriptions on scene shutdown.

- [ ] **Step 6: Smooth authoritative corrections**

Each entity view stores target coordinates. In scene update:

```ts
for (const view of this.entities.playerViews()) {
  view.container.x = Phaser.Math.Linear(view.container.x, view.targetX, 0.25);
  view.container.y = Phaser.Math.Linear(view.container.y, view.targetY, 0.25);
  view.label.setPosition(view.container.x, view.container.y - 34);
}
```

For local input, continue updating the visual/local predicted coordinate immediately, but each world snapshot updates its target so corrections converge rather than snap. Keep camera bounds `0,0,1600,900` and smooth follow.

- [ ] **Step 7: Verify and commit**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
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
expect(normalizeAnalogIntent({ x: 2, y: 2 }, 80)).toEqual({ dx: 0, dy: 0 });
```

Keep existing keyboard diagonal-speed and pointer overshoot tests.

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/client -- worldInput.test.ts
```

- [ ] **Step 3: Implement analog normalization**

```ts
export function normalizeAnalogIntent(
  offset: { x: number; y: number },
  radius: number
): { dx: number; dy: number } {
  const magnitude = Math.hypot(offset.x, offset.y);
  if (magnitude < 8 || radius <= 0) return { dx: 0, dy: 0 };
  const clamped = Math.min(magnitude, radius);
  const scale = clamped / magnitude / radius;
  return { dx: offset.x * scale, dy: offset.y * scale };
}
```

- [ ] **Step 4: Implement DOM joystick**

```ts
export class VirtualJoystick {
  private readonly root = document.createElement("div");
  private readonly thumb = document.createElement("div");
  private intent = { dx: 0, dy: 0 };

  constructor(private readonly radius = 56) {
    this.root.className = "virtual-joystick";
    this.thumb.className = "virtual-joystick__thumb";
    this.root.appendChild(this.thumb);
    document.body.appendChild(this.root);

    this.root.addEventListener("pointerdown", (event) => {
      this.root.setPointerCapture(event.pointerId);
      this.updateFromPointer(event);
      event.preventDefault();
    });
    this.root.addEventListener("pointermove", (event) => {
      if (this.root.hasPointerCapture(event.pointerId)) this.updateFromPointer(event);
    });
    const release = (event: PointerEvent) => {
      if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
      this.intent = { dx: 0, dy: 0 };
      this.thumb.style.transform = "translate(0px, 0px)";
    };
    this.root.addEventListener("pointerup", release);
    this.root.addEventListener("pointercancel", release);
  }

  getIntent() { return this.intent; }
  destroy() { this.root.remove(); }
}
```

`updateFromPointer` computes offset from root center, calls `normalizeAnalogIntent`, and moves thumb within radius.

CSS hides joystick on fine pointers:

```css
@media (hover: hover) and (pointer: fine) { .virtual-joystick { display: none; } }
```

- [ ] **Step 5: Integrate movement priority**

```ts
const keyboard = resolveKeyboardIntent(...);
const analog = this.joystick?.getIntent() ?? { dx: 0, dy: 0 };
const directional = keyboard.dx !== 0 || keyboard.dy !== 0 ? keyboard : analog;
const hasDirectional = directional.dx !== 0 || directional.dy !== 0;

if (hasDirectional) {
  this.pointerTarget = null;
  this.localPosition.x += directional.dx * travel;
  this.localPosition.y += directional.dy * travel;
} else if (this.pointerTarget) {
  this.localPosition = moveTowardTarget(this.localPosition, this.pointerTarget, travel);
}
```

Clamp to world bounds as before.

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

Build a synthetic snapshot with known cells/blocker/hero/wolf. Assert:

```ts
expect(reachableCells(snapshot, "hero").has("1,0")).toBe(false);
expect(attackPreview(snapshot, "hero", "wolf", "meleeAttack")).toMatchObject({
  valid: false,
  reason: "OUT_OF_RANGE",
  apCost: 2
});
```

Add ranged LOS and broken-arm AP assertions.

- [ ] **Step 2: Run RED**

```bash
npm run test -w @web-mmorpg/client -- battlePreview.test.ts
```

- [ ] **Step 3: Implement pure hex helpers**

```ts
const DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
];

const hexKey = ({ q, r }: HexCoord) => `${q},${r}`;
const hexNeighbors = ({ q, r }: HexCoord) => DIRECTIONS.map((d) => ({ q: q + d.q, r: r + d.r }));

function hexDistance(a: HexCoord, b: HexCoord): number {
  const as = -a.q - a.r;
  const bs = -b.q - b.r;
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(as - bs));
}
```

For LOS, mirror the server's cube interpolation approach: convert axial `(q,r)` to cube `(x=q,z=r,y=-x-z)`, lerp between endpoints for `distance` steps, cube-round each intermediate sample, convert back to axial, and fail if any intermediate key is blocked.

- [ ] **Step 4: Implement reachability**

```ts
export function reachableCells(snapshot: BattleSnapshot, combatantId: EntityId): Set<string> {
  const actor = snapshot.combatants.find((c) => c.id === combatantId);
  if (!actor) return new Set();
  const allowed = new Set(snapshot.cells.map(hexKey));
  const blocked = new Set(snapshot.blockedCells.map(hexKey));
  for (const combatant of snapshot.combatants) {
    if (combatant.id !== actor.id && combatant.hp > 0) blocked.add(hexKey(combatant.position));
  }

  const perStep = actor.injuries.includes("legTrauma") ? 2 : 1;
  const cost = new Map<string, number>([[hexKey(actor.position), 0]]);
  const queue = [actor.position];
  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i]!;
    const currentCost = cost.get(hexKey(current))!;
    for (const next of hexNeighbors(current)) {
      const key = hexKey(next);
      const nextCost = currentCost + perStep;
      if (!allowed.has(key) || blocked.has(key) || cost.has(key) || nextCost > actor.ap) continue;
      cost.set(key, nextCost);
      queue.push(next);
    }
  }
  cost.delete(hexKey(actor.position));
  return new Set(cost.keys());
}
```

- [ ] **Step 5: Implement attack preview**

```ts
export interface AttackPreviewResult {
  valid: boolean;
  reason?: "INSUFFICIENT_AP" | "OUT_OF_RANGE" | "NO_LINE_OF_SIGHT" | "INVALID_TARGET";
  apCost: number;
}
```

Melee: AP 2, exactly distance 1. Ranged: AP 3 or 4 with `brokenArm`, max distance 6, blockers `blockedCells`. Return `INVALID_TARGET` for same-side/down targets. Do not assign numeric cover bonuses.

- [ ] **Step 6: Restyle and wire `BattleScene`**

Set:

```ts
private actionMode: BattleActionMode = "move";
```

During render:

```ts
const reachable = activeOwned ? reachableCells(snapshot, activeOwned.id) : new Set<string>();
for (const cell of snapshot.cells) {
  const key = `${cell.q},${cell.r}`;
  if (reachable.has(key) && this.actionMode === "move") {
    graphics.fillStyle(0x6f9f62, 0.28);
    graphics.fillPoints(hexPolygon(x, y, HEX_SIZE - 2), true);
  }
}
```

Use forest floor background, tree/rock blockers, log/bush cover, active halo. Cell clicks send move only in `move` mode. Combatant clicks send selected attack mode only after `attackPreview(...).valid` is true; otherwise set HUD status from preview reason.

- [ ] **Step 7: Expand `BattleHud`**

Change to:

```ts
update(snapshot: BattleSnapshot, playerId: PlayerId, mode: BattleActionMode): void
```

Render round, active unit, HP/AP, injuries, and turn order:

```ts
const order = snapshot.turnOrder
  .map((id) => snapshot.combatants.find((c) => c.id === id)?.name)
  .filter(Boolean)
  .join(" → ");
this.turnOrderElement.textContent = order;
```

Buttons: `Ruch`, `Atak wręcz (2 AP)`, `Atak dystansowy (3/4 AP)`, `Koniec tury`, all >=44px.

- [ ] **Step 8: Map server rejections to friendly messages**

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

- [ ] **Step 1: Implement `LootSummary`**

```ts
export class LootSummary {
  private readonly root = document.createElement("div");

  constructor(private readonly onReturn: () => void) {
    this.root.className = "game-panel loot-summary";
    document.body.appendChild(this.root);
  }

  show(payload: {
    outcome: "victory" | "defeat";
    inventory: InventorySnapshot;
    character: CharacterSnapshot;
  }): void {
    const title = payload.outcome === "victory" ? "Zwycięstwo" : "Porażka — wracasz do osady";
    const injuryText = payload.character.injuries.length
      ? payload.character.injuries.join(", ")
      : "Brak nowych urazów";
    this.root.innerHTML = `
      <h2>${title}</h2>
      <p>Stan postaci: ${payload.character.hp}/${payload.character.maxHp} HP</p>
      <p>${injuryText}</p>
      <button type="button" data-return>Wróć do świata</button>
    `;
    this.root.querySelector<HTMLButtonElement>("[data-return]")!.onclick = this.onReturn;
  }

  destroy(): void { this.root.remove(); }
}
```

On victory, additionally render the current inventory entries or a derived list of newly awarded wolf items from the `battleEnded` payload. Since this slice has deterministic rewards, explicitly highlight `Wolf Pelt` and `Field Bandage` when present.

- [ ] **Step 2: Handle `battleEnded` in `BattleScene`**

```ts
this.unsubscribeEnded = gameSocket.onBattleEnded((payload) => {
  this.hud?.setDisabled(true);
  this.lootSummary?.destroy();
  this.lootSummary = new LootSummary(() => {
    this.lootSummary?.destroy();
    this.scene.start("WorldScene", { playerId: this.playerId });
  });
  this.lootSummary.show(payload);
});
```

Reuse the existing socket/session; do not reconnect or log in again.

- [ ] **Step 3: Refresh world/player state on world re-entry**

```ts
gameSocket.requestWorldState();
gameSocket.requestPlayerState();
```

Do not use `moveIntent` as a state request.

- [ ] **Step 4: Add connection feedback**

In `GameSocket`:

```ts
onConnectionState(handler: (state: "connected" | "connecting" | "disconnected") => void): () => void {
  const socket = this.connect();
  const connected = () => handler("connected");
  const disconnected = () => handler("connecting");
  const failed = () => handler("disconnected");
  socket.on("connect", connected);
  socket.on("disconnect", disconnected);
  socket.on("connect_error", failed);
  return () => {
    socket.off("connect", connected);
    socket.off("disconnect", disconnected);
    socket.off("connect_error", failed);
  };
}
```

Login form maps connection failure to `Could not connect to the game server.`; world HUD uses Polish connection labels.

- [ ] **Step 5: Ensure CI verifies all workspaces**

`feature-ci.yml` job steps include:

```yaml
- run: npm install
- run: npm run test
- run: npm run build
```

`pages.yml` keeps:

```yaml
- name: Build client
  env:
    VITE_GAME_SERVER_URL: https://web-mmorpg-server.onrender.com
  run: npm run build -w @web-mmorpg/client
```

and uploads `apps/client/dist`.

- [ ] **Step 6: Update README**

Document:

```md
## Public test
Client: https://owca217.github.io/WEB_MMORPG/
Server: https://web-mmorpg-server.onrender.com

The Render free instance may sleep when idle. Character/inventory progress is in-memory and resets when the server restarts.

MVP 2 contains one forest settlement, guide Boran, healer Ada, one wolf encounter, inventory, injuries, and tactical hex combat.
```

- [ ] **Step 7: Run full verification**

```bash
npm install
npm run test
npm run build
```

Expected: all workspaces PASS.

- [ ] **Step 8: Manual desktop acceptance**

Login; see settlement instead of grid; move with WASD/click; talk to Boran; use Ada; enter wolf fight; see AP/turn order/reachable cells/obstacles/cover; observe automatic wolf turn; win; see loot; return; open inventory and confirm rewards.

- [ ] **Step 9: Manual mobile acceptance**

Login; move by joystick and tap; open inventory/character; talk to NPC; complete battle with usable controls and no critical arena obstruction.

- [ ] **Step 10: Manual multiplayer acceptance**

Two different nicknames see each other; one enters personal battle without pulling the other in; after battle both appear together again.

- [ ] **Step 11: Commit**

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