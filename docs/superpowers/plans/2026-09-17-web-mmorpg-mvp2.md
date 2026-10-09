# WEB MMORPG MVP 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one polished browser-MMORPG vertical slice: forest settlement -> NPC interaction -> wolves -> tactical hex combat -> loot/injuries -> return to shared world.

**Architecture:** Keep the current TypeScript monorepo, Phaser client, and authoritative Node/Socket.IO server. Add small in-memory character state and richer shared contracts on the server side; keep scene files focused by moving client UI/render/input logic into dedicated helpers.

**Tech Stack:** TypeScript 5.9, Phaser 4.2.1, Socket.IO 4.8.3, Vite 8.2.2, Vitest 5.0.1, Node.js 22+ in CI.

**Spec:** `docs/superpowers/specs/2026-09-17-web-mmorpg-mvp2-design.md`

## Global Constraints

- No fixed classes; the game stays classless.
- GitHub Pages remains the browser host; Render remains the server host.
- Server stays authoritative for world position, encounter range, battle rules, AP, turns, LOS, damage, injuries, NPC turns, loot, inventory, and outcomes.
- Desktop: WASD/arrows + click-to-move. Mobile: tap-to-move + virtual joystick.
- Touch controls stay about 44 CSS px minimum.
- Use original/simple graphics or coherent placeholders; never copy commercial-game assets.
- In-memory persistence is enough for MVP 2; database accounts remain out of scope.
- Show cover visually, but do not invent numeric cover bonuses yet.
- Work only on `feature/mvp-vertical-slice`; merging to `main` requires separate approval.

## Target File Boundaries

- `packages/shared/src/character.ts` — `CharacterSnapshot`, `PlayerStateSnapshot`.
- `packages/shared/src/world.ts` — NPC/world contracts.
- `packages/shared/src/inventory.ts` — item metadata.
- `packages/shared/src/protocol.ts` — Socket.IO contracts.
- `apps/server/src/character/CharacterService.ts` — session character state.
- `apps/server/src/world/worldFixtures.ts` — authored settlement data.
- `apps/server/src/world/WorldService.ts` — authoritative world/range checks.
- `apps/server/src/battle/NpcBattleAi.ts` — wolf decisions.
- `apps/server/src/battle/BattleService.ts` — battle orchestration.
- `apps/server/src/server/createGameServer.ts` — socket/service wiring only.
- `apps/client/src/state/PlayerStateStore.ts` — latest player state.
- `apps/client/src/world/*` — settlement layout/render/entities.
- `apps/client/src/input/VirtualJoystick.ts` — touch analog input.
- `apps/client/src/ui/*` — HUDs/panels/results.
- `apps/client/src/battle/BattlePreview.ts` — pure preview calculations.
- `apps/client/src/scenes/WorldScene.ts`, `BattleScene.ts` — orchestration.

---

### Task 1: Automatic Server-Controlled Wolf Turns

**Files:**
- Create: `apps/server/src/battle/NpcBattleAi.ts`
- Create: `apps/server/tests/npcBattleAi.test.ts`
- Modify: `apps/server/src/battle/BattleService.ts`
- Modify: `apps/server/tests/battleService.test.ts`

**Interfaces:**
- Produces `chooseWolfCommand(state: BattleState, wolfId: string): BattleCommand`.

- [ ] **Step 1: Add RED AI tests**

Create synthetic `BattleState` fixtures. Adjacent wolf:

```ts
expect(chooseWolfCommand(adjacentState, "wolf")).toEqual({
  type: "meleeAttack",
  combatantId: "wolf",
  targetId: "hero"
});
```

Separated wolf:

```ts
expect(chooseWolfCommand(separatedState, "wolf")).toMatchObject({
  type: "move",
  combatantId: "wolf"
});
```

Keep the existing `battleService.test.ts` assertion that after the hero ends turn, control returns to the hero.

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w @web-mmorpg/server -- npcBattleAi.test.ts battleService.test.ts
```

- [ ] **Step 3: Implement wolf decision logic**

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

- [ ] **Step 4: Drain NPC turns in `BattleService`**

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

After a successful player command:

```ts
active.state = this.runNpcTurns(result.state);
```

- [ ] **Step 5: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- npcBattleAi.test.ts battleService.test.ts battleEngine.test.ts socketFlow.test.ts
npm run build -w @web-mmorpg/server
git add apps/server/src/battle apps/server/tests/npcBattleAi.test.ts apps/server/tests/battleService.test.ts
git commit -m "feat: run wolf npc turns automatically"
```

---

### Task 2: Character State, Inventory Metadata, and Player-State Protocol

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
- Produces `CharacterSnapshot`, `PlayerStateSnapshot`, enriched `InventoryItem`.
- Adds `requestPlayerState`, `requestWorldState`, `playerState` protocol events.

- [ ] **Step 1: Add RED character tests**

```ts
it("creates stable base stats", () => {
  const service = new CharacterService();
  expect(service.createPlayer("p1", "Owczy")).toMatchObject({
    playerId: "p1", nickname: "Owczy", level: 1,
    hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
    severelyInjured: false, injuries: []
  });
});

it("heals HP without clearing injuries", () => {
  const service = new CharacterService();
  service.createPlayer("p1", "Owczy");
  service.applyBattleResult("p1", { hp: 0, severelyInjured: true, injuries: ["legTrauma"] });
  expect(service.healHp("p1")).toMatchObject({
    hp: 100, severelyInjured: true, injuries: ["legTrauma"]
  });
});
```

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w @web-mmorpg/server -- characterService.test.ts
```

- [ ] **Step 3: Add exact shared types**

```ts
// packages/shared/src/character.ts
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

```ts
// packages/shared/src/inventory.ts
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
    const value: CharacterSnapshot = {
      playerId, nickname, level: 1,
      hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
      severelyInjured: false, injuries: []
    };
    this.characters.set(playerId, value);
    return this.clone(value);
  }

  getSnapshot(playerId: PlayerId): CharacterSnapshot | undefined {
    const value = this.characters.get(playerId);
    return value ? this.clone(value) : undefined;
  }

  applyBattleResult(playerId: PlayerId, result: Pick<CharacterSnapshot, "hp" | "severelyInjured" | "injuries">): CharacterSnapshot {
    const value = this.require(playerId);
    value.hp = result.hp;
    value.severelyInjured = result.severelyInjured;
    value.injuries = [...result.injuries];
    return this.clone(value);
  }

  recoverAfterDefeat(playerId: PlayerId): CharacterSnapshot {
    const value = this.require(playerId);
    value.hp = Math.max(1, Math.ceil(value.maxHp * 0.25));
    return this.clone(value);
  }

  healHp(playerId: PlayerId): CharacterSnapshot {
    const value = this.require(playerId);
    value.hp = value.maxHp;
    return this.clone(value);
  }

  removePlayer(playerId: PlayerId): void { this.characters.delete(playerId); }

  private require(playerId: PlayerId): CharacterSnapshot {
    const value = this.characters.get(playerId);
    if (!value) throw new Error("CHARACTER_NOT_FOUND");
    return value;
  }

  private clone(value: CharacterSnapshot): CharacterSnapshot {
    return { ...value, injuries: [...value.injuries] };
  }
}
```

- [ ] **Step 5: Enrich wolf loot and clean session inventory**

```ts
return [
  {
    itemId: "wolf-pelt", name: "Wolf Pelt", quantity: 1,
    category: "material", description: "A rough pelt taken from a forest wolf."
  },
  {
    itemId: "field-bandage", name: "Field Bandage", quantity: 2,
    category: "medical", description: "A simple bandage for field treatment."
  }
];
```

Add:

```ts
removePlayer(playerId: PlayerId): void {
  this.inventories.delete(playerId);
}
```

- [ ] **Step 6: Add protocol events**

```ts
// ClientToServerEvents
requestPlayerState: () => void;
requestWorldState: () => void;
```

```ts
// ServerToClientEvents
playerState: (snapshot: PlayerStateSnapshot) => void;
```

- [ ] **Step 7: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- characterService.test.ts worldService.test.ts
npm run build
git add packages/shared apps/server/src/character apps/server/src/inventory apps/server/src/loot apps/server/tests/characterService.test.ts
git commit -m "feat: add session character state"
```

---

### Task 3: Forest Settlement Fixture and NPC Range Rules

**Files:**
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/server/src/world/worldFixtures.ts`
- Modify: `apps/server/src/world/WorldService.ts`
- Modify: `apps/server/src/session/SessionStore.ts`
- Modify: `apps/server/tests/worldService.test.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- Produces `NpcSnapshot`, `NpcInteractionPayload`, `WorldService.interactNpc`, `resetPlayerToSpawn`.

- [ ] **Step 1: Add RED world tests**

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

Change expected login location to `forest-settlement-01`.

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w @web-mmorpg/server -- worldService.test.ts socketFlow.test.ts
```

- [ ] **Step 3: Add NPC/world contracts**

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

Protocol:

```ts
interactNpc: (payload: { npcId: string }) => void;
healAtNpc: (payload: { npcId: string }) => void;
npcInteraction: (payload: NpcInteractionPayload) => void;
```

- [ ] **Step 4: Replace meadow fixture**

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

Extend `WorldFixture` with `npcs`. Keep encounter radius `90` and max speed `220`.

- [ ] **Step 5: Implement authoritative NPC/range/spawn logic**

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

Use `FOREST_SETTLEMENT_01` in movement, encounter lookup, and snapshots.

- [ ] **Step 6: Update session/test constants**

```ts
const locationId: LocationId = "forest-settlement-01";
```

Move socket-test player near `{ x: 1320, y: 455 }` before starting wolves.

- [ ] **Step 7: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- worldService.test.ts socketFlow.test.ts
npm run build -w @web-mmorpg/server
git add packages/shared/src/world.ts packages/shared/src/protocol.ts apps/server/src/world apps/server/src/session/SessionStore.ts apps/server/tests/worldService.test.ts apps/server/tests/socketFlow.test.ts
git commit -m "feat: add forest settlement and npcs"
```

---

### Task 4: Persist Battle Outcome and Wire Server State

**Files:**
- Modify: `apps/server/src/battle/BattleService.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/server/tests/battleService.test.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- `startBattle(character: CharacterSnapshot, encounterId: string): BattleSnapshot`.
- `battleEnded` returns outcome, inventory, character.

- [ ] **Step 1: Add RED battle-state persistence assertions**

```ts
const character: CharacterSnapshot = {
  playerId: "p1", nickname: "Owczy", level: 1,
  hp: 73, maxHp: 100, maxAp: 5, initiative: 10,
  severelyInjured: true, injuries: ["legTrauma"]
};
const snapshot = service.startBattle(character, "wolf-pack-01");
expect(snapshot.combatants.find((c) => c.ownerPlayerId === "p1")).toMatchObject({
  hp: 73,
  severelyInjured: true,
  injuries: ["legTrauma"]
});
```

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w @web-mmorpg/server -- battleService.test.ts socketFlow.test.ts
```

- [ ] **Step 3: Build hero from `CharacterSnapshot` and expose outcome**

```ts
startBattle(character: CharacterSnapshot, encounterId: string): BattleSnapshot
```

Hero combatant:

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

Extend result:

```ts
playerOutcome?: {
  hp: number;
  severelyInjured: boolean;
  injuries: InjuryKind[];
};
```

- [ ] **Step 4: Define battle-end payload**

```ts
battleEnded: (payload: {
  outcome: "victory" | "defeat";
  inventory: InventorySnapshot;
  character: CharacterSnapshot;
}) => void;
```

- [ ] **Step 5: Wire `createGameServer` lifecycle**

Inside each connection, define a closure instead of a new socket type:

```ts
const emitPlayerState = (targetPlayerId: PlayerId): void => {
  const character = characters.getSnapshot(targetPlayerId);
  if (!character) return;
  socket.emit("playerState", {
    character,
    inventory: inventory.getSnapshot(targetPlayerId)
  });
};
```

Login:

```ts
const character = characters.createPlayer(result.playerId, session?.nickname ?? nickname.trim());
world.addPlayer({ id: result.playerId, nickname: character.nickname });
socket.join(`location:${result.locationId}`);
ack(result);
emitPlayerState(result.playerId);
io.to(`location:${result.locationId}`).emit("worldState", world.snapshot(result.locationId));
```

Snapshot handlers:

```ts
socket.on("requestPlayerState", () => {
  if (playerId) emitPlayerState(playerId);
});

socket.on("requestWorldState", () => {
  if (!playerId) return;
  const session = sessions.get(playerId);
  if (session) socket.emit("worldState", world.snapshot(session.locationId));
});
```

Encounter start:

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

const characterAfter = characters.getSnapshot(playerId)!;
const inventoryAfter = inventory.getSnapshot(playerId);
emitPlayerState(playerId);
socket.emit("battleEnded", {
  outcome: applied.victory ? "victory" : "defeat",
  inventory: inventoryAfter,
  character: characterAfter
});
battles.removeBattleForPlayer(playerId);
socket.join("location:forest-settlement-01");
io.to("location:forest-settlement-01").emit("worldState", world.snapshot("forest-settlement-01"));
```

On disconnect remove battle, world player, session, character, inventory.

- [ ] **Step 6: Wire Boran/Ada interactions**

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

socket.on("healAtNpc", ({ npcId }) => {
  if (!playerId) return;
  try {
    const npc = world.interactNpc(playerId, npcId);
    if (npc.kind !== "healer") throw new Error("NPC_NOT_HEALER");
    characters.healHp(playerId);
    emitPlayerState(playerId);
  } catch (error) {
    socket.emit("commandRejected", {
      code: error instanceof Error ? error.message : "HEAL_REJECTED",
      message: "Nie można teraz skorzystać z leczenia."
    });
  }
});
```

- [ ] **Step 7: Verify and commit**

```bash
npm run test -w @web-mmorpg/server
npm run build -w @web-mmorpg/server
git add packages/shared/src/protocol.ts apps/server/src apps/server/tests
git commit -m "feat: persist battle and npc state"
```

---

### Task 5: End-to-End Socket Tests

**Files:**
- Modify: `apps/server/tests/socketFlow.test.ts`
- Modify: `apps/server/tests/characterService.test.ts`

**Interfaces:**
- Locks login -> player/world -> battle -> NPC turns -> battle end -> loot -> world return and multi-client isolation.

- [ ] **Step 1: Support multiple test clients**

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

Disconnect every entry in `afterEach`.

- [ ] **Step 2: Add deterministic player-command chooser for the integration test**

Import `findPath`, `hexDistance`, `hexKey`, `hexNeighbors`, `hasLineOfSight`, plus `BattleCommand`.

```ts
function choosePlayerCommand(battle: BattleSnapshot, playerId: string): BattleCommand {
  const hero = battle.combatants.find((c) => c.ownerPlayerId === playerId && c.hp > 0);
  const wolf = battle.combatants.find((c) => c.ownerPlayerId === undefined && c.hp > 0);
  if (!hero || !wolf) throw new Error("Expected living hero and wolf");

  const distance = hexDistance(hero.position, wolf.position);
  if (distance === 1 && hero.ap >= 2) {
    return { type: "meleeAttack", combatantId: hero.id, targetId: wolf.id };
  }

  const blockers = new Set(battle.blockedCells.map(hexKey));
  if (hero.ap >= 3 && distance <= 6 && hasLineOfSight(hero.position, wolf.position, blockers)) {
    return { type: "rangedAttack", combatantId: hero.id, targetId: wolf.id };
  }

  const allowed = new Set(battle.cells.map(hexKey));
  for (const combatant of battle.combatants) {
    if (combatant.id !== hero.id && combatant.hp > 0) blockers.add(hexKey(combatant.position));
  }

  for (const goal of hexNeighbors(wolf.position).filter((cell) => allowed.has(hexKey(cell)) && !blockers.has(hexKey(cell)))) {
    const path = findPath(hero.position, goal, blockers, allowed);
    if (path?.length && hero.ap >= 1) {
      return { type: "move", combatantId: hero.id, target: path[0]! };
    }
  }

  return { type: "endTurn", combatantId: hero.id };
}
```

- [ ] **Step 3: Add victory/loot/return test**

```ts
const initialPlayerState = once<PlayerStateSnapshot>(client, "playerState");
const initialWorld = once<WorldStateSnapshot>(client, "worldState");
const login = await client.emitWithAck("login", { nickname: "Owczy" });
if (!login.ok) throw new Error("login failed");
await initialPlayerState;
await initialWorld;

game.services.world.movePlayer(login.playerId, { x: 1320, y: 455 }, Date.now() + 10_000);
const battlePromise = once<BattleSnapshot>(client, "battleStarted");
client.emit("startEncounter", { encounterId: "wolf-pack-01" });
let battle = await battlePromise;

const endedPromise = once<BattleEndedPayload>(client, "battleEnded");
for (let turn = 0; turn < 40 && !battle.finished; turn += 1) {
  const next = once<BattleSnapshot>(client, "battleState");
  client.emit("battleCommand", choosePlayerCommand(battle, login.playerId));
  battle = await next;
}
const ended = await endedPromise;
expect(ended.outcome).toBe("victory");
expect(ended.inventory.items.find((i) => i.itemId === "wolf-pelt")?.quantity).toBe(1);
expect(ended.inventory.items.find((i) => i.itemId === "field-bandage")?.quantity).toBe(2);
```

Define `BattleEndedPayload` in the test as the exact payload shape from `ServerToClientEvents` if it is not separately exported.

- [ ] **Step 4: Add defeat recovery test**

```ts
service.createPlayer("p1", "Owczy");
service.applyBattleResult("p1", {
  hp: 0,
  severelyInjured: true,
  injuries: ["chestWound"]
});
const recovered = service.recoverAfterDefeat("p1");
expect(recovered.hp).toBe(25);
expect(recovered.severelyInjured).toBe(true);
expect(recovered.injuries).toEqual(["chestWound"]);
```

- [ ] **Step 5: Add two-client isolation test**

```ts
const owczy = await connectClient(url);
const karolina = await connectClient(url);
const a = await owczy.emitWithAck("login", { nickname: "Owczy" });
const b = await karolina.emitWithAck("login", { nickname: "Karolina" });
expect(a.ok && b.ok).toBe(true);

let karolinaBattleStarted = false;
karolina.on("battleStarted", () => { karolinaBattleStarted = true; });
```

Wait for a shared world snapshot containing both ids. Start only Owczy's encounter, wait for Owczy's `battleStarted`, then:

```ts
expect(karolinaBattleStarted).toBe(false);
```

After Owczy returns, assert a new world snapshot contains both ids.

- [ ] **Step 6: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- socketFlow.test.ts characterService.test.ts
npm run test -w @web-mmorpg/server
npm run build -w @web-mmorpg/server
git add apps/server/tests/socketFlow.test.ts apps/server/tests/characterService.test.ts
git commit -m "test: cover complete mvp2 socket loop"
```

---

### Task 6: Client State, World HUD, Inventory, Character, Dialogue

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
- `PlayerStateStore.get()`, `set()`, `subscribe()`.
- `GameSocket`: `requestPlayerState`, `requestWorldState`, `interactNpc`, `healAtNpc`, state/interaction subscriptions.

- [ ] **Step 1: Add RED store test**

```ts
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
```

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w @web-mmorpg/client -- playerStateStore.test.ts
```

- [ ] **Step 3: Implement state store**

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

- [ ] **Step 4: Extend `GameSocket`**

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

Keep one Socket.IO instance.

- [ ] **Step 5: Implement `WorldHud`**

```ts
constructor(handlers: { onInventory: () => void; onCharacter: () => void }) {
  this.root = document.createElement("div");
  this.root.className = "world-hud";
  this.root.innerHTML = `
    <div data-nickname></div>
    <div>HP <strong data-hp></strong></div>
    <div>AP <strong data-ap></strong></div>
    <div data-connection></div>
    <button data-inventory>Ekwipunek</button>
    <button data-character>Postać</button>
  `;
  document.body.appendChild(this.root);
  this.root.querySelector<HTMLButtonElement>("[data-inventory]")!.onclick = handlers.onInventory;
  this.root.querySelector<HTMLButtonElement>("[data-character]")!.onclick = handlers.onCharacter;
}
```

`update` writes nickname, `hp/maxHp`, `maxAp`; `setConnectionState` maps to Polish labels.

- [ ] **Step 6: Implement inventory/character/dialogue panels**

Inventory row:

```ts
row.innerHTML = `<strong>${item.name}</strong><span>x${item.quantity}</span><small>${item.category}</small><p>${item.description}</p>`;
```

Injury labels:

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

Character panel renders nickname, level, HP, initiative, severe state, injuries, then:

```html
<section><h3>Specjalizacje</h3><p>Rozwój biegłości pojawi się w kolejnym etapie</p></section>
```

Dialogue panel:

```ts
show(payload: NpcInteractionPayload): void {
  this.title.textContent = `${payload.npcName} — ${payload.title}`;
  this.lines.replaceChildren(...payload.lines.map((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    return p;
  }));
  this.healButton.hidden = !payload.canHeal;
  this.healButton.onclick = payload.canHeal ? () => this.onHeal(payload.npcId) : null;
  this.root.hidden = false;
}
```

Use `textContent`/DOM nodes for dynamic text rather than injecting user-derived strings into `innerHTML`.

- [ ] **Step 7: Add responsive CSS**

```css
.world-hud button,
.game-panel button { min-width: 44px; min-height: 44px; }
.game-panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); }
@media (max-width: 600px) {
  .world-hud { left: 8px; right: 8px; top: max(8px, env(safe-area-inset-top)); }
  .game-panel { width: calc(100vw - 24px); max-height: 78vh; overflow: auto; }
}
```

- [ ] **Step 8: Verify and commit**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
git add apps/client/src/state apps/client/src/net/GameSocket.ts apps/client/src/ui apps/client/tests/playerStateStore.test.ts apps/client/src/style.css
git commit -m "feat: add world hud and player panels"
```

---

### Task 7: Forest Settlement World Presentation

**Files:**
- Create: `apps/client/src/world/ForestSettlementLayout.ts`
- Create: `apps/client/src/world/ForestSettlementRenderer.ts`
- Create: `apps/client/src/world/WorldEntitiesRenderer.ts`
- Create: `apps/client/tests/worldPresentation.test.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`

**Interfaces:**
- Pure layout constants; renderer owns decorations; entity renderer owns world actors.

- [ ] **Step 1: Add RED layout tests**

```ts
export const FOREST_SETTLEMENT_LAYOUT = {
  settlement: { x: 100, y: 160, width: 820, height: 570 },
  gate: { x: 930, y: 390, width: 70, height: 150 },
  forest: { x: 980, y: 0, width: 620, height: 900 }
} as const;
```

Test `{360,470}` is inside settlement and `{1320,455}` inside forest via a pure `contains` helper.

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w @web-mmorpg/client -- worldPresentation.test.ts
```

- [ ] **Step 3: Implement authored background**

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
    for (const [x, y] of [[1030,120],[1120,180],[1240,110],[1450,170],[1510,300],[1180,760],[1400,720]] as const) {
      this.addTree(x, y);
    }
  }

  destroy(): void {
    for (const object of this.objects.splice(0)) object.destroy();
  }
}
```

`addBuilding`: timber wall rectangle + darker roof polygon. `addTree`: trunk rectangle + 2-3 foliage circles. Add fixed-coordinate fences, rocks, bushes, gate and wolf clearing. Remove the old debug grid.

- [ ] **Step 4: Implement entity renderer**

```ts
interface PlayerView {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
}
```

Player placeholder:

```ts
const body = scene.add.rectangle(0, 4, 18, 26, isLocal ? 0x6ea8d8 : 0xd7d2bd);
const head = scene.add.circle(0, -14, 8, 0xe0b998);
const facing = scene.add.triangle(0, 18, -4, 0, 4, 0, 0, 7, 0xe5d278);
const container = scene.add.container(player.x, player.y, [body, head, facing]);
```

NPCs use similar silhouettes with guide/healer accents. Wolves use shape groups with low body/head/ears/tail. Expose:

```ts
onNpcSelected?: (npcId: string) => void;
onEncounterSelected?: (encounterId: string) => void;
playerViews(): Iterable<PlayerView>;
```

- [ ] **Step 5: Refactor `WorldScene` orchestration**

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

On `playerState`: update store + HUD + panels. On `npcInteraction`: show dialogue. Destroy all subscriptions/renderers/panels on scene shutdown.

- [ ] **Step 6: Smooth corrections and camera**

```ts
for (const view of this.entities.playerViews()) {
  view.container.x = Phaser.Math.Linear(view.container.x, view.targetX, 0.25);
  view.container.y = Phaser.Math.Linear(view.container.y, view.targetY, 0.25);
  view.label.setPosition(view.container.x, view.container.y - 34);
}
```

Local input still updates prediction immediately; authoritative snapshots update targets. Camera bounds stay `1600x900`, follow local actor smoothly.

- [ ] **Step 7: Verify and commit**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
git add apps/client/src/world apps/client/src/scenes/WorldScene.ts apps/client/tests/worldPresentation.test.ts
git commit -m "feat: render forest settlement world"
```

---

### Task 8: Mobile Virtual Joystick + Tap-to-Move

**Files:**
- Create: `apps/client/src/input/VirtualJoystick.ts`
- Modify: `apps/client/src/input/WorldInput.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/tests/worldInput.test.ts`
- Modify: `apps/client/src/style.css`

**Interfaces:**
- `normalizeAnalogIntent(offset, radius)` and `VirtualJoystick.getIntent()`.

- [ ] **Step 1: Add RED analog tests**

```ts
expect(normalizeAnalogIntent({ x: 50, y: 0 }, 80)).toEqual({ dx: 0.625, dy: 0 });
const diagonal = normalizeAnalogIntent({ x: 100, y: 100 }, 80);
expect(Math.hypot(diagonal.dx, diagonal.dy)).toBeLessThanOrEqual(1);
expect(normalizeAnalogIntent({ x: 2, y: 2 }, 80)).toEqual({ dx: 0, dy: 0 });
```

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w @web-mmorpg/client -- worldInput.test.ts
```

- [ ] **Step 3: Implement analog normalization**

```ts
export function normalizeAnalogIntent(offset: { x: number; y: number }, radius: number) {
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
  }

  getIntent() { return this.intent; }
  destroy() { this.root.remove(); }
}
```

Add pointerdown/move/up/cancel with pointer capture. Compute offset from root center, call `normalizeAnalogIntent`, clamp thumb to radius, reset on release. CSS:

```css
@media (hover: hover) and (pointer: fine) { .virtual-joystick { display: none; } }
```

- [ ] **Step 5: Integrate priority**

```ts
const keyboard = resolveKeyboardIntent(...);
const analog = this.joystick?.getIntent() ?? { dx: 0, dy: 0 };
const directional = keyboard.dx !== 0 || keyboard.dy !== 0 ? keyboard : analog;
if (directional.dx !== 0 || directional.dy !== 0) {
  this.pointerTarget = null;
  this.localPosition.x += directional.dx * travel;
  this.localPosition.y += directional.dy * travel;
} else if (this.pointerTarget) {
  this.localPosition = moveTowardTarget(this.localPosition, this.pointerTarget, travel);
}
```

Clamp bounds and preserve existing 50ms intent send cadence.

- [ ] **Step 6: Verify and commit**

```bash
npm run test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
git add apps/client/src/input apps/client/src/scenes/WorldScene.ts apps/client/tests/worldInput.test.ts apps/client/src/style.css
git commit -m "feat: add mobile world joystick"
```

---

### Task 9: Tactical Battle UX Overhaul

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

- [ ] **Step 1: Add RED preview tests**

```ts
expect(reachableCells(snapshot, "hero").has("1,0")).toBe(false);
expect(attackPreview(snapshot, "hero", "wolf", "meleeAttack")).toMatchObject({
  valid: false,
  reason: "OUT_OF_RANGE",
  apCost: 2
});
```

Also cover ranged max distance 6, blocked LOS, and `brokenArm` -> 4 AP.

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w @web-mmorpg/client -- battlePreview.test.ts
```

- [ ] **Step 3: Implement client hex helpers**

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

Mirror server LOS: axial -> cube, lerp `distance` samples, cube-round each intermediate cube, convert to axial, reject if any intermediate cell is in blockers.

- [ ] **Step 4: Implement reachability**

```ts
export function reachableCells(snapshot: BattleSnapshot, combatantId: EntityId): Set<string> {
  const actor = snapshot.combatants.find((c) => c.id === combatantId);
  if (!actor) return new Set();
  const allowed = new Set(snapshot.cells.map(hexKey));
  const blocked = new Set(snapshot.blockedCells.map(hexKey));
  for (const c of snapshot.combatants) {
    if (c.id !== actor.id && c.hp > 0) blocked.add(hexKey(c.position));
  }
  const perStep = actor.injuries.includes("legTrauma") ? 2 : 1;
  const cost = new Map<string, number>([[hexKey(actor.position), 0]]);
  const queue = [actor.position];
  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i]!;
    for (const next of hexNeighbors(current)) {
      const key = hexKey(next);
      const nextCost = cost.get(hexKey(current))! + perStep;
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

Melee: cost 2, distance exactly 1. Ranged: cost 3 or 4 with `brokenArm`, max range 6, LOS blockers = `blockedCells`. Same-side/down targets -> `INVALID_TARGET`.

- [ ] **Step 6: Wire forest battle presentation and explicit action mode**

```ts
private actionMode: BattleActionMode = "move";
```

During cell render:

```ts
const reachable = activeOwned ? reachableCells(snapshot, activeOwned.id) : new Set<string>();
if (this.actionMode === "move" && reachable.has(key)) {
  graphics.fillStyle(0x6f9f62, 0.28);
  graphics.fillPoints(hexPolygon(x, y, HEX_SIZE - 2), true);
}
```

Use forest-floor background, stylized tree/rock blockers, log/bush cover, active halo. Cell click moves only in `move`; combatant click attacks only in selected attack mode after `attackPreview` returns valid.

- [ ] **Step 7: Expand `BattleHud`**

```ts
update(snapshot: BattleSnapshot, playerId: PlayerId, mode: BattleActionMode): void
```

Turn order:

```ts
this.turnOrderElement.textContent = snapshot.turnOrder
  .map((id) => snapshot.combatants.find((c) => c.id === id)?.name)
  .filter((name): name is string => Boolean(name))
  .join(" → ");
```

Show round, active unit, HP/AP, injuries and buttons `Ruch`, `Atak wręcz (2 AP)`, `Atak dystansowy (3/4 AP)`, `Koniec tury`.

- [ ] **Step 8: Friendly error mapping**

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

### Task 10: Battle Result, Re-entry, CI, Deployment, Acceptance

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
- Completes world -> battle -> result -> world and public deployment verification.

- [ ] **Step 1: Implement result panel safely**

```ts
export class LootSummary {
  private readonly root = document.createElement("div");
  constructor(private readonly onReturn: () => void) {
    this.root.className = "game-panel loot-summary";
    document.body.appendChild(this.root);
  }

  show(payload: BattleEndedPayload): void {
    this.root.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = payload.outcome === "victory" ? "Zwycięstwo" : "Porażka — wracasz do osady";
    const hp = document.createElement("p");
    hp.textContent = `Stan postaci: ${payload.character.hp}/${payload.character.maxHp} HP`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Wróć do świata";
    button.onclick = this.onReturn;
    this.root.append(title, hp, button);
  }

  destroy(): void { this.root.remove(); }
}
```

On victory, append rows for `wolf-pelt` and `field-bandage` if present in payload inventory. On defeat, append severe/injury text from payload character.

- [ ] **Step 2: Handle `battleEnded` and re-enter world**

```ts
this.unsubscribeEnded = gameSocket.onBattleEnded((payload) => {
  this.lootSummary?.destroy();
  this.lootSummary = new LootSummary(() => {
    this.lootSummary?.destroy();
    this.scene.start("WorldScene", { playerId: this.playerId });
  });
  this.lootSummary.show(payload);
});
```

`WorldScene.create()` requests fresh state:

```ts
gameSocket.requestWorldState();
gameSocket.requestPlayerState();
```

- [ ] **Step 3: Add connection-state subscription**

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

Login keeps its current friendly connection error; world HUD maps to `Połączono`, `Ponowne łączenie…`, `Brak połączenia z serwerem`.

- [ ] **Step 4: Ensure CI checks everything**

`feature-ci.yml` includes:

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

- [ ] **Step 5: Update README**

```md
## Public test
Client: https://owca217.github.io/WEB_MMORPG/
Server: https://web-mmorpg-server.onrender.com

The Render free instance may sleep when idle. Character/inventory progress is in-memory and resets when the server restarts.

MVP 2 contains one forest settlement, guide Boran, healer Ada, one wolf encounter, inventory, injuries, and tactical hex combat.
```

- [ ] **Step 6: Run full verification**

```bash
npm install
npm run test
npm run build
```

Expected: all workspaces PASS.

- [ ] **Step 7: Manual desktop acceptance**

Login; see settlement instead of grid; move with WASD/click; talk to Boran; use Ada; enter wolf fight; see AP/turn order/reachable cells/obstacles/cover; observe automatic wolf turn; win; see loot; return; open inventory and confirm rewards.

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