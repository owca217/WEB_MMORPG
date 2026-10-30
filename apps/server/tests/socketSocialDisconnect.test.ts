import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { PlayerStateSnapshot, SocialAction, SocialActionResult, SocialSnapshot } from "@web-mmorpg/shared";
import type { PoolClient } from "pg";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { createGameServer } from "../src/server/createGameServer";

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl?.endsWith("/web_mmorpg_test") ? createPool(databaseUrl) : null;
const describeDatabase = pool ? describe : describe.skip;
const clients: Socket[] = [];
let closeServer: (() => Promise<void>) | undefined;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function waitFor<T>(socket: Socket, event: string, predicate: (value: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`TIMEOUT:${event}`));
    }, 4_000);
    function listener(value: T) {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(value);
    }
    socket.on(event, listener);
  });
}

async function act(socket: Socket, action: SocialAction): Promise<SocialSnapshot> {
  const result: SocialActionResult = await socket.timeout(4_000).emitWithAck("socialAction", action);
  if (!result.ok) throw new Error(result.code);
  return result.social;
}

beforeAll(async () => {
  if (!pool) return;
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await runMigrations(pool);
  await seedItemMetadata(pool);
});
afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await closeServer?.();
  closeServer = undefined;
});
afterAll(async () => { await pool?.end(); });

describeDatabase("trade completion during second confirmer disconnect", () => {
  it("pushes the remaining player's committed inventory and persists the gift exactly once after COMMIT", async () => {
    if (!pool) throw new Error("DATABASE_REQUIRED");
    const lifecycle = new CharacterLifecycleService(pool);
    const auth = new AuthService(pool, new AccountRepository(pool), lifecycle);
    const http = createServer();
    const game = createGameServer(http, { pool, authService: auth, characterLifecycle: lifecycle });
    await new Promise<void>(done => http.listen(0, "127.0.0.1", done));
    closeServer = async () => {
      await new Promise<void>(done => game.io.close(() => done()));
      if (http.listening) await new Promise<void>(done => http.close(() => done()));
    };
    const connect = async () => {
      const socket = io(`http://127.0.0.1:${(http.address() as AddressInfo).port}`, {
        transports: ["websocket"], forceNew: true
      });
      clients.push(socket);
      await waitFor(socket, "connect");
      return socket;
    };
    const identity = async (name: string) => {
      await auth.register(name, "correct-horse-battery-staple");
      const account = await new AccountRepository(pool).findByNormalizedUsername(name);
      const character = await lifecycle.createCharacter(account!.id, { nickname: `Hero${name}`, appearance: {} });
      await lifecycle.saveGameplayState(character.id, {
        locationId: "forest-settlement-01", x: 1290, y: 455,
        level: 1, experience: 0, hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
        severelyInjured: false, injuries: []
      });
      const { token } = await auth.login(name, "correct-horse-battery-staple");
      const socket = await connect();
      const initialState = waitFor<PlayerStateSnapshot>(socket, "playerState");
      expect(await socket.timeout(2_000).emitWithAck("authenticate", { sessionToken: token })).toMatchObject({ ok: true });
      await initialState;
      return { id: character.id, socket, token };
    };
    const alice = await identity("alice"), bob = await identity("bob");
    const gift = (await game.services.inventory.addItems(alice.id, [{ itemId: "wolf-pelt", quantity: 2 }])).items.find(item=>item.itemId==="wolf-pelt")!;
    const trade = (await act(alice.socket, { type: "requestTrade", playerId: bob.id })).trade!;
    await act(bob.socket, { type: "respondTrade", tradeId: trade.id, accept: true });
    const offered = (await act(alice.socket, {
      type: "setTradeOffer", tradeId: trade.id, revision: 0,
      items: [{ instanceId: gift.instanceId, quantity: 2 }]
    })).trade!;
    await act(alice.socket, { type: "confirmTrade", tradeId: trade.id, revision: offered.revision });

    const committed = deferred(), releaseCommit = deferred();
    let gateUsed = false;
    type Query = (...args: unknown[]) => unknown;
    const originals = new Map<PoolClient, PoolClient["query"]>();
    const wrapAcquiredClient = (client: PoolClient) => {
      if (originals.has(client)) return;
      const originalQuery = client.query;
      originals.set(client, originalQuery);
      const query = originalQuery.bind(client) as Query;
      let insertedReceipt = false;
      client.query = ((...args: unknown[]) => {
        const sql = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string } | undefined)?.text ?? "";
        if (/INSERT INTO trade_receipts/i.test(sql)) insertedReceipt = true;
        if (sql.trim().toUpperCase() !== "COMMIT" || !insertedReceipt || gateUsed) return query(...args);
        gateUsed = true;
        // Preserve pg's callback form while delaying only the successful COMMIT response.
        const last = args[args.length - 1];
        const callback = typeof last === "function" ? args.pop() as (error: unknown, result?: unknown) => void : undefined;
        const result = Promise.resolve(query(...args)).then(async value => {
          committed.resolve();
          await releaseCommit.promise;
          return value;
        });
        if (!callback) return result;
        void result.then(value => callback(null, value), error => callback(error));
        return undefined;
      }) as PoolClient["query"];
    };
    pool.on("acquire", wrapAcquiredClient);
    try {
      const updatedAlice = waitFor<PlayerStateSnapshot>(alice.socket, "playerState");
      const completedAlice = waitFor<SocialSnapshot>(alice.socket, "socialState", value => value.trade?.id === trade.id && value.trade.status === "completed");
      bob.socket.emit("socialAction", { type: "confirmTrade", tradeId: trade.id, revision: offered.revision }, () => undefined);
      await committed.promise;
      // A separate connection sees the actual committed receipt before the service resumes.
      expect((await pool.query("SELECT COUNT(*)::int AS count FROM trade_receipts WHERE trade_id=$1", [trade.id])).rows[0].count).toBe(1);
      const serverBob = game.io.sockets.sockets.get(bob.socket.id!);
      if (!serverBob) throw new Error("BOB_SOCKET_NOT_FOUND");
      const disconnected = deferred();
      serverBob.once("disconnect", () => disconnected.resolve());
      bob.socket.disconnect();
      await disconnected.promise;
      expect(serverBob.connected).toBe(false);
      releaseCommit.resolve();

      const aliceState = await updatedAlice;
      expect(aliceState.inventory.items.find(item => item.instanceId === gift.instanceId)).toBeUndefined();
      expect((await completedAlice).trade?.status).toBe("completed");
      expect((await pool.query("SELECT character_id,quantity FROM item_instances WHERE id=$1", [gift.instanceId])).rows)
        .toEqual([{ character_id: bob.id, quantity: 2 }]);

      const replacement = await connect();
      const reloadedState = waitFor<PlayerStateSnapshot>(replacement, "playerState");
      expect(await replacement.timeout(4_000).emitWithAck("authenticate", { sessionToken: bob.token })).toMatchObject({ ok: true });
      expect((await reloadedState).inventory.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ instanceId: gift.instanceId, itemId: "wolf-pelt", quantity: 2 })
      ]));
      expect((await act(alice.socket, { type: "confirmTrade", tradeId: trade.id, revision: offered.revision })).trade?.status).toBe("completed");
      expect(await replacement.timeout(2_000).emitWithAck("socialAction", {
        type: "confirmTrade", tradeId: trade.id, revision: offered.revision
      })).toMatchObject({ ok: false, code: "TRADE_NOT_FOUND" });
      expect((await pool.query("SELECT COUNT(*)::int AS count FROM trade_receipts")).rows[0].count).toBe(1);
      expect((await pool.query("SELECT character_id,quantity FROM item_instances WHERE item_id=(SELECT item_id FROM item_instances WHERE id=$1)", [gift.instanceId])).rows)
        .toEqual([{ character_id: bob.id, quantity: 2 }]);
    } finally {
      releaseCommit.resolve();
      pool.off("acquire", wrapAcquiredClient);
      for (const [client, query] of originals) client.query = query;
    }
  }, 15_000);
});
