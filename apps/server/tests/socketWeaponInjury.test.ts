import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { PlayerStateSnapshot, WeaponInjuryUpgradeRequest, WeaponInjuryUpgradeResult } from "@web-mmorpg/shared";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { createGameServer } from "../src/server/createGameServer";

const url = process.env.DATABASE_URL, target = url ? new URL(url) : null;
const pool = target && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/web_mmorpg_test" ? createPool(url!) : null;
const describeDb = pool ? describe : describe.skip;
const clients: Socket[] = [];
let closeServer: (() => Promise<void>) | undefined;
function waitFor<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`TIMEOUT:${event}`)); }, 4000);
    function listener(value: T) { clearTimeout(timer); socket.off(event, listener); resolve(value); }
    socket.on(event, listener);
  });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const apply = (socket: Socket, request: WeaponInjuryUpgradeRequest): Promise<WeaponInjuryUpgradeResult> => socket.timeout(4000).emitWithAck("applyWeaponInjury", request);
beforeAll(async () => { if (pool) { await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); await runMigrations(pool); await seedItemMetadata(pool); } });
beforeEach(async () => { if (pool) await pool.query("TRUNCATE item_instances,accounts CASCADE"); });
afterEach(async () => { clients.splice(0).forEach(socket => socket.disconnect()); await closeServer?.(); closeServer = undefined; vi.restoreAllMocks(); });
afterAll(async () => { await pool?.end(); });

async function setup() {
  if (!pool) throw new Error("DATABASE_REQUIRED");
  const lifecycle = new CharacterLifecycleService(pool), auth = new AuthService(pool, new AccountRepository(pool), lifecycle);
  const http = createServer(), game = createGameServer(http, { pool, authService: auth, characterLifecycle: lifecycle });
  await new Promise<void>(done => http.listen(0, "127.0.0.1", done));
  closeServer = async () => { await new Promise<void>(done => game.io.close(() => done())); if (http.listening) await new Promise<void>(done => http.close(() => done())); };
  const connect = async () => { const socket = io(`http://127.0.0.1:${(http.address() as AddressInfo).port}`, { transports: ["websocket"], forceNew: true }); clients.push(socket); await waitFor(socket, "connect"); return socket; };
  const authenticate = async (socket: Socket, token: string) => {
    const state = waitFor<PlayerStateSnapshot>(socket, "playerState");
    expect(await socket.timeout(3000).emitWithAck("authenticate", { sessionToken: token })).toMatchObject({ ok: true });
    return state;
  };
  async function identity(username = "alice") {
    await auth.register(username, "correct-horse-battery-staple");
    const account = await new AccountRepository(pool!).findByNormalizedUsername(username);
    const character = await lifecycle.createCharacter(account!.id, { nickname: username, appearance: {} });
    const { token } = await auth.login(username, "correct-horse-battery-staple"), socket = await connect();
    await authenticate(socket, token);
    return { id: character.id, socket, token };
  }
  async function fixture(id: string) {
    const inventory = await game.services.inventory.addItems(id, [{ itemId: "training-sword", quantity: 1 }, { itemId: "injury-stone", quantity: 2 }]);
    const weaponInstanceId = inventory.items.find(item => item.itemId === "training-sword")!.instanceId;
    await pool!.query("UPDATE item_instances SET quality='EXCELLENT' WHERE id=$1", [weaponInstanceId]);
    expect(await clients[0]!.timeout(3000).emitWithAck("setEquipmentSlot", { slot: "mainHand", itemInstanceId: weaponInstanceId })).toMatchObject({ ok: true });
    return { requestId: randomUUID(), weaponInstanceId, stoneInstanceId: inventory.items.find(item => item.itemId === "injury-stone")!.instanceId };
  }
  return { game, identity, connect, authenticate, fixture };
}

describeDb("authenticated weapon injury socket action", () => {
  it("checks authentication, battle and open trade and refreshes the equipped weapon across retries and reconnect", async () => {
    const { game, identity, connect, authenticate, fixture } = await setup();
    const alice = await identity(), request = await fixture(alice.id), bob = await identity("bob");
    expect(await apply(await connect(), request)).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    game.services.battles.startBattle(game.services.characters.getSnapshot(alice.id)!, "wolf-pack-01");
    expect(await apply(alice.socket, request)).toMatchObject({ ok: false, code: "BATTLE_IN_PROGRESS" });
    game.services.battles.removeBattleForPlayer(alice.id);
    const trade = await game.services.social.trades.request(alice.id, bob.id);
    expect(await apply(alice.socket, request)).toMatchObject({ ok: false, code: "TRADE_IN_PROGRESS" });
    await game.services.social.trades.cancel(alice.id, trade.id);
    const result = await apply(alice.socket, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.equipment?.mainHand?.injuryUpgrade).toEqual(result.upgrade);
    expect(result.inventory.items.find(item => item.instanceId === request.stoneInstanceId)?.quantity).toBe(1);
    expect(await apply(alice.socket, request)).toMatchObject({ ok: true, upgrade: result.upgrade });
    alice.socket.disconnect();
    const restored = await authenticate(await connect(), alice.token);
    expect(restored.character.equipment?.mainHand?.injuryUpgrade).toEqual(result.upgrade);
  });

  it("reserves equipment mutations and battle starts while pending, then rejects a replaced session before commit", async () => {
    const { game, identity, connect, authenticate, fixture } = await setup();
    const alice = await identity(), request = await fixture(alice.id);
    const entered = deferred(), release = deferred(), original = game.services.weaponInjuryUpgrades.apply.bind(game.services.weaponInjuryUpgrades);
    vi.spyOn(game.services.weaponInjuryUpgrades, "apply").mockImplementation(async (...args) => { entered.resolve(); await release.promise; return original(...args); });
    const pending = apply(alice.socket, request).catch(() => undefined);
    await entered.promise;
    expect(await alice.socket.timeout(3000).emitWithAck("setEquipmentSlot", { slot: "mainHand", itemInstanceId: null })).toMatchObject({ ok: false, code: "EQUIPMENT_ACTION_PENDING" });
    expect(await apply(alice.socket, request)).toMatchObject({ ok: false, code: "EQUIPMENT_ACTION_PENDING" });
    expect(await alice.socket.timeout(3000).emitWithAck("socialAction", { type: "leaveParty" })).toMatchObject({ ok: false, code: "EQUIPMENT_ACTION_PENDING" });
    const rejected = waitFor<{ code: string }>(alice.socket, "commandRejected");
    alice.socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
    expect(await rejected).toMatchObject({ code: "EQUIPMENT_ACTION_PENDING" });
    const disconnected = new Promise<void>(resolve => alice.socket.once("disconnect", () => resolve()));
    const next = await connect();
    const reauth = authenticate(next, alice.token);
    // Authentication invalidates the previous owner before waiting for its pending operation.
    await disconnected;
    release.resolve();
    await pending; await reauth;
    const items = (await game.services.inventory.getSnapshot(alice.id)).items;
    expect(items.find(item => item.instanceId === request.stoneInstanceId)?.quantity).toBe(2);
    expect(items.find(item => item.instanceId === request.weaponInstanceId)?.injuryUpgrade).toBeUndefined();
  });
});
