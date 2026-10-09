import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  BattleCommand,
  BattleSnapshot,
  NpcInteractionPayload,
  PlayerId,
  PlayerStateSnapshot,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import { io as createClient, type Socket } from "socket.io-client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { findPath, hexDistance, hexKey, hexNeighbors } from "../src/battle/hex";
import { hasLineOfSight } from "../src/battle/lineOfSight";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { createGameServer } from "../src/server/createGameServer";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? createPool(databaseUrl) : null;
const clients: Socket[] = [];
const PASSWORD = "correct-horse-battery-staple";
let closeServer: (() => Promise<void>) | undefined;

beforeAll(async () => {
  if (!pool) return;
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await runMigrations(pool);
  await seedItemMetadata(pool);
});

beforeEach(async () => {
  if (!pool) return;
  await pool.query("TRUNCATE item_instances, account_sessions, characters, accounts CASCADE");
});

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await closeServer?.();
  closeServer = undefined;
});

afterAll(async () => {
  await pool?.end();
});

async function startTestServer() {
  if (!pool) throw new Error("DATABASE_URL_REQUIRED_FOR_SOCKET_TESTS");
  const lifecycle = new CharacterLifecycleService(pool);
  const auth = new AuthService(pool, new AccountRepository(pool), lifecycle);
  const httpServer = createServer();
  const game = createGameServer(httpServer, {
    pool,
    authService: auth,
    characterLifecycle: lifecycle
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;

  closeServer = async () => {
    await new Promise<void>((resolve) => game.io.close(() => resolve()));
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };

  const connectClient = async (): Promise<Socket> => {
    const socket = createClient(`http://127.0.0.1:${address.port}`, {
      transports: ["websocket"],
      forceNew: true
    });
    clients.push(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });

    return socket;
  };

  return { game, connectClient, auth, lifecycle };
}

async function createIdentity(
  auth: AuthService,
  lifecycle: CharacterLifecycleService,
  username: string,
  nickname: string
) {
  if (!pool) throw new Error("DATABASE_URL_REQUIRED_FOR_SOCKET_TESTS");
  await auth.register(username, PASSWORD);
  const account = await new AccountRepository(pool).findByNormalizedUsername(username.toLowerCase());
  if (!account) throw new Error("ACCOUNT_NOT_CREATED");
  const character = await lifecycle.createCharacter(account.id, { nickname, appearance: {} });
  const login = await auth.login(username, PASSWORD);
  return { token: login.token, characterId: character.id };
}

async function authenticate(socket: Socket, token: string): Promise<string> {
  const result = await socket.emitWithAck("authenticate", { sessionToken: token });
  expect(result).toMatchObject({ ok: true, locationId: "forest-settlement-01" });
  if (!result.ok) throw new Error(`Socket authentication failed: ${result.code}`);
  return result.characterId;
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve) => socket.once(event, resolve));
}

function onceWithTimeout<T>(socket: Socket, event: string, timeoutMs = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function choosePlayerCommand(snapshot: BattleSnapshot, playerId: PlayerId): BattleCommand {
  const hero = snapshot.combatants.find(
    (combatant) => combatant.ownerPlayerId === playerId && combatant.hp > 0
  );
  const enemy = snapshot.combatants.find(
    (combatant) => combatant.ownerPlayerId === undefined && combatant.hp > 0
  );
  if (!hero || !enemy) throw new Error("Expected living hero and enemy.");

  const distance = hexDistance(hero.position, enemy.position);
  if (distance === 1) {
    if (hero.ap >= 2) {
      return { type: "meleeAttack", combatantId: hero.id, targetId: enemy.id };
    }
    return { type: "endTurn", combatantId: hero.id };
  }

  const rangedCost = hero.injuries.includes("brokenArm") ? 4 : 3;
  const blockers = new Set(snapshot.blockedCells.map(hexKey));
  if (
    hero.ap >= rangedCost &&
    distance <= 6 &&
    hasLineOfSight(hero.position, enemy.position, blockers)
  ) {
    return { type: "rangedAttack", combatantId: hero.id, targetId: enemy.id };
  }

  if (hero.ap > 0) {
    const allowed = new Set(snapshot.cells.map(hexKey));
    const occupied = new Set(snapshot.blockedCells.map(hexKey));
    for (const combatant of snapshot.combatants) {
      if (combatant.id !== hero.id && combatant.hp > 0) {
        occupied.add(hexKey(combatant.position));
      }
    }

    const goals = hexNeighbors(enemy.position)
      .filter((cell) => allowed.has(hexKey(cell)) && !occupied.has(hexKey(cell)))
      .sort((a, b) => hexDistance(hero.position, a) - hexDistance(hero.position, b));

    for (const goal of goals) {
      const path = findPath(hero.position, goal, occupied, allowed);
      if (path?.length) {
        return { type: "move", combatantId: hero.id, target: path[0]! };
      }
    }
  }

  return { type: "endTurn", combatantId: hero.id };
}

async function winBattle(socket: Socket, initial: BattleSnapshot, playerId: PlayerId) {
  let battle = initial;
  const endedPromise = onceWithTimeout<{
    outcome: "victory" | "defeat";
    inventory: {
      items: Array<{
        instanceId: string;
        itemDefinitionId?: string;
        itemId: string;
        name: string;
        category: string;
        quantity: number;
      }>;
    };
    character: { hp: number };
  }>(socket, "battleEnded", 4000);

  for (let step = 0; step < 40 && !battle.finished; step += 1) {
    const statePromise = onceWithTimeout<BattleSnapshot>(socket, "battleState");
    socket.emit("battleCommand", choosePlayerCommand(battle, playerId));
    battle = await statePromise;
  }

  expect(battle.finished).toBe(true);
  return endedPromise;
}

describeDatabase("Socket.IO game flow", () => {
  it("emits player state after durable authentication and routes NPC interaction", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const identity = await createIdentity(auth, lifecycle, "owczy_flow", "Owczy");
    const client = await connectClient();
    const playerStatePromise = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");

    const playerId = await authenticate(client, identity.token);
    expect(playerId).toBe(identity.characterId);

    const playerState = await playerStatePromise;
    expect(playerState.character).toMatchObject({
      playerId: identity.characterId,
      nickname: "Owczy",
      hp: 100,
      maxHp: 100
    });

    game.services.world.movePlayer(playerId, { x: 610, y: 420 }, Date.now() + 10_000);

    const interactionPromise = onceWithTimeout<NpcInteractionPayload>(client, "npcInteraction");
    client.emit("interactNpc", { npcId: "guide-boran" });

    const interaction = await interactionPromise;
    expect(interaction).toMatchObject({
      npcId: "guide-boran",
      kind: "guide",
      npcName: "Boran",
      canHeal: false
    });
  });

  it("rejects attempts to control the server-owned wolf", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const identity = await createIdentity(auth, lifecycle, "owczy_wolf", "Owczy");
    const client = await connectClient();
    const worldPromise = once<WorldStateSnapshot>(client, "worldState");

    const playerId = await authenticate(client, identity.token);
    await worldPromise;

    game.services.world.movePlayer(playerId, { x: 1320, y: 455 }, Date.now() + 10_000);

    const battlePromise = once<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const battle = await battlePromise;
    const wolf = battle.combatants.find((combatant) => combatant.name === "Wolf")!;

    const rejectionPromise = once<{ code: string; message: string }>(client, "commandRejected");
    client.emit("battleCommand", { type: "endTurn", combatantId: wolf.id });

    expect((await rejectionPromise).code).toBe("NOT_OWNER");
  });

  it("completes forest -> battle -> loot -> shared world after victory", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const identity = await createIdentity(auth, lifecycle, "owczy_victory", "Owczy");
    const client = await connectClient();
    const playerId = await authenticate(client, identity.token);

    game.services.world.movePlayer(playerId, { x: 1320, y: 455 }, Date.now() + 10_000);

    const startedPromise = onceWithTimeout<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const started = await startedPromise;
    const worldReturnPromise = onceWithTimeout<WorldStateSnapshot>(client, "worldState", 4000);
    const ended = await winBattle(client, started, playerId);

    expect(ended.outcome).toBe("victory");
    const pelt = ended.inventory.items.find((item) => item.itemId === "wolf-pelt");
    const bandage = ended.inventory.items.find((item) => item.itemId === "field-bandage");
    expect(pelt).toMatchObject({
      name: "Wolf Pelt",
      category: "material",
      quantity: 1
    });
    expect(pelt?.itemDefinitionId).toBeTruthy();
    expect(bandage).toMatchObject({
      name: "Field Bandage",
      category: "consumable",
      quantity: 2
    });
    expect(bandage?.itemDefinitionId).toBeTruthy();

    const returnedWorld = await worldReturnPromise;
    expect(returnedWorld.players.some((player) => player.id === playerId)).toBe(true);
  });

  it("recovers from defeat while preserving severe injury state", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const identity = await createIdentity(auth, lifecycle, "owczy_defeat", "Owczy");
    const client = await connectClient();
    const playerId = await authenticate(client, identity.token);

    game.services.characters.applyBattleResult(playerId, {
      hp: 1,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });
    game.services.world.movePlayer(playerId, { x: 1320, y: 455 }, Date.now() + 10_000);

    const startedPromise = onceWithTimeout<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    let battle = await startedPromise;
    const endedPromise = onceWithTimeout<{
      outcome: "victory" | "defeat";
      character: { hp: number; severelyInjured: boolean; injuries: string[] };
    }>(client, "battleEnded", 4000);

    for (let turn = 0; turn < 12 && !battle.finished; turn += 1) {
      const hero = battle.combatants.find((combatant) => combatant.ownerPlayerId === playerId);
      if (!hero) throw new Error("Expected hero.");
      const statePromise = onceWithTimeout<BattleSnapshot>(client, "battleState");
      client.emit("battleCommand", { type: "endTurn", combatantId: hero.id });
      battle = await statePromise;
    }

    const ended = await endedPromise;
    expect(ended.outcome).toBe("defeat");
    expect(ended.character.hp).toBe(25);
    expect(ended.character.severelyInjured).toBe(true);
    expect(ended.character.injuries.length).toBeGreaterThan(0);
  });

  it("keeps another player in the shared world while one player battles", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const firstIdentity = await createIdentity(auth, lifecycle, "owczy_shared", "Owczy");
    const secondIdentity = await createIdentity(auth, lifecycle, "karolina_shared", "Karolina");
    const first = await connectClient();
    const second = await connectClient();

    const firstPlayerId = await authenticate(first, firstIdentity.token);

    const firstWorld = onceWithTimeout<WorldStateSnapshot>(first, "worldState");
    const secondWorld = onceWithTimeout<WorldStateSnapshot>(second, "worldState");
    const secondPlayerId = await authenticate(second, secondIdentity.token);

    expect((await firstWorld).players).toHaveLength(2);
    expect((await secondWorld).players).toHaveLength(2);
    expect(secondPlayerId).toBe(secondIdentity.characterId);

    let secondEnteredBattle = false;
    second.once("battleStarted", () => {
      secondEnteredBattle = true;
    });

    game.services.world.movePlayer(firstPlayerId, { x: 1320, y: 455 }, Date.now() + 10_000);

    const startedPromise = onceWithTimeout<BattleSnapshot>(first, "battleStarted");
    first.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const started = await startedPromise;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(secondEnteredBattle).toBe(false);

    const secondReturnWorld = onceWithTimeout<WorldStateSnapshot>(second, "worldState", 4000);
    const ended = await winBattle(first, started, firstPlayerId);
    expect(ended.outcome).toBe("victory");

    const world = await secondReturnWorld;
    expect(world.players.map((player) => player.nickname).sort()).toEqual(["Karolina", "Owczy"]);
  });
});
