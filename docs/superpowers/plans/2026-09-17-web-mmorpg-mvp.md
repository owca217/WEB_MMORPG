# WEB MMORPG MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first playable browser-MMORPG vertical slice: session login, one shared 2D location, authoritative multiplayer movement, encounter entry, tactical hex battle with AP/initiative/cover, injuries, loot, inventory, and return to the world.

**Architecture:** Use an npm-workspaces monorepo with a Phaser/Vite browser client, a Node.js/Socket.IO authoritative server, and a framework-independent shared TypeScript package for protocol and domain contracts. World and battle rules remain pure TypeScript modules behind explicit interfaces; Socket.IO and Phaser only adapt those rules for networking and rendering.

**Tech Stack:** TypeScript, Phaser 4.2.1, Vite 8.2.2, Node.js, Socket.IO 4.8.3, Vitest 5.0.1, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-17-web-mmorpg-mvp-design.md`

## Global Constraints

- Browser client must work on desktop and mobile.
- Client supports click/tap-to-move, WASD, and touch controls.
- Server is authoritative for movement, battle state, AP, initiative, damage, injuries, loot, and encounter resolution.
- World is split into explicit locations; MVP ships one location.
- Combat is turn based on a hex grid with AP and initiative.
- Arena size and obstacle layout come from an encounter profile plus deterministic seed.
- Obstacles can block movement and ranged line of sight and can provide cover.
- Dropping to 0 HP can apply a severe-injury state plus specific injuries.
- Character progression is classless; MVP only proves the data model, not the full progression system.
- Client build must be deployable to GitHub Pages.
- Server URL must be runtime-configurable through Vite environment configuration.
- Persistent production accounts are out of scope for this vertical slice; MVP login is an ephemeral nickname-based session backed by in-memory repositories.

---

# File Structure

```text
WEB_MMORPG/
├─ package.json
├─ tsconfig.base.json
├─ .gitignore
├─ .github/
│  └─ workflows/
│     ├─ ci.yml
│     └─ pages.yml
├─ apps/
│  ├─ client/
│  │  ├─ package.json
│  │  ├─ vite.config.ts
│  │  ├─ index.html
│  │  ├─ src/
│  │  │  ├─ main.ts
│  │  │  ├─ game/config.ts
│  │  │  ├─ game/GameApp.ts
│  │  │  ├─ net/GameSocket.ts
│  │  │  ├─ scenes/BootScene.ts
│  │  │  ├─ scenes/LoginScene.ts
│  │  │  ├─ scenes/WorldScene.ts
│  │  │  ├─ scenes/BattleScene.ts
│  │  │  ├─ input/WorldInput.ts
│  │  │  ├─ ui/BattleHud.ts
│  │  │  └─ style.css
│  │  └─ tests/
│  │     └─ worldInput.test.ts
│  └─ server/
│     ├─ package.json
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ server/createGameServer.ts
│     │  ├─ session/SessionStore.ts
│     │  ├─ world/WorldService.ts
│     │  ├─ world/worldFixtures.ts
│     │  ├─ battle/BattleService.ts
│     │  ├─ battle/BattleEngine.ts
│     │  ├─ battle/arenaGenerator.ts
│     │  ├─ battle/hex.ts
│     │  ├─ battle/lineOfSight.ts
│     │  ├─ battle/injuries.ts
│     │  ├─ inventory/InventoryService.ts
│     │  └─ loot/LootService.ts
│     └─ tests/
│        ├─ hex.test.ts
│        ├─ arenaGenerator.test.ts
│        ├─ lineOfSight.test.ts
│        ├─ battleEngine.test.ts
│        ├─ injuries.test.ts
│        ├─ worldService.test.ts
│        └─ socketFlow.test.ts
└─ packages/
   └─ shared/
      ├─ package.json
      ├─ src/
      │  ├─ index.ts
      │  ├─ ids.ts
      │  ├─ world.ts
      │  ├─ battle.ts
      │  ├─ inventory.ts
      │  └─ protocol.ts
      └─ tests/
         └─ contracts.test.ts
```

---

### Task 1: Scaffold the monorepo and shared protocol contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/ids.ts`
- Create: `packages/shared/src/world.ts`
- Create: `packages/shared/src/battle.ts`
- Create: `packages/shared/src/inventory.ts`
- Create: `packages/shared/src/protocol.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/tests/contracts.test.ts`

**Interfaces:**
- Produces: `EntityId`, `PlayerId`, `BattleId`, `LocationId`, `HexCoord`, `WorldPlayerSnapshot`, `BattleSnapshot`, `BattleCommand`, `InventorySnapshot`, `ClientToServerEvents`, `ServerToClientEvents`.

- [ ] **Step 1: Add workspace configuration**

```json
{
  "name": "web-mmorpg",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "dev:client": "npm run dev -w @web-mmorpg/client",
    "dev:server": "npm run dev -w @web-mmorpg/server"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 2: Write a failing shared-contract test**

```ts
import { describe, expect, it } from "vitest";
import type { BattleCommand, HexCoord } from "../src/index";

describe("shared contracts", () => {
  it("represents a move command with axial coordinates", () => {
    const target: HexCoord = { q: 2, r: -1 };
    const command: BattleCommand = {
      type: "move",
      combatantId: "combatant-1",
      target
    };

    expect(command.target).toEqual({ q: 2, r: -1 });
  });
});
```

- [ ] **Step 3: Run the test and verify failure**

Run:

```bash
npm install
npm test -w @web-mmorpg/shared
```

Expected: FAIL because the shared package/contracts do not yet exist.

- [ ] **Step 4: Implement the shared types**

Use branded string aliases in `ids.ts`:

```ts
export type EntityId = string;
export type PlayerId = string;
export type BattleId = string;
export type LocationId = string;
export type ItemInstanceId = string;
```

Define `HexCoord` and battle commands in `battle.ts`:

```ts
import type { BattleId, EntityId, PlayerId } from "./ids";

export interface HexCoord {
  q: number;
  r: number;
}

export type InjuryKind =
  | "brokenArm"
  | "legTrauma"
  | "bleeding"
  | "concussion"
  | "chestWound"
  | "burn"
  | "poison";

export interface CombatantSnapshot {
  id: EntityId;
  ownerPlayerId?: PlayerId;
  name: string;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  initiative: number;
  position: HexCoord;
  severelyInjured: boolean;
  injuries: InjuryKind[];
}

export interface BattleSnapshot {
  id: BattleId;
  round: number;
  activeCombatantId: EntityId;
  turnOrder: EntityId[];
  cells: HexCoord[];
  blockedCells: HexCoord[];
  coverCells: HexCoord[];
  combatants: CombatantSnapshot[];
  finished: boolean;
}

export type BattleCommand =
  | { type: "move"; combatantId: EntityId; target: HexCoord }
  | { type: "meleeAttack"; combatantId: EntityId; targetId: EntityId }
  | { type: "rangedAttack"; combatantId: EntityId; targetId: EntityId }
  | { type: "endTurn"; combatantId: EntityId };
```

Define typed Socket.IO events in `protocol.ts`:

```ts
import type { BattleCommand, BattleSnapshot } from "./battle";
import type { InventorySnapshot } from "./inventory";
import type { LocationId, PlayerId } from "./ids";
import type { WorldStateSnapshot } from "./world";

export interface ClientToServerEvents {
  login: (payload: { nickname: string }, ack: (result: LoginResult) => void) => void;
  moveIntent: (payload: { x: number; y: number }) => void;
  startEncounter: (payload: { encounterId: string }) => void;
  battleCommand: (payload: BattleCommand) => void;
}

export interface ServerToClientEvents {
  worldState: (snapshot: WorldStateSnapshot) => void;
  battleStarted: (snapshot: BattleSnapshot) => void;
  battleState: (snapshot: BattleSnapshot) => void;
  battleEnded: (payload: { inventory: InventorySnapshot }) => void;
  commandRejected: (payload: { code: string; message: string }) => void;
}

export type LoginResult =
  | { ok: true; playerId: PlayerId; locationId: LocationId }
  | { ok: false; code: string; message: string };
```

- [ ] **Step 5: Run shared tests**

Run:

```bash
npm test -w @web-mmorpg/shared
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json .gitignore packages/shared
git commit -m "chore: scaffold monorepo and shared contracts"
```

---

### Task 2: Implement tested hex-grid math, pathing primitives, and line of sight

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/src/battle/hex.ts`
- Create: `apps/server/src/battle/lineOfSight.ts`
- Create: `apps/server/tests/hex.test.ts`
- Create: `apps/server/tests/lineOfSight.test.ts`

**Interfaces:**
- Consumes: `HexCoord` from `@web-mmorpg/shared`.
- Produces:
  - `hexKey(coord: HexCoord): string`
  - `hexNeighbors(coord: HexCoord): HexCoord[]`
  - `hexDistance(a: HexCoord, b: HexCoord): number`
  - `findPath(start, goal, blocked): HexCoord[] | null`
  - `hasLineOfSight(start, end, blockers): boolean`

- [ ] **Step 1: Write failing tests for axial-grid math**

```ts
import { describe, expect, it } from "vitest";
import { hexDistance, hexNeighbors } from "../src/battle/hex";

describe("hex math", () => {
  it("returns six neighbors", () => {
    expect(hexNeighbors({ q: 0, r: 0 })).toHaveLength(6);
  });

  it("calculates axial distance", () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

```bash
npm test -w @web-mmorpg/server -- hex.test.ts
```

Expected: FAIL because `hex.ts` does not exist.

- [ ] **Step 3: Implement hex helpers and BFS pathing**

```ts
import type { HexCoord } from "@web-mmorpg/shared";

const DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

export const hexKey = ({ q, r }: HexCoord) => `${q},${r}`;

export function hexNeighbors(coord: HexCoord): HexCoord[] {
  return DIRECTIONS.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const aq = a.q;
  const ar = a.r;
  const as = -aq - ar;
  const bq = b.q;
  const br = b.r;
  const bs = -bq - br;
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
}
```

Implement BFS pathing in the same file:

```ts
export function findPath(
  start: HexCoord,
  goal: HexCoord,
  blocked: ReadonlySet<string>
): HexCoord[] | null {
  const queue: HexCoord[] = [start];
  const cameFrom = new Map<string, HexCoord | null>([[hexKey(start), null]]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (hexKey(current) === hexKey(goal)) break;

    for (const next of hexNeighbors(current)) {
      const key = hexKey(next);
      if (blocked.has(key) || cameFrom.has(key)) continue;
      cameFrom.set(key, current);
      queue.push(next);
    }
  }

  if (!cameFrom.has(hexKey(goal))) return null;

  const path: HexCoord[] = [];
  let current: HexCoord | null = goal;
  while (current && hexKey(current) !== hexKey(start)) {
    path.push(current);
    current = cameFrom.get(hexKey(current)) ?? null;
  }
  return path.reverse();
}
```

- [ ] **Step 4: Add failing line-of-sight tests**

```ts
import { describe, expect, it } from "vitest";
import { hasLineOfSight } from "../src/battle/lineOfSight";

describe("line of sight", () => {
  it("is blocked by an obstacle between shooter and target", () => {
    const blockers = new Set(["1,0"]);
    expect(
      hasLineOfSight({ q: 0, r: 0 }, { q: 2, r: 0 }, blockers)
    ).toBe(false);
  });

  it("is clear when no blocking hex intersects the ray", () => {
    expect(
      hasLineOfSight({ q: 0, r: 0 }, { q: 2, r: 0 }, new Set())
    ).toBe(true);
  });
});
```

- [ ] **Step 5: Implement cube-interpolation line of sight**

Implement cube interpolation and rounding:

```ts
import type { HexCoord } from "@web-mmorpg/shared";
import { hexDistance, hexKey } from "./hex";

type Cube = { x: number; y: number; z: number };

const toCube = ({ q, r }: HexCoord): Cube => ({ x: q, z: r, y: -q - r });
const toAxial = ({ x, z }: Cube): HexCoord => ({ q: x, r: z });

function cubeRound(cube: Cube): Cube {
  let rx = Math.round(cube.x);
  let ry = Math.round(cube.y);
  let rz = Math.round(cube.z);
  const xDiff = Math.abs(rx - cube.x);
  const yDiff = Math.abs(ry - cube.y);
  const zDiff = Math.abs(rz - cube.z);

  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;

  return { x: rx, y: ry, z: rz };
}

export function hasLineOfSight(
  start: HexCoord,
  end: HexCoord,
  blockers: ReadonlySet<string>
): boolean {
  const distance = hexDistance(start, end);
  if (distance <= 1) return true;

  const a = toCube(start);
  const b = toCube(end);

  for (let i = 1; i < distance; i += 1) {
    const t = i / distance;
    const rounded = cubeRound({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t
    });
    if (blockers.has(hexKey(toAxial(rounded)))) return false;
  }
  return true;
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -w @web-mmorpg/server -- hex.test.ts lineOfSight.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat: add hex pathing and line of sight"
```

---

### Task 3: Add deterministic tactical arena generation

**Files:**
- Create: `apps/server/src/battle/arenaGenerator.ts`
- Create: `apps/server/tests/arenaGenerator.test.ts`
- Modify: `packages/shared/src/battle.ts`

**Interfaces:**
- Produces:
  - `ArenaProfile`
  - `GeneratedArena`
  - `generateArena(profile: ArenaProfile, seed: number): GeneratedArena`

- [ ] **Step 1: Extend shared arena contracts**

```ts
export interface ArenaProfile {
  radius: number;
  obstacleCount: number;
  coverCount: number;
}

export interface GeneratedArena {
  cells: HexCoord[];
  blockedCells: HexCoord[];
  coverCells: HexCoord[];
  playerStartCells: HexCoord[];
  enemyStartCells: HexCoord[];
}
```

- [ ] **Step 2: Write deterministic-generation tests**

```ts
import { describe, expect, it } from "vitest";
import { generateArena } from "../src/battle/arenaGenerator";

const profile = { radius: 4, obstacleCount: 6, coverCount: 4 };

describe("arena generation", () => {
  it("returns identical arenas for the same seed", () => {
    expect(generateArena(profile, 12345)).toEqual(generateArena(profile, 12345));
  });

  it("never places blockers inside start zones", () => {
    const arena = generateArena(profile, 99);
    const blocked = new Set(arena.blockedCells.map((c) => `${c.q},${c.r}`));
    expect(arena.playerStartCells.some((c) => blocked.has(`${c.q},${c.r}`))).toBe(false);
    expect(arena.enemyStartCells.some((c) => blocked.has(`${c.q},${c.r}`))).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

```bash
npm test -w @web-mmorpg/server -- arenaGenerator.test.ts
```

Expected: FAIL because generator is missing.

- [ ] **Step 4: Implement seeded RNG and arena generation**

Implement deterministic generation:

```ts
import type { ArenaProfile, GeneratedArena, HexCoord } from "@web-mmorpg/shared";
import { hexKey } from "./hex";

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateArena(profile: ArenaProfile, seed: number): GeneratedArena {
  const cells: HexCoord[] = [];
  for (let q = -profile.radius; q <= profile.radius; q += 1) {
    const minR = Math.max(-profile.radius, -q - profile.radius);
    const maxR = Math.min(profile.radius, -q + profile.radius);
    for (let r = minR; r <= maxR; r += 1) cells.push({ q, r });
  }

  const playerStartCells = cells.filter((c) => c.q <= -profile.radius + 1);
  const enemyStartCells = cells.filter((c) => c.q >= profile.radius - 1);
  const reserved = new Set([...playerStartCells, ...enemyStartCells].map(hexKey));
  const rng = mulberry32(seed);
  const candidates = cells.filter((c) => !reserved.has(hexKey(c)));

  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const blockedCells = candidates.slice(0, profile.obstacleCount);
  const coverCells = candidates.slice(
    profile.obstacleCount,
    profile.obstacleCount + profile.coverCount
  );

  return { cells, blockedCells, coverCells, playerStartCells, enemyStartCells };
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -w @web-mmorpg/server -- arenaGenerator.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/battle.ts apps/server/src/battle/arenaGenerator.ts apps/server/tests/arenaGenerator.test.ts
git commit -m "feat: add deterministic battle arenas"
```

---

### Task 4: Build the authoritative battle engine

**Files:**
- Create: `apps/server/src/battle/BattleEngine.ts`
- Create: `apps/server/src/battle/injuries.ts`
- Create: `apps/server/tests/battleEngine.test.ts`
- Create: `apps/server/tests/injuries.test.ts`

**Interfaces:**
- Consumes: generated arena, `BattleCommand`, hex/path/LOS helpers.
- Produces:
  - `createBattleState(input): BattleState`
  - `applyBattleCommand(state, actorPlayerId, command): BattleResult`
  - `rollInjuries(seed, combatant): InjuryKind[]`

- [ ] **Step 1: Write failing tests for turn ownership and AP**

```ts
it("rejects a move from a player that does not own the active combatant", () => {
  const result = applyBattleCommand(state, "player-2", {
    type: "move",
    combatantId: "hero-1",
    target: { q: 1, r: 0 }
  });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe("NOT_OWNER");
});

it("spends one AP per traversed hex", () => {
  const result = applyBattleCommand(state, "player-1", {
    type: "move",
    combatantId: "hero-1",
    target: { q: 2, r: 0 }
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.state.combatants["hero-1"].ap).toBe(3);
  }
});
```

- [ ] **Step 2: Run battle-engine tests and verify failure**

```bash
npm test -w @web-mmorpg/server -- battleEngine.test.ts
```

- [ ] **Step 3: Implement minimal battle state and command reducer**

Use a pure state transition API:

```ts
export type BattleResult =
  | { ok: true; state: BattleState }
  | { ok: false; code: string; message: string };

export function applyBattleCommand(
  state: BattleState,
  actorPlayerId: PlayerId,
  command: BattleCommand
): BattleResult
```

Rules for MVP:
- move costs 1 AP per traversed hex
- melee costs 2 AP and requires distance 1
- ranged costs 3 AP, max range 6, and requires LOS
- basic melee damage: 20
- basic ranged damage: 15
- `endTurn` advances to the next living combatant and refreshes that combatant to max AP
- battle finishes when one side has no combatants above 0 HP

- [ ] **Step 4: Add failing tests for melee/ranged validation**

Cover:
- melee target at distance 2 => `OUT_OF_RANGE`
- ranged target behind a blocker => `NO_LINE_OF_SIGHT`
- insufficient AP => `INSUFFICIENT_AP`

- [ ] **Step 5: Implement attack validation and damage**

Implement deterministic attack resolution:

```ts
function applyAttack(
  state: BattleState,
  attacker: CombatantState,
  target: CombatantState,
  damage: number,
  apCost: number
): BattleState {
  return {
    ...state,
    combatants: {
      ...state.combatants,
      [attacker.id]: { ...attacker, ap: attacker.ap - apCost },
      [target.id]: applyDamageWithInjuries(target, damage, state.seed + state.round)
    }
  };
}
```

For `meleeAttack`, require `hexDistance(attacker.position, target.position) === 1`.
For `rangedAttack`, require distance `<= 6` and `hasLineOfSight(...) === true`.
Do not add critical hits or client-provided damage values.

- [ ] **Step 6: Add failing injury tests**

```ts
it("marks a combatant severely injured when reduced to zero HP", () => {
  const result = applyDamageWithInjuries(combatant, 999, 42);
  expect(result.severelyInjured).toBe(true);
  expect(result.injuries.length).toBeGreaterThan(0);
});
```

- [ ] **Step 7: Implement deterministic injuries**

Use this deterministic injury application:

```ts
const INJURIES: InjuryKind[] = [
  "brokenArm",
  "legTrauma",
  "bleeding",
  "concussion",
  "chestWound"
];

export function applyDamageWithInjuries(
  combatant: CombatantState,
  damage: number,
  seed: number
): CombatantState {
  const hp = Math.max(0, combatant.hp - damage);
  if (hp > 0) return { ...combatant, hp };

  const first = INJURIES[Math.abs(seed) % INJURIES.length];
  const second = INJURIES[Math.abs(seed * 31 + 7) % INJURIES.length];
  const injuries = first === second ? [first] : [first, second];

  return { ...combatant, hp: 0, severelyInjured: true, injuries };
}
```

Apply modifiers in command validation:
- `legTrauma`: movement AP cost +1 per traversed hex
- `concussion`: effective initiative -2
- `brokenArm`: ranged attack cost +1 AP
- `chestWound`: effective max HP is `Math.floor(baseMaxHp * 0.8)`
- `bleeding`: subtract 5 HP on `endTurn`, clamped at 0

- [ ] **Step 8: Run battle and injury tests**

```bash
npm test -w @web-mmorpg/server -- battleEngine.test.ts injuries.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/battle apps/server/tests/battleEngine.test.ts apps/server/tests/injuries.test.ts
git commit -m "feat: add authoritative tactical battle engine"
```

---

### Task 5: Add world state, sessions, encounters, inventory, and loot

**Files:**
- Create: `apps/server/src/session/SessionStore.ts`
- Create: `apps/server/src/world/worldFixtures.ts`
- Create: `apps/server/src/world/WorldService.ts`
- Create: `apps/server/src/inventory/InventoryService.ts`
- Create: `apps/server/src/loot/LootService.ts`
- Create: `apps/server/tests/worldService.test.ts`
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/shared/src/inventory.ts`

**Interfaces:**
- Produces:
  - `SessionStore.login(nickname)`
  - `WorldService.movePlayer(playerId, intent)`
  - `WorldService.startEncounter(playerId, encounterId)`
  - `InventoryService.getSnapshot(playerId)`
  - `LootService.rollEncounterLoot(encounterId, seed)`

- [ ] **Step 1: Define world and inventory contracts**

World:

```ts
export interface WorldPlayerSnapshot {
  id: PlayerId;
  nickname: string;
  x: number;
  y: number;
}

export interface EncounterSnapshot {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface WorldStateSnapshot {
  locationId: LocationId;
  players: WorldPlayerSnapshot[];
  encounters: EncounterSnapshot[];
}
```

Inventory:

```ts
export interface InventoryItem {
  instanceId: ItemInstanceId;
  itemId: string;
  name: string;
  quantity: number;
}

export interface InventorySnapshot {
  items: InventoryItem[];
}
```

- [ ] **Step 2: Write world movement tests**

```ts
it("clamps player movement to world bounds", () => {
  const world = createTestWorld();
  world.addPlayer({ id: "p1", nickname: "Owczy" });

  const result = world.movePlayer("p1", { x: 9999, y: 9999 });

  expect(result.x).toBeLessThanOrEqual(1600);
  expect(result.y).toBeLessThanOrEqual(900);
});
```

Also test a maximum movement delta per server update so the client cannot teleport.

- [ ] **Step 3: Implement the MVP world**

Use one location:
- id: `meadow-01`
- bounds: 1600x900
- spawn: 300,450
- one encounter: `wolf-pack-01` at 1050,450
- encounter activation radius: 90 pixels

Implement movement validation as:

```ts
const MAX_SPEED = 220;

movePlayer(playerId: PlayerId, intent: { x: number; y: number }, now = Date.now()) {
  const player = this.players.get(playerId);
  if (!player) throw new Error("PLAYER_NOT_FOUND");

  const elapsed = Math.max(0, (now - player.lastMoveAt) / 1000);
  const maxDistance = MAX_SPEED * elapsed;
  const dx = intent.x - player.x;
  const dy = intent.y - player.y;
  const distance = Math.hypot(dx, dy);
  const scale = distance > maxDistance && distance > 0 ? maxDistance / distance : 1;

  player.x = Math.min(1600, Math.max(0, player.x + dx * scale));
  player.y = Math.min(900, Math.max(0, player.y + dy * scale));
  player.lastMoveAt = now;
  return { x: player.x, y: player.y };
}
```

- [ ] **Step 4: Implement ephemeral nickname login**

Implement login validation:

```ts
import { randomUUID } from "node:crypto";

login(nicknameInput: string): LoginResult {
  const nickname = nicknameInput.trim();
  if (nickname.length < 3 || nickname.length > 20) {
    return { ok: false, code: "INVALID_NICKNAME", message: "Nickname must be 3-20 characters." };
  }
  if ([...this.sessions.values()].some((s) => s.nickname.toLowerCase() === nickname.toLowerCase())) {
    return { ok: false, code: "NICKNAME_IN_USE", message: "Nickname is already active." };
  }

  const playerId = randomUUID();
  this.sessions.set(playerId, { playerId, nickname, locationId: "meadow-01" });
  return { ok: true, playerId, locationId: "meadow-01" };
}
```

- [ ] **Step 5: Implement inventory and deterministic loot**

For the first encounter, victory awards:

```ts
[
  { itemId: "wolf-pelt", name: "Wolf Pelt", quantity: 1 },
  { itemId: "field-bandage", name: "Field Bandage", quantity: 2 }
]
```

`InventoryService.addItems(playerId, items)` merges stackable items by `itemId`.

- [ ] **Step 6: Run world tests**

```bash
npm test -w @web-mmorpg/server -- worldService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/world.ts packages/shared/src/inventory.ts apps/server/src/session apps/server/src/world apps/server/src/inventory apps/server/src/loot apps/server/tests/worldService.test.ts
git commit -m "feat: add world sessions encounters and loot"
```

---

### Task 6: Wire the authoritative Socket.IO game server

**Files:**
- Create: `apps/server/src/battle/BattleService.ts`
- Create: `apps/server/src/server/createGameServer.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- Consumes: shared typed events, `SessionStore`, `WorldService`, `BattleEngine`, `InventoryService`, `LootService`.
- Produces: a running Socket.IO service exposing `login`, `moveIntent`, `startEncounter`, and `battleCommand`.

- [ ] **Step 1: Write an integration test for login and world broadcast**

Use an ephemeral HTTP server and `socket.io-client` in the test. Assert that:
1. client connects
2. `login` ack returns `ok: true`
3. client receives `worldState`
4. snapshot contains the logged-in player

- [ ] **Step 2: Run the integration test and verify failure**

```bash
npm test -w @web-mmorpg/server -- socketFlow.test.ts
```

- [ ] **Step 3: Implement `createGameServer`**

```ts
export function createGameServer(httpServer: HttpServer) {
  const sessions = new SessionStore();
  const world = new WorldService();
  const inventory = new InventoryService();
  const loot = new LootService();
  const battles = new BattleService();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: false }
  });

  io.on("connection", (socket) => {
    let playerId: PlayerId | null = null;

    socket.on("login", ({ nickname }, ack) => {
      const result = sessions.login(nickname);
      if (!result.ok) return ack(result);
      playerId = result.playerId;
      world.addPlayer({ id: result.playerId, nickname });
      socket.join(`location:${result.locationId}`);
      ack(result);
      io.to(`location:${result.locationId}`).emit("worldState", world.snapshot(result.locationId));
    });

    socket.on("moveIntent", (intent) => {
      if (!playerId) return;
      world.movePlayer(playerId, intent);
      io.to("location:meadow-01").emit("worldState", world.snapshot("meadow-01"));
    });
  });

  return { io, services: { sessions, world, inventory, loot, battles } };
}
```

Socket state stores only `playerId`; all authoritative data stays in services.

- [ ] **Step 4: Add integration tests for encounter and battle start**

After login:
- move player within activation radius
- emit `startEncounter({ encounterId: "wolf-pack-01" })`
- expect `battleStarted`
- assert active combatant and arena cells exist

- [ ] **Step 5: Add integration tests for rejected client cheating**

Emit a `battleCommand` for another combatant and assert:

```ts
expect(rejection.code).toBe("NOT_OWNER");
```

Also verify world-position input is clamped by the server.

- [ ] **Step 6: Implement battle resolution flow**

When `BattleService.applyCommand(...)` returns a finished battle, execute this exact order:

```ts
const loot = lootService.rollEncounterLoot(battle.encounterId, battle.seed);
inventoryService.addItems(playerId, loot);
socket.emit("battleEnded", { inventory: inventoryService.getSnapshot(playerId) });
battleService.removeBattleForPlayer(playerId);
socket.join("location:meadow-01");
io.to("location:meadow-01").emit("worldState", worldService.snapshot("meadow-01"));
```

- [ ] **Step 7: Run all server tests**

```bash
npm test -w @web-mmorpg/server
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src apps/server/tests/socketFlow.test.ts
git commit -m "feat: expose authoritative multiplayer server"
```

---

### Task 7: Build the Phaser client shell, login flow, and multiplayer world scene

**Files:**
- Create: `apps/client/package.json`
- Create: `apps/client/vite.config.ts`
- Create: `apps/client/index.html`
- Create: `apps/client/src/main.ts`
- Create: `apps/client/src/style.css`
- Create: `apps/client/src/game/config.ts`
- Create: `apps/client/src/game/GameApp.ts`
- Create: `apps/client/src/net/GameSocket.ts`
- Create: `apps/client/src/scenes/BootScene.ts`
- Create: `apps/client/src/scenes/LoginScene.ts`
- Create: `apps/client/src/scenes/WorldScene.ts`
- Create: `apps/client/src/input/WorldInput.ts`
- Create: `apps/client/tests/worldInput.test.ts`

**Interfaces:**
- Consumes: shared world/protocol contracts.
- Produces:
  - `GameSocket.connect()`
  - `GameSocket.login(nickname)`
  - `WorldInput.update(...)`
  - Phaser scenes `LoginScene` and `WorldScene`

- [ ] **Step 1: Write a failing input-normalization test**

Test that keyboard input and click/tap intent normalize to the same world-target interface:

```ts
expect(resolveKeyboardIntent({ left: false, right: true, up: false, down: false }))
  .toEqual({ dx: 1, dy: 0 });
```

- [ ] **Step 2: Run client tests and verify failure**

```bash
npm test -w @web-mmorpg/client -- worldInput.test.ts
```

- [ ] **Step 3: Implement client package and Vite config**

Set:

```ts
export default defineConfig({
  base: "/WEB_MMORPG/"
});
```

Read server URL from:

```ts
const serverUrl = import.meta.env.VITE_GAME_SERVER_URL ?? "http://localhost:3001";
```

- [ ] **Step 4: Implement login UI**

Create a DOM overlay from the scene:

```ts
const form = document.createElement("form");
form.className = "login-panel";
form.innerHTML = `
  <input name="nickname" minlength="3" maxlength="20" autocomplete="nickname" />
  <button type="submit">Join</button>
  <p data-error></p>
`;
document.body.appendChild(form);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const nickname = String(data.get("nickname") ?? "");
  const result = await gameSocket.login(nickname);
  if (!result.ok) {
    form.querySelector<HTMLElement>("[data-error]")!.textContent = result.message;
    return;
  }
  form.remove();
  this.scene.start("WorldScene", { playerId: result.playerId });
});
```

- [ ] **Step 5: Implement world rendering**

Render snapshots with Phaser primitives:

```ts
private renderWorld(snapshot: WorldStateSnapshot) {
  for (const player of snapshot.players) {
    const entry = this.playerViews.get(player.id) ?? this.createPlayerView(player.id);
    entry.body.setPosition(player.x, player.y);
    entry.label.setPosition(player.x, player.y - 26).setText(player.nickname);
  }

  for (const encounter of snapshot.encounters) {
    if (this.encounterViews.has(encounter.id)) continue;
    const marker = this.add.circle(encounter.x, encounter.y, 24, 0x777777)
      .setInteractive({ useHandCursor: true });
    marker.on("pointerup", () => gameSocket.startEncounter(encounter.id));
    this.encounterViews.set(encounter.id, marker);
  }
}
```

Use only placeholder geometry/text in MVP; final art remains out of scope.

- [ ] **Step 6: Implement desktop and touch movement**

Normalize input with:

```ts
export function resolveKeyboardIntent(keys: {
  left: boolean; right: boolean; up: boolean; down: boolean;
}) {
  const dx = Number(keys.right) - Number(keys.left);
  const dy = Number(keys.down) - Number(keys.up);
  const length = Math.hypot(dx, dy) || 1;
  return { dx: dx / length, dy: dy / length };
}
```

In `WorldScene.update`, convert keyboard direction or pointer/touch target into a desired world position and emit:

```ts
gameSocket.sendMoveIntent({ x: desiredX, y: desiredY });
```

Use the same pointer target logic for mouse clicks and touch taps. Server snapshots remain authoritative and overwrite local prediction.

- [ ] **Step 7: Run client tests and build**

```bash
npm test -w @web-mmorpg/client
npm run build -w @web-mmorpg/client
```

Expected: PASS and Vite build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/client
git commit -m "feat: add multiplayer world client"
```

---

### Task 8: Build the tactical battle scene and HUD

**Files:**
- Create: `apps/client/src/scenes/BattleScene.ts`
- Create: `apps/client/src/ui/BattleHud.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Modify: `apps/client/src/game/config.ts`

**Interfaces:**
- Consumes: `BattleSnapshot`, `BattleCommand`.
- Produces: interactive hex-grid rendering and commands only; no local authority.

- [ ] **Step 1: Add battle-event subscriptions to `GameSocket`**

Expose:

```ts
onBattleStarted(handler: (snapshot: BattleSnapshot) => void): () => void
onBattleState(handler: (snapshot: BattleSnapshot) => void): () => void
sendBattleCommand(command: BattleCommand): void
```

Each subscription returns an unsubscribe function.

- [ ] **Step 2: Implement axial-to-screen conversion**

Use pointy-top hexes:

```ts
export function axialToPixel({ q, r }: HexCoord, size: number) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r
  };
}
```

- [ ] **Step 3: Render the arena from server snapshot**

Render server state with Phaser graphics:

```ts
for (const cell of snapshot.cells) {
  const p = axialToPixel(cell, HEX_SIZE);
  graphics.lineStyle(1, 0x666666).strokePoints(hexPolygon(p.x, p.y, HEX_SIZE), true);
}
for (const cell of snapshot.blockedCells) {
  const p = axialToPixel(cell, HEX_SIZE);
  this.add.circle(p.x, p.y, HEX_SIZE * 0.45, 0x333333);
}
for (const combatant of snapshot.combatants) {
  const p = axialToPixel(combatant.position, HEX_SIZE);
  const owned = combatant.ownerPlayerId === this.playerId;
  this.add.circle(p.x, p.y, HEX_SIZE * 0.35, owned ? 0x88aaff : 0xaa8888);
}
```

Cover cells use a shorter rectangle/rock placeholder so the player can visually distinguish cover from fully blocking obstacles.

- [ ] **Step 4: Implement command interaction**

Bind interaction to commands only:

```ts
private requestMove(target: HexCoord) {
  gameSocket.sendBattleCommand({
    type: "move",
    combatantId: this.activeOwnedCombatantId(),
    target
  });
}

private requestAttack(targetId: EntityId, mode: "meleeAttack" | "rangedAttack") {
  gameSocket.sendBattleCommand({
    type: mode,
    combatantId: this.activeOwnedCombatantId(),
    targetId
  });
}

private requestEndTurn() {
  gameSocket.sendBattleCommand({
    type: "endTurn",
    combatantId: this.activeOwnedCombatantId()
  });
}
```

The client can highlight candidate cells/targets, but it never applies AP, damage, range, path, or LOS results locally.

- [ ] **Step 5: Implement responsive battle HUD**

Render a DOM HUD from the latest snapshot:

```html
<div class="battle-hud">
  <div data-name></div>
  <div>HP <span data-hp></span></div>
  <div>AP <span data-ap></span></div>
  <div data-injuries></div>
  <button data-action="melee">Melee</button>
  <button data-action="ranged">Ranged</button>
  <button data-action="end">End turn</button>
</div>
```

CSS must include:

```css
.battle-hud button { min-height: 44px; min-width: 44px; }
```

`BattleHud.update(combatant)` writes name, `hp/maxHp`, `ap/maxAp`, and joined injury labels into these elements.

- [ ] **Step 6: Build client**

```bash
npm run build -w @web-mmorpg/client
```

Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/scenes/BattleScene.ts apps/client/src/ui/BattleHud.ts apps/client/src/net/GameSocket.ts apps/client/src/game/config.ts
git commit -m "feat: add tactical hex battle client"
```

---

### Task 9: Connect the complete vertical slice end to end

**Files:**
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/scenes/BattleScene.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Modify: `apps/server/src/battle/BattleService.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- Produces the exact MVP loop from the approved spec.

- [ ] **Step 1: Write the full socket-flow test**

The test must prove:

1. Player logs in.
2. Player enters world snapshot.
3. Player moves into encounter radius.
4. Player starts `wolf-pack-01`.
5. Server emits `battleStarted`.
6. Test performs valid commands until enemy reaches 0 HP.
7. Server emits `battleEnded`.
8. Inventory contains `wolf-pelt` and `field-bandage`.
9. Server emits a new world snapshot for the player.

- [ ] **Step 2: Run the test and verify failure**

```bash
npm test -w @web-mmorpg/server -- socketFlow.test.ts
```

- [ ] **Step 3: Implement scene transitions**

Client:
- `battleStarted` => pause world scene, launch battle scene
- `battleEnded` => stop battle scene, resume world scene, render inventory summary toast

- [ ] **Step 4: Verify injury state survives battle resolution**

Add an integration case where the player's combatant reaches 0 HP. Confirm:
- battle snapshot marks `severelyInjured`
- at least one specific injury is present
- returning to world does not silently clear injury data in the session character model

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all workspace tests PASS.

- [ ] **Step 6: Run both apps locally**

Terminal 1:

```bash
npm run dev:server
```

Terminal 2:

```bash
VITE_GAME_SERVER_URL=http://localhost:3001 npm run dev:client
```

Manual acceptance:
- open two browser windows
- log in with two different nicknames
- both clients see each other move
- one player enters the wolf encounter
- battle opens on a hex arena
- valid move/attack/end-turn commands update from the server
- battle victory grants loot and returns to the world

- [ ] **Step 7: Commit**

```bash
git add apps packages
git commit -m "feat: complete first playable mmorpg vertical slice"
```

---

### Task 10: Add CI and GitHub Pages deployment for the client

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/pages.yml`
- Modify: `README.md`

**Interfaces:**
- Produces automated test/build verification and static client deployment.

- [ ] **Step 1: Add CI workflow**

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Add Pages workflow**

Build `apps/client` with `VITE_GAME_SERVER_URL` from repository variable `GAME_SERVER_URL`, upload `apps/client/dist`, and deploy with the official GitHub Pages actions.

- [ ] **Step 3: Document local development**

README must contain exact commands:

```bash
npm install
npm run dev:server
npm run dev:client
```

Document:
- local server default `http://localhost:3001`
- client Vite URL
- required GitHub repository variable `GAME_SERVER_URL`
- GitHub Pages path `/WEB_MMORPG/`
- server must be hosted separately from GitHub Pages

- [ ] **Step 4: Run final verification**

```bash
npm ci
npm test
npm run build
```

Expected: all commands exit with code 0.

- [ ] **Step 5: Commit**

```bash
git add .github README.md
git commit -m "ci: add validation and github pages deployment"
```

---

# Final Acceptance Criteria

The MVP is complete only when all of the following are true:

1. Two browser clients can log in with different nicknames.
2. Both clients see authoritative shared movement in one location.
3. PC controls support WASD and click-to-move.
4. Mobile/touch controls can move the player and interact with the encounter.
5. The server rejects invalid world movement and client-side cheating attempts.
6. A player can start the wolf encounter.
7. The battle arena is generated deterministically from a seed.
8. Battle uses hex movement, AP, initiative, melee, ranged attacks, blockers, and LOS.
9. Reaching 0 HP can create severe injury plus specific injuries.
10. Victory awards loot into inventory.
11. Battle end returns the player to the shared world.
12. `npm test` passes.
13. `npm run build` passes.
14. The client is deployable to GitHub Pages with a separately hosted Socket.IO server.
