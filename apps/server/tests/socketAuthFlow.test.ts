import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { PlayerStateSnapshot } from "@web-mmorpg/shared";
import { io as createClient, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
});

afterAll(async () => {
  await pool?.end();
});

async function createIdentity(username: string, nickname?: string) {
  if (!pool) throw new Error("DATABASE_URL_REQUIRED");
  const lifecycle = new CharacterLifecycleService(pool);
  const auth = new AuthService(pool, new AccountRepository(pool), lifecycle);
  await auth.register(username, PASSWORD);
  const account = await new AccountRepository(pool).findByNormalizedUsername(username.toLowerCase());
  if (!account) throw new Error("ACCOUNT_NOT_CREATED");
  let characterId: string | undefined;
  if (nickname) {
    characterId = (await lifecycle.createCharacter(account.id, { nickname, appearance: {} })).id;
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
  return { game, socket };
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
