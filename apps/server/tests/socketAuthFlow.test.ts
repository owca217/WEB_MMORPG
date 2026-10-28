import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { BattleSnapshot, PlayerStateSnapshot, WorldStateSnapshot } from "@web-mmorpg/shared";
import { io as createClient, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { CharacterRepository } from "../src/persistence/CharacterRepository";
import { createGameServer } from "../src/server/createGameServer";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";
const pool = databaseUrl ? createPool(databaseUrl) : null;
const clients: Socket[] = [];
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
  vi.restoreAllMocks();
});

afterAll(async () => {
  await pool?.end();
});

async function createIdentity(username: string, nickname?: string, appearance: Record<string, unknown> = {}) {
  if (!pool) throw new Error("DATABASE_URL_REQUIRED");
  const lifecycle = new CharacterLifecycleService(pool);
  const auth = new AuthService(pool, new AccountRepository(pool), lifecycle);
  await auth.register(username, PASSWORD);
  const account = await new AccountRepository(pool).findByNormalizedUsername(username.toLowerCase());
  if (!account) throw new Error("ACCOUNT_NOT_CREATED");
  let characterId: string | undefined;
  if (nickname) {
    characterId = (await lifecycle.createCharacter(account.id, { nickname, appearance })).id;
  }
  const login = await auth.login(username, PASSWORD);
  return { auth, lifecycle, accountId: account.id, characterId, token: login.token };
}

async function startTestServer(auth: AuthService, lifecycle: CharacterLifecycleService) {
  if (!pool) throw new Error("DATABASE_URL_REQUIRED");
  const httpServer = createServer();
  const game = createGameServer(httpServer, {
    pool,
    authService: auth,
    characterLifecycle: lifecycle
  } as never);
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
  const socket = createClient(`http://127.0.0.1:${address.port}`, {
    transports: ["websocket"],
    forceNew: true
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return { game, socket, url: `http://127.0.0.1:${address.port}` };
}

function once<T>(socket: Socket, event: string, timeoutMs = 1500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describeDatabase("durable Socket.IO authentication", () => {
  it("serializes two account authentications on the same socket without orphaning either identity", async () => {
    const first = await createIdentity("parallel_first", "FirstHero");
    const second = await createIdentity("parallel_second", "SecondHero");
    const { game, socket } = await startTestServer(first.auth, first.lifecycle);
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    const read = first.lifecycle.getCharacter.bind(first.lifecycle);
    vi.spyOn(first.lifecycle, "getCharacter").mockImplementationOnce(async (...args) => {
      const character = await read(...args);
      markReadStarted();
      await readGate;
      return character;
    });
    const firstAuth = socket.emitWithAck("authenticate", { sessionToken: first.token });
    await readStarted;
    let markSecondValidated!: () => void;
    const secondValidated = new Promise<void>((resolve) => { markSecondValidated = resolve; });
    const validate = first.auth.validateToken.bind(first.auth);
    vi.spyOn(first.auth, "validateToken").mockImplementationOnce(async (...args) => {
      const session = await validate(...args);
      setImmediate(markSecondValidated);
      return session;
    });
    const secondAuth = socket.emitWithAck("authenticate", { sessionToken: second.token });
    try { await secondValidated; }
    finally { releaseRead(); }
    expect(await firstAuth).toMatchObject({ ok: true, characterId: first.characterId });
    expect(await secondAuth).toMatchObject({ ok: true, characterId: second.characterId });
    expect(game.services.connections.activeCount(first.accountId)).toBe(0);
    expect(game.services.connections.activeCount(second.accountId)).toBe(1);
    expect(game.services.world.getPlayer(first.characterId!)).toBeUndefined();
    expect(game.services.world.getPlayer(second.characterId!)).toBeDefined();
  });

  it("keeps a new battle when an old disconnected battle completion finishes its inventory read", async () => {
    const identity = await createIdentity("late_battle", "ReturningFighter");
    const characterId = identity.characterId!;
    await identity.lifecycle.saveGameplayState(characterId, {
      locationId: "forest-settlement-01", x: 1320, y: 455,
      level: 1, experience: 0, hp: 1, maxHp: 100, maxAp: 5, initiative: 10,
      severelyInjured: false, injuries: []
    });
    const { game, socket, url } = await startTestServer(identity.auth, identity.lifecycle);
    const initialState = once<PlayerStateSnapshot>(socket, "playerState");
    await socket.emitWithAck("authenticate", { sessionToken: identity.token });
    await initialState;
    const inventory = await game.services.inventory.getSnapshot(characterId);
    let releaseInventory!: () => void;
    const inventoryGate = new Promise<void>((resolve) => { releaseInventory = resolve; });
    let markInventoryStarted!: () => void;
    const inventoryStarted = new Promise<void>((resolve) => { markInventoryStarted = resolve; });
    const getInventory = game.services.inventory.getSnapshot.bind(game.services.inventory);
    let holdFirstRead = true;
    let released = false;
    vi.spyOn(game.services.inventory, "getSnapshot").mockImplementation(async (...args) => {
      if (holdFirstRead) {
        holdFirstRead = false;
        markInventoryStarted();
        await inventoryGate;
        return inventory;
      }
      return released ? inventory : getInventory(...args);
    });
    try {
      const started = once<BattleSnapshot>(socket, "battleStarted");
      socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
      let battle = await started;
      for (let step = 0; step < 20 && !battle.finished; step += 1) {
        const next = once<BattleSnapshot>(socket, "battleState");
        socket.emit("battleCommand", { type: "endTurn", combatantId: `hero:${characterId}` });
        battle = await next;
      }
      expect(battle.finished).toBe(true);
      await inventoryStarted;
      socket.disconnect();
      const replacement = createClient(url, { transports: ["websocket"], forceNew: true });
      clients.push(replacement);
      await new Promise<void>((resolve, reject) => {
        replacement.once("connect", resolve);
        replacement.once("connect_error", reject);
      });
      const restored = once<PlayerStateSnapshot>(replacement, "playerState");
      await replacement.emitWithAck("authenticate", { sessionToken: identity.token });
      await restored;
      game.services.world.movePlayer(characterId, { x: 1320, y: 455 }, Date.now() + 10_000);
      const restarted = once<BattleSnapshot>(replacement, "battleStarted");
      replacement.emit("startEncounter", { encounterId: "wolf-pack-01" });
      await restarted;
      released = true;
      releaseInventory();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(game.services.battles.hasBattle(characterId)).toBe(true);
      const next = once<BattleSnapshot>(replacement, "battleState");
      replacement.emit("battleCommand", { type: "endTurn", combatantId: `hero:${characterId}` });
      expect((await next).round).toBeGreaterThan(1);
    } finally {
      released = true;
      releaseInventory();
    }
  });

  it.each(["replacement", "reconnect"] as const)(
    "waits for the previous connection save before %s hydrates the character",
    async (mode) => {
      const identity = await createIdentity(`fast_${mode}`, "ReturningHero", {
        gender: "female", skinId: "female-guard"
      });
      const characterId = identity.characterId!;
      const { game, socket, url } = await startTestServer(identity.auth, identity.lifecycle);
      const initialState = once<PlayerStateSnapshot>(socket, "playerState");
      await socket.emitWithAck("authenticate", { sessionToken: identity.token });
      await initialState;
      game.services.world.movePlayer(characterId, { x: 640, y: 430 }, Date.now() + 10_000);
      game.services.characters.awardExperience(characterId, 180);
      game.services.characters.applyBattleResult(characterId, {
        hp: 73, severelyInjured: true, injuries: ["legTrauma"]
      });

      let releaseSave!: () => void;
      const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
      let markSaveStarted!: () => void;
      const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
      const save = identity.lifecycle.saveGameplayState.bind(identity.lifecycle);
      vi.spyOn(identity.lifecycle, "saveGameplayState").mockImplementationOnce(async (...args) => {
        markSaveStarted();
        await saveGate;
        await save(...args);
      });

      const replacement = createClient(url, { transports: ["websocket"], forceNew: true });
      clients.push(replacement);
      await new Promise<void>((resolve, reject) => {
        replacement.once("connect", resolve);
        replacement.once("connect_error", reject);
      });

      // Observe a real authentication attempt reaching its first DB validation.
      // setImmediate is an event-loop barrier, without assuming a save duration.
      let markValidated!: () => void;
      const validated = new Promise<void>((resolve) => { markValidated = resolve; });
      const validateToken = identity.auth.validateToken.bind(identity.auth);
      vi.spyOn(identity.auth, "validateToken").mockImplementationOnce(async (...args) => {
        const result = await validateToken(...args);
        setImmediate(markValidated);
        return result;
      });
      const readCharacter = vi.spyOn(identity.lifecycle, "getCharacter");
      if (mode === "reconnect") {
        socket.disconnect();
        await saveStarted;
      }
      const restoredState = once<PlayerStateSnapshot>(replacement, "playerState");
      const authenticated = replacement.emitWithAck("authenticate", { sessionToken: identity.token });
      let readsBeforeSave = 0;
      try {
        await validated;
        await saveStarted;
        readsBeforeSave = readCharacter.mock.calls.length;
      } finally {
        releaseSave();
      }
      expect(await authenticated).toMatchObject({ ok: true, characterId });
      const state = await restoredState;
      expect(readsBeforeSave).toBe(0);
      expect(state.character).toMatchObject({
        playerId: characterId, level: 2, experience: 180, hp: 73,
        appearance: { gender: "female", skinId: "female-guard" },
        severelyInjured: true, injuries: ["legTrauma"]
      });
      expect(game.services.world.getPlayer(characterId)).toMatchObject({ x: 640, y: 430 });
      expect(await new CharacterRepository(pool!).findById(characterId)).toMatchObject({
        level: 2, experience: 180, hp: 73, x: 640, y: 430
      });

      const world = once<WorldStateSnapshot>(replacement, "worldState");
      replacement.emit("moveIntent", { x: 639, y: 430 });
      expect((await world).players).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: characterId, x: expect.any(Number), y: 430 })
      ]));
      expect(game.services.connections.activeCount(identity.accountId)).toBe(1);
    }
  );

  it("hydrates persisted skins for the owner and broadcasts each appearance to nearby players", async () => {
    const owner = await createIdentity("skin_owner", "SkinOwner", { gender: "female", skinId: "female-scout" });
    const nearby = await createIdentity("skin_nearby", "SkinNearby", { gender: "male", skinId: "male-guard" });
    const { socket, url } = await startTestServer(owner.auth, owner.lifecycle);
    const ownerState = once<PlayerStateSnapshot>(socket, "playerState");
    await socket.emitWithAck("authenticate", { sessionToken: owner.token });
    expect((await ownerState).character.appearance).toEqual({ gender: "female", skinId: "female-scout" });

    const nearbySocket = createClient(url, { transports: ["websocket"], forceNew: true });
    clients.push(nearbySocket);
    await new Promise<void>((resolve, reject) => {
      nearbySocket.once("connect", resolve);
      nearbySocket.once("connect_error", reject);
    });
    const ownerWorld = once<WorldStateSnapshot>(socket, "worldState");
    const nearbyWorld = once<WorldStateSnapshot>(nearbySocket, "worldState");
    await nearbySocket.emitWithAck("authenticate", { sessionToken: nearby.token });

    for (const snapshot of await Promise.all([ownerWorld, nearbyWorld])) {
      expect(snapshot.players).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: owner.characterId, appearance: { gender: "female", skinId: "female-scout" } }),
        expect.objectContaining({ id: nearby.characterId, appearance: { gender: "male", skinId: "male-guard" } })
      ]));
    }
  });

  it("resolves identity only from the persistent session token and active character", async () => {
    const identity = await createIdentity("socket_player", "SocketHero");
    const { socket } = await startTestServer(identity.auth, identity.lifecycle);
    const playerStatePromise = once<PlayerStateSnapshot>(socket, "playerState");

    const result = await socket.emitWithAck("authenticate", {
      sessionToken: identity.token,
      accountId: "forged-account",
      characterId: "forged-character",
      role: "ADMIN",
      nickname: "ForgedHero"
    });

    expect(result).toEqual({
      ok: true,
      characterId: identity.characterId,
      locationId: "forest-settlement-01"
    });
    const state = await playerStatePromise;
    expect(state.character).toMatchObject({
      playerId: identity.characterId,
      nickname: "SocketHero"
    });
  });

  it("rejects invalid sessions and valid accounts without an active character", async () => {
    const identity = await createIdentity("no_character");
    const { socket } = await startTestServer(identity.auth, identity.lifecycle);

    expect(await socket.emitWithAck("authenticate", { sessionToken: "invalid-token" })).toMatchObject({
      ok: false,
      code: "INVALID_SESSION"
    });
    expect(await socket.emitWithAck("authenticate", { sessionToken: identity.token })).toMatchObject({
      ok: false,
      code: "CHARACTER_REQUIRED"
    });
  });

  it("persists world position and character combat state across disconnect/reconstruction", async () => {
    const identity = await createIdentity("persistent_socket", "PersistentHero");
    if (!identity.characterId) throw new Error("CHARACTER_NOT_CREATED");
    const { game, socket } = await startTestServer(identity.auth, identity.lifecycle);

    const result = await socket.emitWithAck("authenticate", { sessionToken: identity.token });
    if (!result.ok) throw new Error("SOCKET_AUTH_FAILED");

    game.services.world.movePlayer(identity.characterId, { x: 640, y: 430 }, Date.now() + 10_000);
    game.services.characters.applyBattleResult(identity.characterId, {
      hp: 73,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });
    socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const persisted = await new CharacterRepository(pool!).findById(identity.characterId);
    expect(persisted).toMatchObject({
      id: identity.characterId,
      hp: 73,
      severelyInjured: true,
      x: expect.any(Number),
      y: expect.any(Number)
    });
    expect(persisted?.x).toBeGreaterThan(360);
  });
});
