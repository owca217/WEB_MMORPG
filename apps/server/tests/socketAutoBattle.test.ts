import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { BattleSnapshot, PlayerStateSnapshot } from "@web-mmorpg/shared";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { createGameServer } from "../src/server/createGameServer";

type AutoSnapshot = BattleSnapshot & { autoBattle?: boolean };
type AutoResult = { ok: true; snapshot: AutoSnapshot } | { ok: false; code: string; message: string };
const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const pool = target && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/web_mmorpg_test" ? createPool(databaseUrl!) : null;
const describeDatabase = pool ? describe : describe.skip;
const clients: Socket[] = [];
let closeServer: (() => Promise<void>) | undefined;

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
function fingerprint(snapshot: BattleSnapshot): string {
  return JSON.stringify({ round: snapshot.round, active: snapshot.activeCombatantId, combatants: snapshot.combatants });
}
async function setAuto(socket: Socket, enabled: unknown): Promise<AutoResult> {
  return socket.timeout(1_000).emitWithAck("setBattleAuto", { enabled });
}
// An unchanged state over multiple scheduler periods proves that no background action runs.
function idlePeriods(stepMs: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, stepMs * 3)); }

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

async function setup(autoBattleStepMs = 10) {
  if (!pool) throw new Error("DATABASE_REQUIRED");
  const lifecycle = new CharacterLifecycleService(pool), auth = new AuthService(pool, new AccountRepository(pool), lifecycle);
  const http = createServer(), game = createGameServer(http, { pool, authService: auth, characterLifecycle: lifecycle, autoBattleStepMs });
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
    await auth.register("autohero", "correct-horse-battery-staple");
    const account = await new AccountRepository(pool).findByNormalizedUsername("autohero");
    const character = await lifecycle.createCharacter(account!.id, { nickname: "AutoHero", appearance: {} });
    await lifecycle.saveGameplayState(character.id, {
      locationId: "forest-settlement-01", x: 1290, y: 455, level: 1, experience: 0,
      hp: 100, maxHp: 100, maxAp: 5, initiative: 10, severelyInjured: false, injuries: []
    });
    const { token } = await auth.login("autohero", "correct-horse-battery-staple"), socket = await connect();
    await authenticate(socket, token);
    return { id: character.id, socket, token };
  };
  const start = async (socket: Socket, mode: "manual" | "auto" = "manual") => {
    const started = waitFor<AutoSnapshot>(socket, "battleStarted");
    socket.emit("startEncounter", { encounterId: "wolf-pack-01", mode });
    return started;
  };
  return { game, connect, authenticate, identity, start };
}

describeDatabase("authenticated automatic battle Socket.IO", () => {
  it("guards authentication, battle mode, range and automatic-mode payloads", async () => {
    const { game, connect, identity, start } = await setup(), unauthenticated = await connect();
    expect(await setAuto(unauthenticated, true)).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    const hero = await identity();
    const invalid = waitFor<{ code: string }>(hero.socket, "commandRejected");
    hero.socket.emit("startEncounter", { encounterId: "wolf-pack-01", mode: "instant-win" });
    expect((await invalid).code).toBe("INVALID_BATTLE_MODE");
    expect(game.services.battles.hasBattle(hero.id)).toBe(false);
    game.services.world.addPlayer({ id: hero.id, nickname: "AutoHero", x: 200, y: 200 });
    const tooFar = waitFor<{ code: string }>(hero.socket, "commandRejected");
    hero.socket.emit("startEncounter", { encounterId: "wolf-pack-01", mode: "auto" });
    expect((await tooFar).code).toBe("ENCOUNTER_OUT_OF_RANGE");
    expect(game.services.battles.hasBattle(hero.id)).toBe(false);
    game.services.world.addPlayer({ id: hero.id, nickname: "AutoHero", x: 1290, y: 455 });
    await start(hero.socket);
    expect(await setAuto(hero.socket, "true")).toMatchObject({ ok: false });
    expect(game.services.battles.getSnapshot(hero.id)?.autoBattle).not.toBe(true);
  });

  it("leaves manual encounters idle, then supports enabling auto and taking control without later auto actions", async () => {
    const stepMs = 35, { game, identity, start } = await setup(stepMs), hero = await identity();
    const manual = await start(hero.socket);
    await idlePeriods(stepMs);
    expect(game.services.battles.getSnapshot(hero.id)).toEqual(manual);
    const progressed = waitFor<AutoSnapshot>(hero.socket, "battleState", state => fingerprint(state) !== fingerprint(manual));
    expect(await setAuto(hero.socket, true)).toMatchObject({ ok: true, snapshot: { autoBattle: true } });
    expect((await progressed).autoBattle).toBe(true);
    const manualRejected = waitFor<{ code: string }>(hero.socket, "commandRejected");
    hero.socket.emit("battleCommand", { type: "endTurn", combatantId: `hero:${hero.id}` });
    expect((await manualRejected).code).toBe("AUTO_BATTLE_ACTIVE");
    const stopped = await setAuto(hero.socket, false);
    if (!stopped.ok) throw new Error(stopped.code);
    expect(stopped.snapshot.autoBattle).not.toBe(true);
    await idlePeriods(stepMs);
    expect(game.services.battles.getSnapshot(hero.id)).toEqual(stopped.snapshot);
    const afterManual = waitFor<AutoSnapshot>(hero.socket, "battleState");
    hero.socket.emit("battleCommand", { type: "endTurn", combatantId: `hero:${hero.id}` });
    expect(fingerprint(await afterManual)).not.toBe(fingerprint(stopped.snapshot));
  });

  it("finishes a real automatic encounter and persists the normal victory rewards once", async () => {
    const { game, identity, start } = await setup(), hero = await identity(), states: AutoSnapshot[] = [];
    hero.socket.on("battleState", state => states.push(state));
    const ended = waitFor<{ outcome: string; experienceGained: number; goldGained: number; inventory: PlayerStateSnapshot["inventory"] }>(hero.socket, "battleEnded");
    const initial = await start(hero.socket, "auto");
    expect(initial.autoBattle).toBe(true);
    const result = await ended;
    expect(result).toMatchObject({ outcome: "victory", experienceGained: 40, goldGained: 15 });
    expect(result.inventory.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "wolf-pelt", quantity: 1 }),
      expect.objectContaining({ itemId: "field-bandage", quantity: 2 })
    ]));
    expect(states.length).toBeGreaterThan(1);
    expect(states.some(state => fingerprint(state) !== fingerprint(initial))).toBe(true);
    expect(game.services.battles.hasBattle(hero.id)).toBe(false);
    expect(await game.services.merchant.getGold(hero.id)).toBe(115);
    expect((await pool!.query("SELECT experience FROM characters WHERE id=$1", [hero.id])).rows[0].experience).toBe(40);
    expect(await setAuto(hero.socket, true)).toMatchObject({ ok: false });
    expect((await pool!.query("SELECT COUNT(*)::int AS count FROM character_gold_rewards WHERE character_id=$1", [hero.id])).rows[0].count).toBe(1);
  });

  it("cancels a disconnected auto session before a reconnected manual encounter with the same battle ID", async () => {
    const stepMs = 40, { game, identity, connect, authenticate, start } = await setup(stepMs), hero = await identity();
    const progress = waitFor<AutoSnapshot>(hero.socket, "battleState");
    await start(hero.socket, "auto"); await progress;
    const serverSocket = game.io.sockets.sockets.get(hero.socket.id!);
    if (!serverSocket) throw new Error("SERVER_SOCKET_MISSING");
    const disconnected = new Promise<void>(resolve => serverSocket.once("disconnect", () => resolve()));
    hero.socket.disconnect(); await disconnected;
    await vi.waitFor(() => expect(game.services.battles.hasBattle(hero.id)).toBe(false));
    const replacement = await connect(); await authenticate(replacement, hero.token);
    const fresh = await start(replacement, "manual");
    await idlePeriods(stepMs);
    expect(game.services.battles.getSnapshot(hero.id)).toEqual(fresh);
    expect(fresh.autoBattle).not.toBe(true);
    expect(await game.services.merchant.getGold(hero.id)).toBe(100);
  });
});
