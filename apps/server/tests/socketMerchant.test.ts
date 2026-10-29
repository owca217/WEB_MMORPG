import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { BattleSnapshot, MerchantPurchase, MerchantResult, PlayerStateSnapshot, WorldStateSnapshot } from "@web-mmorpg/shared";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { createGameServer } from "../src/server/createGameServer";

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl && new URL(databaseUrl).pathname === "/web_mmorpg_test" ? createPool(databaseUrl) : null;
const describeDatabase = pool ? describe : describe.skip;
const clients: Socket[] = [];
let closeServer: (() => Promise<void>) | undefined;
const initialState = { locationId: "forest-settlement-01", x: 480, y: 420, level: 1, experience: 0, hp: 100, maxHp: 100, maxAp: 5, initiative: 10, severelyInjured: false, injuries: [] };

function waitFor<T>(socket: Socket, event: string, predicate: (value: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`TIMEOUT:${event}`)); }, 4_000);
    function listener(value: T) {
      if (!predicate(value)) return;
      clearTimeout(timer); socket.off(event, listener); resolve(value);
    }
    socket.on(event, listener);
  });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function order(quantity = 1): MerchantPurchase { return { npcId: "merchant-miro", requestId: randomUUID(), itemId: "field-bandage", quantity }; }
function shop(socket: Socket, npcId = "merchant-miro"): Promise<MerchantResult> { return socket.timeout(4_000).emitWithAck("requestMerchantShop", { npcId }); }
function buy(socket: Socket, payload = order()): Promise<MerchantResult> { return socket.timeout(4_000).emitWithAck("purchaseMerchantItem", payload); }

beforeAll(async () => {
  if (!pool) return;
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await runMigrations(pool); await seedItemMetadata(pool);
});
beforeEach(async () => { if (pool) await pool.query("TRUNCATE item_instances,accounts CASCADE"); });
afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await closeServer?.(); closeServer = undefined; vi.restoreAllMocks();
});
afterAll(async () => { await pool?.end(); });

async function setup() {
  if (!pool) throw new Error("DATABASE_REQUIRED");
  const lifecycle = new CharacterLifecycleService(pool), auth = new AuthService(pool, new AccountRepository(pool), lifecycle);
  const http = createServer(), game = createGameServer(http, { pool, authService: auth, characterLifecycle: lifecycle });
  await new Promise<void>(done => http.listen(0, "127.0.0.1", done));
  const connect = async () => {
    const socket = io(`http://127.0.0.1:${(http.address() as AddressInfo).port}`, { transports: ["websocket"], forceNew: true });
    clients.push(socket); await waitFor(socket, "connect"); return socket;
  };
  closeServer = async () => {
    await new Promise<void>(done => game.io.close(() => done()));
    if (http.listening) await new Promise<void>(done => http.close(() => done()));
  };
  const authenticate = async (socket: Socket, token: string) => {
    const state = waitFor<PlayerStateSnapshot>(socket, "playerState");
    expect(await socket.timeout(3_000).emitWithAck("authenticate", { sessionToken: token })).toMatchObject({ ok: true });
    return state;
  };
  const identity = async () => {
    await auth.register("alice", "correct-horse-battery-staple");
    const account = await new AccountRepository(pool).findByNormalizedUsername("alice");
    const character = await lifecycle.createCharacter(account!.id, { nickname: "Alice", appearance: {} });
    await lifecycle.saveGameplayState(character.id, initialState);
    const { token } = await auth.login("alice", "correct-horse-battery-staple"), socket = await connect();
    const state = await authenticate(socket, token);
    return { id: character.id, socket, token, state };
  };
  return { game, lifecycle, connect, authenticate, identity };
}

describeDatabase("authenticated merchant Socket.IO", () => {
  it("checks authentication, proximity, NPC role and battle state on reads and purchases", async () => {
    const { game, connect, identity } = await setup(), unauthenticated = await connect();
    expect(await shop(unauthenticated)).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    expect(await buy(unauthenticated)).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    const alice = await identity();
    game.services.world.addPlayer({ id: alice.id, nickname: "Alice", x: 100, y: 100 });
    expect(await shop(alice.socket)).toMatchObject({ ok: false, code: "NPC_OUT_OF_RANGE" });
    expect(await buy(alice.socket)).toMatchObject({ ok: false, code: "NPC_OUT_OF_RANGE" });
    game.services.world.addPlayer({ id: alice.id, nickname: "Alice", x: 610, y: 420 });
    expect(await shop(alice.socket, "guide-boran")).toMatchObject({ ok: false, code: "NPC_NOT_MERCHANT" });
    game.services.world.addPlayer({ id: alice.id, nickname: "Alice", x: 480, y: 420 });
    game.services.battles.startBattle(game.services.characters.getSnapshot(alice.id)!, "wolf-pack-01");
    expect(await shop(alice.socket)).toMatchObject({ ok: false, code: "BATTLE_IN_PROGRESS" });
    expect(await buy(alice.socket)).toMatchObject({ ok: false, code: "BATTLE_IN_PROGRESS" });
    expect(await game.services.merchant.getGold(alice.id)).toBe(100);
  });

  it("pushes the purchased inventory and gold, prevents replay, and reloads persisted gold after stale gameplay saves", async () => {
    const { identity, lifecycle, connect, authenticate } = await setup(), alice = await identity();
    expect(alice.state.gold).toBe(100);
    expect(await shop(alice.socket)).toMatchObject({ ok: true, shop: { gold: 100, npcId: "merchant-miro" } });
    const updated = waitFor<PlayerStateSnapshot>(alice.socket, "playerState", state => state.gold === 75);
    const request = order(5), result = await buy(alice.socket, request);
    expect(result).toMatchObject({ ok: true, shop: { gold: 75 }, inventory: { items: [expect.objectContaining({ itemId: "field-bandage", quantity: 5 })] } });
    expect((await updated).inventory).toEqual(result.ok ? result.inventory : undefined);
    expect(await buy(alice.socket, request)).toMatchObject({ ok: true, shop: { gold: 75 } });
    await lifecycle.saveGameplayState(alice.id, initialState);
    alice.socket.disconnect();
    const reconnected = await connect(), restored = await authenticate(reconnected, alice.token);
    expect(restored.gold).toBe(75);
    expect(restored.inventory.items).toEqual([expect.objectContaining({ itemId: "field-bandage", quantity: 5 })]);
    expect((await pool!.query("SELECT COUNT(*)::int AS count FROM merchant_purchase_receipts WHERE character_id=$1", [alice.id])).rows[0].count).toBe(1);
  });

  it("blocks movement, encounter starts and social mutations while a purchase is pending", async () => {
    const { identity, game } = await setup(), alice = await identity();
    const started = deferred(), release = deferred(), original = game.services.merchant.purchase.bind(game.services.merchant);
    vi.spyOn(game.services.merchant, "purchase").mockImplementation(async (...args) => {
      started.resolve(); await release.promise; return original(...args);
    });
    const pending = buy(alice.socket);
    await started.promise;
    try {
      alice.socket.emit("moveIntent", { x: 600, y: 420 });
      const world = waitFor<WorldStateSnapshot>(alice.socket, "worldState");
      alice.socket.emit("requestWorldState");
      expect((await world).players.find(player => player.id === alice.id)).toMatchObject({ x: 480, y: 420 });
      const rejected = waitFor<{ code: string }>(alice.socket, "commandRejected");
      alice.socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
      expect(await rejected).toMatchObject({ code: "MERCHANT_ACTION_PENDING" });
      expect(await alice.socket.timeout(3_000).emitWithAck("socialAction", { type: "leaveParty" })).toMatchObject({ ok: false, code: "MERCHANT_ACTION_PENDING" });
    } finally { release.resolve(); await pending; }
    expect(await game.services.merchant.getGold(alice.id)).toBe(95);
  });

  it("awards gold for each fresh victory exactly once and persists it across re-authentication", async () => {
    const { identity, game, connect, authenticate } = await setup(), alice = await identity();
    game.services.world.addPlayer({ id: alice.id, nickname: "Alice", x: 1290, y: 455 });
    for (const expectedGold of [115, 130]) {
      const started = waitFor<BattleSnapshot>(alice.socket, "battleStarted");
      alice.socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
      const battle = await started;
      vi.spyOn(game.services.battles, "applyCommand").mockReturnValue({
        result: { ok: true, state: {} as never }, snapshot: { ...battle, finished: true }, finished: true,
        victory: true, encounterId: "wolf-pack-01", seed: 12345,
        playerOutcome: { hp: 80, severelyInjured: false, injuries: [] }, experienceReward: 40
      });
      const ended = waitFor<{ goldGained?: number }>(alice.socket, "battleEnded");
      alice.socket.emit("battleCommand", { type: "endTurn", combatantId: battle.activeCombatantId });
      expect((await ended).goldGained).toBe(15);
      expect(await game.services.merchant.getGold(alice.id)).toBe(expectedGold);
      vi.restoreAllMocks();
    }
    expect((await pool!.query("SELECT COUNT(*)::int AS count FROM character_gold_rewards WHERE character_id=$1", [alice.id])).rows[0].count).toBe(2);
    alice.socket.disconnect();
    expect((await authenticate(await connect(), alice.token)).gold).toBe(130);
  });
});
