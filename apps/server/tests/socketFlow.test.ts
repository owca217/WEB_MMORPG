import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type {
  BattleCommand,
  BattleSnapshot,
  CharacterSnapshot,
  NpcInteractionPayload,
  PlayerId,
  PlayerStateSnapshot,
  SetContainerSlotResult,
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
  it,
  vi
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

async function giveTestContainer(game: ReturnType<typeof createGameServer>, characterId: string) {
  const definitionId = randomUUID();
  const stableId = `flow-container-${randomUUID()}`;
  await pool!.query("INSERT INTO items (id,item_id,status,active_version_no) VALUES ($1,$2,'PUBLISHED',1)", [definitionId, stableId]);
  await pool!.query(`INSERT INTO item_versions (
    id,item_id,version_no,revision,state,name,category_id,description,rarity,item_level,minimum_level,
    sell_value,sellable,tradable,droppable,stackable,max_stack,weight,soulbound,unique_item,special_data,created_by
  ) VALUES ($1,$2,1,1,'PUBLISHED','Skrzynia testowa','container','Pojemnik testowy','COMMON',1,0,
    0,TRUE,TRUE,TRUE,FALSE,1,1,'NONE',FALSE,'{}'::jsonb,'00000000-0000-4000-8000-000000000001')`, [randomUUID(), definitionId]);
  const snapshot = await game.services.inventory.addItems(characterId, [{ itemId: stableId, quantity: 1 }]);
  return snapshot.items.find((item) => item.itemId === stableId)!.instanceId;
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
    character: CharacterSnapshot;
    experienceGained?: number;
    levelsGained?: number;
  }>(socket, "battleEnded", 4000);

  for (let step = 0; step < 160 && !battle.finished; step += 1) {
    const statePromise = onceWithTimeout<BattleSnapshot>(socket, "battleState");
    socket.emit("battleCommand", choosePlayerCommand(battle, playerId));
    battle = await statePromise;
  }

  expect(battle.finished).toBe(true);
  return endedPromise;
}

describeDatabase("Socket.IO game flow", () => {
  it("uses a battle bandage and broadcasts matching inventory, character and battle state", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const identity = await createIdentity(auth, lifecycle, "item_user", "ItemHero");
    await pool!.query("UPDATE characters SET hp=41,severely_injured=TRUE,injuries='[\"bleeding\"]'::jsonb,x=1320,y=455 WHERE id=$1", [identity.characterId]);
    const item = (await game.services.inventory.addItems(identity.characterId, [{ itemId: "field-bandage", quantity: 2 }])).items[0]!;
    const client = await connectClient();
    const initialState = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    await authenticate(client, identity.token);
    await initialState;
    const started = onceWithTimeout<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    await started;
    const battleState = onceWithTimeout<BattleSnapshot>(client, "battleState");
    const playerState = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    const [result, updatedBattle, updatedPlayer] = await Promise.all([
      client.timeout(800).emitWithAck("useBattleItem", { combatantId: `hero:${identity.characterId}`, itemInstanceId: item.instanceId }),
      battleState,
      playerState
    ]);
    expect(result).toMatchObject({ ok: true, inventory: { items: [expect.objectContaining({ instanceId: item.instanceId, quantity: 1 })] } });
    expect(updatedBattle.combatants.find((actor) => actor.ownerPlayerId === identity.characterId)).toMatchObject({ hp: 71, ap: 3, injuries: ["bleeding"] });
    expect(updatedPlayer.character).toMatchObject({ hp: 71, severelyInjured: true, injuries: ["bleeding"] });
    expect((await pool!.query("SELECT hp FROM characters WHERE id=$1", [identity.characterId])).rows[0]!.hp).toBe(71);
  });

  it("rejects unauthenticated, foreign and enemy battle item requests without consuming inventory", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const identity = await createIdentity(auth, lifecycle, "item_owner", "ItemOwner");
    const other = await createIdentity(auth, lifecycle, "item_other", "ItemOther");
    const item = (await game.services.inventory.addItems(other.characterId, [{ itemId: "field-bandage", quantity: 2 }])).items[0]!;
    const client = await connectClient();
    const payload = { combatantId: `hero:${identity.characterId}`, itemInstanceId: item.instanceId };
    expect(await client.timeout(800).emitWithAck("useBattleItem", payload)).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    await authenticate(client, identity.token);
    game.services.world.movePlayer(identity.characterId, { x: 1320, y: 455 }, Date.now() + 10_000);
    const started = onceWithTimeout<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const battle = await started;
    expect(await client.timeout(800).emitWithAck("useBattleItem", { ...payload, combatantId: battle.combatants.find((actor) => !actor.ownerPlayerId)!.id }))
      .toMatchObject({ ok: false, code: "NOT_OWNER" });
    expect(await client.timeout(800).emitWithAck("useBattleItem", payload)).toMatchObject({ ok: false, code: "INVENTORY_ITEM_NOT_OWNED" });
    expect((await game.services.inventory.getSnapshot(other.characterId)).items[0]!.quantity).toBe(2);
    expect(game.services.battles.getSnapshot(identity.characterId)!.combatants.find((actor) => actor.ownerPlayerId === identity.characterId)!.ap).toBe(5);
  });

  it("serializes item use and waits for committed healing before reconnect saves", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const identity = await createIdentity(auth, lifecycle, "item_reconnect", "ItemReconnect");
    await pool!.query("UPDATE characters SET hp=41,x=1320,y=455 WHERE id=$1", [identity.characterId]);
    const item = (await game.services.inventory.addItems(identity.characterId, [{ itemId: "field-bandage", quantity: 2 }])).items[0]!;
    const client = await connectClient();
    const initialState = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    await authenticate(client, identity.token);
    await initialState;
    const started = onceWithTimeout<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    await started;
    let releaseResult!: () => void;
    const resultGate = new Promise<void>((resolve) => { releaseResult = resolve; });
    let markCommitted!: () => void;
    const committed = new Promise<void>((resolve) => { markCommitted = resolve; });
    const consume = game.services.inventory.consumeBattleItem.bind(game.services.inventory);
    vi.spyOn(game.services.inventory, "consumeBattleItem").mockImplementationOnce(async (...args) => {
      const result = await consume(...args);
      markCommitted();
      await resultGate;
      return result;
    });
    const payload = { combatantId: `hero:${identity.characterId}`, itemInstanceId: item.instanceId };
    client.emit("useBattleItem", payload, () => undefined);
    await committed;
    expect(await client.timeout(800).emitWithAck("useBattleItem", payload)).toMatchObject({ ok: false, code: "BATTLE_ACTION_PENDING" });
    const rejected = onceWithTimeout<{ code: string }>(client, "commandRejected");
    client.emit("battleCommand", { type: "endTurn", combatantId: payload.combatantId });
    expect((await rejected).code).toBe("BATTLE_ACTION_PENDING");
    const saved = vi.spyOn(lifecycle, "saveGameplayState");
    client.disconnect();
    const replacement = await connectClient();
    let markValidated!: () => void;
    const validated = new Promise<void>((resolve) => { markValidated = resolve; });
    const validateToken = auth.validateToken.bind(auth);
    vi.spyOn(auth, "validateToken").mockImplementationOnce(async (...args) => {
      const result = await validateToken(...args);
      setImmediate(markValidated);
      return result;
    });
    const restoredState = onceWithTimeout<PlayerStateSnapshot>(replacement, "playerState");
    const authenticated = replacement.emitWithAck("authenticate", { sessionToken: identity.token });
    try {
      await validated;
      expect(saved).not.toHaveBeenCalled();
    } finally {
      releaseResult();
    }
    expect(await authenticated).toMatchObject({ ok: true });
    expect(await restoredState).toMatchObject({ character: { hp: 71 }, inventory: { items: [expect.objectContaining({ quantity: 1 })] } });
    expect((await pool!.query("SELECT hp FROM characters WHERE id=$1", [identity.characterId])).rows[0]!.hp).toBe(71);
  });

  it("moves owned items into the eight-place rag bag and restores their placement after login", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const owner = await createIdentity(auth, lifecycle, "bag_owner", "BagOwner");
    const other = await createIdentity(auth, lifecycle, "bag_other", "BagOther");
    const inventory = await game.services.inventory.addItems(owner.characterId, [
      { itemId: "rag-bag", quantity: 1 }, { itemId: "wolf-pelt", quantity: 2 }
    ]);
    const bag = inventory.items.find((item) => item.itemId === "rag-bag")!;
    const item = inventory.items.find((item) => item.itemId === "wolf-pelt")!;
    const foreign = await giveTestContainer(game, other.characterId);
    const client = await connectClient();
    expect(await client.timeout(1000).emitWithAck("moveItemToContainer", { itemInstanceId: item.instanceId, targetContainerInstanceId: bag.instanceId }))
      .toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    const initial = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    await authenticate(client, owner.token); await initial;
    expect(bag.containerCapacity).toBe(8);
    const changed = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    expect(await client.timeout(1000).emitWithAck("moveItemToContainer", {
      itemInstanceId: item.instanceId, targetContainerInstanceId: bag.instanceId, characterId: other.characterId
    })).toMatchObject({ ok: true, inventory: { items: expect.arrayContaining([
      expect.objectContaining({ instanceId: item.instanceId, quantity: 2, containerInstanceId: bag.instanceId })
    ]) } });
    expect((await changed).inventory.items.find((entry) => entry.instanceId === item.instanceId)?.containerInstanceId).toBe(bag.instanceId);
    expect(await client.timeout(1000).emitWithAck("moveItemToContainer", {
      itemInstanceId: item.instanceId, targetContainerInstanceId: foreign
    })).toMatchObject({ ok: false, code: "CONTAINER_ITEM_NOT_OWNED" });
    const restored = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    await authenticate(client, owner.token);
    expect((await restored).inventory.items.find((entry) => entry.instanceId === item.instanceId)?.containerInstanceId).toBe(bag.instanceId);
    expect(await client.timeout(1000).emitWithAck("moveItemToContainer", {
      itemInstanceId: item.instanceId, targetContainerInstanceId: null
    })).toMatchObject({ ok: true, inventory: { items: expect.arrayContaining([
      expect.objectContaining({ instanceId: item.instanceId })
    ]) } });
    expect((await game.services.inventory.getSnapshot(owner.characterId)).items.find((entry) => entry.instanceId === item.instanceId)?.containerInstanceId).toBeUndefined();
  });

  it("persists four container slots using socket identity and rejects unrelated items", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const owner = await createIdentity(auth, lifecycle, "slot_owner", "SlotOwner");
    const other = await createIdentity(auth, lifecycle, "slot_other", "SlotOther");
    const container = await giveTestContainer(game, owner.characterId);
    const foreign = await giveTestContainer(game, other.characterId);
    const inventory = await game.services.inventory.addItems(owner.characterId, [{ itemId: "wolf-pelt", quantity: 1 }]);
    const material = inventory.items.find((item) => item.itemId === "wolf-pelt")!.instanceId;
    const client = await connectClient();
    expect(await client.timeout(1000).emitWithAck("setContainerSlot", { slotIndex: 0, itemInstanceId: container }))
      .toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    const initial = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    await authenticate(client, owner.token);
    await initial;
    const updated = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    const assigned: SetContainerSlotResult = await client.timeout(1000).emitWithAck("setContainerSlot", {
      slotIndex: 2, itemInstanceId: container, characterId: other.characterId
    });
    expect(assigned).toMatchObject({ ok: true, inventory: { containerSlots: [null, null, container, null] } });
    expect((await updated).inventory.containerSlots).toEqual([null, null, container, null]);
    expect((await game.services.inventory.getSnapshot(other.characterId)).containerSlots).toEqual([null, null, null, null]);
    expect(await client.timeout(1000).emitWithAck("setContainerSlot", { slotIndex: 2, itemInstanceId: material }))
      .toMatchObject({ ok: false, code: "ITEM_NOT_CONTAINER" });
    expect(await client.timeout(1000).emitWithAck("setContainerSlot", { slotIndex: 2, itemInstanceId: foreign }))
      .toMatchObject({ ok: false, code: "CONTAINER_ITEM_NOT_OWNED" });
    expect(await client.timeout(1000).emitWithAck("setContainerSlot", { slotIndex: 4, itemInstanceId: container }))
      .toMatchObject({ ok: false, code: "INVALID_CONTAINER_SLOT" });
    const restored = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    await authenticate(client, owner.token);
    const state = await restored;
    expect(state.inventory.containerSlots).toEqual([null, null, container, null]);
    expect(state.inventory.items.some((item) => item.instanceId === material)).toBe(true);
    expect(await client.timeout(1000).emitWithAck("setContainerSlot", { slotIndex: 2, itemInstanceId: null }))
      .toMatchObject({ ok: true, inventory: { containerSlots: [null, null, null, null] } });
  });

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
    expect(ended.experienceGained).toBe(40);
    expect(ended.character.experience).toBe(40);
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

  it("awards XP once, advances automatically and restores saved progression", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const identity = await createIdentity(auth, lifecycle, "owczy_progress", "ProgressHero");
    await lifecycle.saveGameplayState(identity.characterId, {
      locationId: "forest-settlement-01", x: 1320, y: 455,
      level: 1, experience: 80, hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
      severelyInjured: false, injuries: []
    });
    const client = await connectClient();
    const initialState = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    const playerId = await authenticate(client, identity.token);
    expect((await initialState).character.experience).toBe(80);

    const startedPromise = onceWithTimeout<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const started = await startedPromise;
    const ended = await winBattle(client, started, playerId);
    expect(ended).toMatchObject({
      outcome: "victory", experienceGained: 40, levelsGained: 1,
      character: {
        level: 2, experience: 120, maxHp: 130,
        statistics: { strength: 12, dexterity: 11, vitality: 13, meleeDamage: 22, armor: 2 }
      }
    });
    expect(ended.character.hp).toBeGreaterThan(30);
    const account = await new AccountRepository(pool!).findByNormalizedUsername("owczy_progress");
    expect(await lifecycle.getCharacter(account!.id)).toMatchObject({
      level: 2, experience: 120, hp: ended.character.hp, maxHp: 130
    });

    const rejected = onceWithTimeout<{ code: string }>(client, "commandRejected");
    client.emit("battleCommand", { type: "endTurn", combatantId: `hero:${playerId}` });
    expect((await rejected).code).toBe("BATTLE_NOT_FOUND");
    const restoredPromise = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");
    await authenticate(client, identity.token);
    expect((await restoredPromise).character).toEqual(ended.character);
  });

  it("finishes pending victory rewards before disconnect cleanup and preserves XP and gold", async () => {
    const { game, connectClient, auth, lifecycle } = await startTestServer();
    const identity = await createIdentity(auth, lifecycle, "owczy_disconnect", "OfflineHero");
    await lifecycle.saveGameplayState(identity.characterId, {
      locationId: "forest-settlement-01", x: 1320, y: 455,
      level: 1, experience: 80, hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
      severelyInjured: false, injuries: []
    });
    const client = await connectClient();
    const playerId = await authenticate(client, identity.token);
    let releaseLoot!: () => void;
    const lootGate = new Promise<void>((resolve) => { releaseLoot = resolve; });
    let markLootStarted!: () => void;
    const lootStarted = new Promise<void>((resolve) => { markLootStarted = resolve; });
    let markLootFinished!: () => void;
    const lootFinished = new Promise<void>((resolve) => { markLootFinished = resolve; });
    const addItems = game.services.inventory.addItems.bind(game.services.inventory);
    vi.spyOn(game.services.inventory, "addItems").mockImplementationOnce(async (...args) => {
      markLootStarted();
      await lootGate;
      try { return await addItems(...args); }
      finally { markLootFinished(); }
    });
    try {
      const started = onceWithTimeout<BattleSnapshot>(client, "battleStarted");
      client.emit("startEncounter", { encounterId: "wolf-pack-01" });
      let battle = await started;
      for (let step = 0; step < 160 && !battle.finished; step += 1) {
        const next = onceWithTimeout<BattleSnapshot>(client, "battleState");
        client.emit("battleCommand", choosePlayerCommand(battle, playerId));
        battle = await next;
      }
      expect(battle.finished).toBe(true);
      await lootStarted;
      const serverSocket=game.io.sockets.sockets.get(client.id!);
      if(!serverSocket)throw new Error("Authenticated server socket missing");
      const disconnected=new Promise<void>(resolve=>serverSocket.once("disconnect",()=>resolve()));
      client.disconnect();
      await disconnected;
      expect(game.services.characters.getSnapshot(playerId)).toMatchObject({level:2,experience:120});
      // Cleanup must wait for the durable reward transaction; unblock that transaction first.
      releaseLoot();
      await lootFinished;
      await vi.waitFor(() => expect(game.services.characters.getSnapshot(playerId)).toBeUndefined());
      const account = await new AccountRepository(pool!).findByNormalizedUsername("owczy_disconnect");
      expect(await lifecycle.getCharacter(account!.id)).toMatchObject({ level: 2, experience: 120 });
      expect(await game.services.merchant.getGold(playerId)).toBe(115);
    } finally {
      releaseLoot();
      await lootFinished;
    }
    expect((await game.services.inventory.getSnapshot(playerId)).items.some((item) => item.itemId === "wolf-pelt")).toBe(true);
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
      character: { hp: number; severelyInjured: boolean; injuries: string[]; experience: number };
      experienceGained?: number;
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
    expect(ended.character.experience).toBe(0);
    expect(ended.experienceGained).toBe(0);
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

    const initialFirstWorld = onceWithTimeout<WorldStateSnapshot>(first, "worldState");
    const firstPlayerId = await authenticate(first, firstIdentity.token);
    expect((await initialFirstWorld).players).toHaveLength(1);

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
