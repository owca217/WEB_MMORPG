import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  getTotalExperienceForLevel, MAX_CHARACTER_LEVEL,
  type BattleSnapshot, type CharacterSnapshot, type EquipmentSlot, type EquipmentUpdateResult,
  type InventorySnapshot, type PlayerStateSnapshot, type SocialAction, type SocialActionResult,
  type SocialSnapshot, type WorldStateSnapshot
} from "@web-mmorpg/shared";
import type { PoolClient } from "pg";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import type { AppliedBattleCommand } from "../src/battle/BattleService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { createGameServer } from "../src/server/createGameServer";

interface BattleEnded {
  outcome: string;
  experienceGained: number;
  character: CharacterSnapshot;
  inventory: InventorySnapshot;
}
const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const pool = target && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/web_mmorpg_test" ? createPool(databaseUrl!) : null;
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
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`TIMEOUT:${event}`)); }, 4_000);
    function listener(value: T) {
      if (!predicate(value)) return;
      clearTimeout(timer); socket.off(event, listener); resolve(value);
    }
    socket.on(event, listener);
  });
}
const equipment = (socket: Socket, slot: EquipmentSlot, itemInstanceId: string | null): Promise<EquipmentUpdateResult> =>
  socket.timeout(3_000).emitWithAck("setEquipmentSlot", { slot, itemInstanceId });
const training = (character: CharacterSnapshot) => character.weaponTraining!.experience;
const totalTraining = (character: CharacterSnapshot) => Object.values(training(character)).reduce((sum, value) => sum + value, 0);

beforeAll(async () => {
  if (!pool) return;
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await runMigrations(pool); await seedItemMetadata(pool);
});
beforeEach(async () => { if (pool) await pool.query("TRUNCATE item_instances,accounts,encounter_respawns CASCADE"); });
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
  const identity = async (name = "AutoHero", experience = 0) => {
    await auth.register(name, "correct-horse-battery-staple");
    const account = await new AccountRepository(pool).findByNormalizedUsername(name.toLowerCase());
    const character = await lifecycle.createCharacter(account!.id, { nickname: name, appearance: {} });
    await lifecycle.saveGameplayState(character.id, {
      locationId: "forest-settlement-01", x: 1290, y: 455, level: 1, experience,
      hp: 100, maxHp: 100, maxAp: 5, initiative: 10, severelyInjured: false, injuries: []
    });
    const { token } = await auth.login(name, "correct-horse-battery-staple"), socket = await connect();
    const initial = await authenticate(socket, token);
    return { id: character.id, socket, token, initial };
  };
  const grant = async (id: string, ...itemIds: string[]) => {
    const snapshot = await game.services.inventory.addItems(id, itemIds.map(itemId => ({ itemId, quantity: 1 })));
    return Object.fromEntries(itemIds.map(itemId => [itemId, snapshot.items.find(item => item.itemId === itemId)!]));
  };
  const start = async (socket: Socket, mode: "manual" | "auto" = "manual") => {
    const started = waitFor<BattleSnapshot>(socket, "battleStarted");
    socket.emit("startEncounter", { encounterId: "wolf-pack-01", mode });
    return started;
  };
  const disconnect = async (socket: Socket) => {
    const serverSocket = game.io.sockets.sockets.get(socket.id!);
    if (!serverSocket) throw new Error("SERVER_SOCKET_MISSING");
    const disconnected = new Promise<void>(resolve => serverSocket.once("disconnect", () => resolve()));
    socket.disconnect(); await disconnected;
  };
  return { game, auth, connect, authenticate, identity, grant, start, disconnect, lifecycle };
}

describeDatabase("equipment and battle training Socket.IO", () => {
  it("rejects anonymous equipment changes and deprecated style choices without mutating saved proficiency", async () => {
    const { game, connect, identity, authenticate, disconnect } = await setup(), guest = await connect();
    expect(await equipment(guest, "mainHand", null)).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    expect(await guest.timeout(1_000).emitWithAck("setWeaponLoadout", { melee: "axe", ranged: "crossbow" })).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    const hero = await identity();
    game.services.characters.trainWeapon(hero.id, "axe", 17);
    hero.socket.emit("moveIntent", { x: 1300, y: 455 });
    const before = game.services.characters.getSnapshot(hero.id)!;
    for (const loadout of [{ melee: "axe", ranged: "crossbow" }, { melee: "bow", ranged: "sword" }]) {
      expect(await hero.socket.timeout(1_000).emitWithAck("setWeaponLoadout", loadout)).toMatchObject({ ok: false, code: "WEAPON_STYLES_REMOVED" });
    }
    expect(game.services.characters.getSnapshot(hero.id)).toEqual(before);
    await disconnect(hero.socket);
    const restored = await authenticate(await connect(), hero.token);
    expect(training(restored.character).axe).toBe(17);
    expect(restored.character.equipment?.mainHand).toBeNull();
    expect(restored.character.statistics).toMatchObject({ meleeEnabled: true, rangedEnabled: false, rangedDamage: 0 });
  });

  it("equips only owned compatible weapons and armor, preserves their stats on reconnect and blocks changes in battle", async () => {
    const { game, identity, grant, start, connect, authenticate, disconnect } = await setup(), hero = await identity(), other = await identity("OtherHero");
    const gear = await grant(hero.id, "training-sword", "cloth-chest"), foreign = await grant(other.id, "training-axe");
    expect(await equipment(hero.socket, "chest", gear["training-sword"]!.instanceId)).toMatchObject({ ok: false, code: "EQUIPMENT_SLOT_MISMATCH" });
    expect(await equipment(hero.socket, "mainHand", foreign["training-axe"]!.instanceId)).toMatchObject({ ok: false, code: "EQUIPMENT_ITEM_NOT_OWNED" });
    expect(await equipment(hero.socket, "mainHand", gear["training-sword"]!.instanceId)).toMatchObject({ ok: true, character: { equipment: { mainHand: { itemId: "training-sword" } }, statistics: { meleeDamage: 32, rangedEnabled: false } } });
    expect(await equipment(hero.socket, "chest", gear["cloth-chest"]!.instanceId)).toMatchObject({ ok: true, character: { statistics: { armor: 3, meleeDamage: 32 } } });
    await disconnect(hero.socket);
    const replacement = await connect(), restored = await authenticate(replacement, hero.token);
    expect(restored.inventory.equipmentSlots).toMatchObject({ mainHand: gear["training-sword"]!.instanceId, chest: gear["cloth-chest"]!.instanceId });
    expect(restored.character.equipment?.chest?.instanceId).toBe(gear["cloth-chest"]!.instanceId);
    expect(restored.character.statistics).toMatchObject({ armor: 3, meleeDamage: 32, rangedEnabled: false });
    await start(replacement);
    expect(await equipment(replacement, "mainHand", null)).toMatchObject({ ok: false, code: "BATTLE_IN_PROGRESS" });
    expect((await game.services.inventory.getSnapshot(hero.id)).equipmentSlots?.mainHand).toBe(gear["training-sword"]!.instanceId);
  });

  it("awards half of a real Auto victory only at settlement and only to weapon families actually used", async () => {
    const { game, identity, grant, start, connect, authenticate, disconnect } = await setup(), hero = await identity();
    const gear = await grant(hero.id, "training-sword", "training-shield", "training-bow", "training-staff");
    expect(await equipment(hero.socket, "mainHand", gear["training-sword"]!.instanceId)).toMatchObject({ ok: true });
    expect(await equipment(hero.socket, "offHand", gear["training-shield"]!.instanceId)).toMatchObject({ ok: true });
    const original = game.services.battles.applyAutoCommand.bind(game.services.battles);
    let terminal: AppliedBattleCommand | undefined, acceptedActions = 0;
    vi.spyOn(game.services.battles, "applyAutoCommand").mockImplementation(id => {
      const applied = original(id);
      if (applied.result.ok) {
        acceptedActions++;
        // Battle actions, including the lethal one, must never award their own +1 XP.
        expect(totalTraining(game.services.characters.getSnapshot(id)!)).toBe(0);
        if (applied.finished) terminal = applied;
      }
      return applied;
    });
    const ended = waitFor<BattleEnded>(hero.socket, "battleEnded");
    await start(hero.socket, "auto");
    const result = await ended, used = terminal?.usedWeaponFamilies?.[hero.id];
    expect(result).toMatchObject({ outcome: "victory", experienceGained: 40 });
    expect(acceptedActions).toBeGreaterThan(1);
    expect(used).toEqual(expect.arrayContaining(["sword", "shield"]));
    expect(totalTraining(result.character)).toBe(Math.floor(result.experienceGained / 2));
    expect(training(result.character)).toMatchObject({ sword: 10, shield: 10, bow: 0, crossbow: 0, axe: 0, staff: 0 });
    const replayRejected = waitFor<{ code: string }>(hero.socket, "commandRejected");
    hero.socket.emit("battleCommand", { type: "endTurn", combatantId: `hero:${hero.id}` });
    expect((await replayRejected).code).toBe("BATTLE_NOT_FOUND");
    expect(game.services.characters.getSnapshot(hero.id)?.experience).toBe(40);
    expect(training(game.services.characters.getSnapshot(hero.id)!)).toEqual(training(result.character));
    await disconnect(hero.socket);
    const restored = await authenticate(await connect(), hero.token);
    expect(training(restored.character)).toEqual(training(result.character));
    expect(restored.character.experience).toBe(40);
  });

  it("grants combat experience for a real bare-hand victory without training phantom saved styles or carried gear", async () => {
    const { identity, grant, start } = await setup(), hero = await identity();
    await grant(hero.id, "training-axe", "training-bow", "training-staff", "training-shield");
    const ended = waitFor<BattleEnded>(hero.socket, "battleEnded");
    await start(hero.socket, "auto");
    const result = await ended;
    expect(result).toMatchObject({ outcome: "victory", experienceGained: 40 });
    expect(totalTraining(result.character)).toBe(0);
    expect(result.character.equipment?.mainHand).toBeNull();
  });

  it("uses final capped combat XP, splits its half budget and refuses a duplicate command while settlement is pending", async () => {
    const cap = getTotalExperienceForLevel(MAX_CHARACTER_LEVEL);
    const { game, identity, grant, start, lifecycle } = await setup(), hero = await identity("CappedHero", cap - 7);
    const gear = await grant(hero.id, "training-sword", "training-shield");
    await equipment(hero.socket, "mainHand", gear["training-sword"]!.instanceId);
    await equipment(hero.socket, "offHand", gear["training-shield"]!.instanceId);
    const battle = await start(hero.socket), entered = deferred(), release = deferred();
    const applied: AppliedBattleCommand = {
      result: { ok: true, state: {} as never }, snapshot: { ...battle, finished: true }, finished: true, victory: true,
      participantIds: [hero.id], initialParticipantCount: 1, usedWeaponFamilies: { [hero.id]: ["shield", "sword", "sword"] },
      playerOutcomes: { [hero.id]: { hp: 80, severelyInjured: false, injuries: [] } }, experienceReward: 31
    };
    const apply = vi.spyOn(game.services.battles, "applyCommand").mockReturnValue(applied);
    const save = lifecycle.saveGameplayState.bind(lifecycle);
    vi.spyOn(lifecycle, "saveGameplayState").mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; await save(...args); });
    const ended = waitFor<BattleEnded>(hero.socket, "battleEnded");
    try {
      hero.socket.emit("battleCommand", { type: "endTurn", combatantId: `hero:${hero.id}` });
      await entered.promise;
      expect(game.services.characters.getSnapshot(hero.id)?.experience).toBe(cap);
      expect(training(game.services.characters.getSnapshot(hero.id)!)).toMatchObject({ sword: 2, shield: 1, staff: 0 });
      const rejected = waitFor<{ code: string }>(hero.socket, "commandRejected");
      hero.socket.emit("battleCommand", { type: "endTurn", combatantId: `hero:${hero.id}` });
      expect((await rejected).code).toBe("BATTLE_ACTION_PENDING");
      expect(apply).toHaveBeenCalledTimes(1);
      release.resolve();
      const result = await ended;
      expect(result.experienceGained).toBe(7);
      expect(totalTraining(result.character)).toBe(3);
      const stored = (await pool!.query("SELECT experience,weapon_training FROM characters WHERE id=$1", [hero.id])).rows[0];
      expect(stored.experience).toBe(cap);
      expect(stored.weapon_training.experience).toMatchObject({ sword: 2, shield: 1, staff: 0 });
    } finally { release.resolve(); }
  });

  it("registers a gear operation before waiting for an older movement save and blocks admission and a second gear request", async () => {
    const { game, identity, grant, lifecycle } = await setup(), hero = await identity();
    const gear = await grant(hero.id, "training-sword", "training-axe"), entered = deferred(), release = deferred();
    const original = lifecycle.saveGameplayState.bind(lifecycle);
    vi.spyOn(lifecycle, "saveGameplayState").mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; await original(...args); });
    const setSlot = vi.spyOn(game.services.equipment, "setSlot");
    const moved = waitFor<WorldStateSnapshot>(hero.socket, "worldState", snapshot => snapshot.players.some(player => player.id === hero.id && player.x > 1290));
    hero.socket.emit("moveIntent", { x: 1300, y: 455 }); await entered.promise; await moved;
    const changing = equipment(hero.socket, "mainHand", gear["training-sword"]!.instanceId);
    try {
      const rejected = waitFor<{ code: string }>(hero.socket, "commandRejected");
      hero.socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
      expect((await rejected).code).toBe("EQUIPMENT_ACTION_PENDING");
      expect(await equipment(hero.socket, "mainHand", gear["training-axe"]!.instanceId)).toMatchObject({ ok: false, code: "EQUIPMENT_ACTION_PENDING" });
      expect(setSlot).not.toHaveBeenCalled();
      release.resolve(); expect(await changing).toMatchObject({ ok: true, character: { equipment: { mainHand: { itemId: "training-sword" } } } });
    } finally { release.resolve(); }
  });

  it("acknowledges committed equipment and reconnects while an old presentation read is still held", async () => {
    const { game, identity, grant, connect, authenticate, disconnect } = await setup(), hero = await identity();
    const gear = await grant(hero.id, "training-axe"), entered = deferred(), release = deferred();
    const original = game.services.inventory.getSnapshot.bind(game.services.inventory);
    let held = false;
    vi.spyOn(game.services.inventory, "getSnapshot").mockImplementation(async (...args) => {
      const snapshot = await original(...args);
      if (!args[1] && !held) { held = true; entered.resolve(); await release.promise; }
      return snapshot;
    });
    try {
      expect(await hero.socket.timeout(1_000).emitWithAck("setEquipmentSlot", { slot: "mainHand", itemInstanceId: gear["training-axe"]!.instanceId })).toMatchObject({ ok: true });
      await entered.promise; await disconnect(hero.socket);
      const restored = await authenticate(await connect(), hero.token);
      expect(restored.character.equipment?.mainHand?.instanceId).toBe(gear["training-axe"]!.instanceId);
      expect(restored.character.statistics?.meleeDamage).toBe(35);
    } finally { release.resolve(); }
  });

  it("waits for an equipment COMMIT response across disconnect before hydrating the replacement connection", async () => {
    const { game, auth, identity, grant, connect, disconnect } = await setup(), hero = await identity();
    const gear = await grant(hero.id, "training-sword"), committed = deferred(), release = deferred(), validated = deferred();
    const originals = new Map<PoolClient, PoolClient["query"]>();
    let used = false;
    const wrap = (client: PoolClient) => {
      if (originals.has(client)) return;
      const original = client.query; originals.set(client, original);
      let gearUpdated = false;
      client.query = ((...args: unknown[]) => {
        const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string } | undefined)?.text ?? "";
        if (/SET equipment_slot=\$2/.test(text)) gearUpdated = true;
        const query = original.bind(client) as (...values: unknown[]) => Promise<unknown>;
        if (text !== "COMMIT" || !gearUpdated || used) return query(...args);
        used = true;
        return query(...args).then(async result => { committed.resolve(); await release.promise; return result; });
      }) as PoolClient["query"];
    };
    pool!.on("acquire", wrap);
    try {
      // No client acknowledgement can arrive after this socket disconnects.
      hero.socket.emit("setEquipmentSlot", { slot: "mainHand", itemInstanceId: gear["training-sword"]!.instanceId }, () => undefined);
      await committed.promise;
      expect((await pool!.query("SELECT equipment_slot FROM item_instances WHERE id=$1", [gear["training-sword"]!.instanceId])).rows[0].equipment_slot).toBe("mainHand");
      await disconnect(hero.socket);
      const validate = auth.validateToken.bind(auth);
      vi.spyOn(auth, "validateToken").mockImplementation(async (...args) => { const result = await validate(...args); validated.resolve(); return result; });
      const replacement = await connect(), state = waitFor<PlayerStateSnapshot>(replacement, "playerState");
      let acknowledged = false;
      const authentication = replacement.timeout(3_000).emitWithAck("authenticate", { sessionToken: hero.token }).then(result => { acknowledged = true; return result; });
      await validated.promise;
      // This packet proves the new socket is live while authentication is waiting on the old mutation.
      expect(await equipment(replacement, "mainHand", null)).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
      expect(acknowledged).toBe(false);
      release.resolve();
      expect(await authentication).toMatchObject({ ok: true });
      expect((await state).character.equipment?.mainHand?.instanceId).toBe(gear["training-sword"]!.instanceId);
      expect(game.services.characters.getSnapshot(hero.id)?.statistics?.meleeDamage).toBe(32);
    } finally {
      release.resolve(); pool!.off("acquire", wrap);
      for (const [client, original] of originals) client.query = original;
    }
  });

  it("rolls back a failed equipment transaction without persisting unconfirmed gear through a concurrent movement save", async () => {
    const { game, identity, grant, lifecycle, connect, authenticate, disconnect } = await setup(), hero = await identity();
    const gear = await grant(hero.id, "training-axe"), entered = deferred(), release = deferred(), movementSaved = deferred();
    const original = game.services.inventory.getSnapshot.bind(game.services.inventory), save = lifecycle.saveGameplayState.bind(lifecycle);
    vi.spyOn(game.services.inventory, "getSnapshot").mockImplementation(async (...args) => {
      const snapshot = await original(...args);
      if (args[1]) { entered.resolve(); await release.promise; throw new Error("SIMULATED_EQUIPMENT_TRANSACTION_FAILED"); }
      return snapshot;
    });
    vi.spyOn(lifecycle, "saveGameplayState").mockImplementation(async (...args) => { await save(...args); movementSaved.resolve(); });
    const changing = equipment(hero.socket, "mainHand", gear["training-axe"]!.instanceId);
    try {
      await entered.promise;
      const moved = waitFor<WorldStateSnapshot>(hero.socket, "worldState", snapshot => snapshot.players.some(player => player.id === hero.id && player.x > 1290));
      hero.socket.emit("moveIntent", { x: 1300, y: 455 }); await moved;
      expect(game.services.characters.getSnapshot(hero.id)?.equipment?.mainHand).toBeNull();
      release.resolve();
      expect(await changing).toMatchObject({ ok: false, code: "SIMULATED_EQUIPMENT_TRANSACTION_FAILED" });
      await movementSaved.promise;
      expect((await original(hero.id)).equipmentSlots?.mainHand).toBeNull();
      await disconnect(hero.socket);
      const restored = await authenticate(await connect(), hero.token);
      expect(restored.character.equipment?.mainHand).toBeNull();
      expect(restored.character.statistics?.meleeDamage).toBe(20);
      expect(totalTraining(restored.character)).toBe(0);
    } finally { release.resolve(); }
  });

  it("never lets an inventory read started before a gear commit restore stale authoritative equipment", async () => {
    const { game, identity, grant } = await setup(), hero = await identity();
    const gear = await grant(hero.id, "training-sword"), entered = deferred(), release = deferred();
    const original = game.services.inventory.getSnapshot.bind(game.services.inventory);
    let held = false;
    const received: PlayerStateSnapshot[] = [];
    hero.socket.on("playerState", value => received.push(value));
    vi.spyOn(game.services.inventory, "getSnapshot").mockImplementation(async (...args) => {
      const snapshot = await original(...args);
      if (!args[1] && !held) { held = true; entered.resolve(); await release.promise; }
      return snapshot;
    });
    try {
      hero.socket.emit("requestPlayerState"); await entered.promise;
      const armed = waitFor<PlayerStateSnapshot>(hero.socket, "playerState", value => value.character.equipment?.mainHand?.instanceId === gear["training-sword"]!.instanceId);
      expect(await equipment(hero.socket, "mainHand", gear["training-sword"]!.instanceId)).toMatchObject({ ok: true });
      await armed;
      release.resolve();
      const refreshed = waitFor<PlayerStateSnapshot>(hero.socket, "playerState"); hero.socket.emit("requestPlayerState");
      expect((await refreshed).character.equipment?.mainHand?.instanceId).toBe(gear["training-sword"]!.instanceId);
      expect(received.every(value => value.character.equipment?.mainHand?.instanceId === gear["training-sword"]!.instanceId)).toBe(true);
      expect(game.services.characters.getSnapshot(hero.id)?.equipment?.mainHand?.instanceId).toBe(gear["training-sword"]!.instanceId);
    } finally { release.resolve(); }
  });

  it("does not push stale equipment when a completed trade presentation finishes after the recipient equips a weapon", async () => {
    const { game, identity, grant } = await setup(), alice = await identity("TradeAlice"), bob = await identity("TradeBob");
    const gear = await grant(alice.id, "training-sword"), gift = await grant(bob.id, "wolf-pelt");
    const act = async (socket: Socket, action: SocialAction): Promise<SocialSnapshot> => {
      const result: SocialActionResult = await socket.timeout(3_000).emitWithAck("socialAction", action);
      if (!result.ok) throw new Error(result.code);
      return result.social;
    };
    const trade = (await act(alice.socket, { type: "requestTrade", playerId: bob.id })).trade!;
    await act(bob.socket, { type: "respondTrade", tradeId: trade.id, accept: true });
    const offered = (await act(bob.socket, {
      type: "setTradeOffer", tradeId: trade.id, revision: 0,
      items: [{ instanceId: gift["wolf-pelt"]!.instanceId, quantity: 1 }]
    })).trade!;
    await act(alice.socket, { type: "confirmTrade", tradeId: trade.id, revision: offered.revision });
    const entered = deferred(), release = deferred(), getGold = game.services.merchant.getGold.bind(game.services.merchant);
    let held = false;
    vi.spyOn(game.services.merchant, "getGold").mockImplementation(async id => {
      const value = await getGold(id);
      if (id === alice.id && !held) { held = true; entered.resolve(); await release.promise; }
      return value;
    });
    const completion = act(bob.socket, { type: "confirmTrade", tradeId: trade.id, revision: offered.revision });
    try {
      await entered.promise;
      // The barter has committed and released its mutation locks. Only its old display read is held.
      expect((await game.services.inventory.getSnapshot(alice.id)).items).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: "wolf-pelt", quantity: 1 })]));
      const equipped = waitFor<PlayerStateSnapshot>(alice.socket, "playerState", state => state.character.equipment?.mainHand?.instanceId === gear["training-sword"]!.instanceId);
      expect(await equipment(alice.socket, "mainHand", gear["training-sword"]!.instanceId)).toMatchObject({ ok: true });
      await equipped;
      const receivedAfterEquip: PlayerStateSnapshot[] = [];
      alice.socket.on("playerState", state => receivedAfterEquip.push(state));
      release.resolve();
      expect((await completion).trade?.status).toBe("completed");
      // A round trip on Alice's socket drains any earlier trade presentation before this fresh state.
      const refreshed = waitFor<PlayerStateSnapshot>(alice.socket, "playerState", state => state.inventory.equipmentSlots?.mainHand === gear["training-sword"]!.instanceId);
      alice.socket.emit("requestPlayerState"); await refreshed;
      expect(receivedAfterEquip.length).toBeGreaterThan(0);
      expect(receivedAfterEquip.every(state => state.character.equipment?.mainHand?.instanceId === gear["training-sword"]!.instanceId
        && state.inventory.equipmentSlots?.mainHand === gear["training-sword"]!.instanceId)).toBe(true);
      expect(game.services.characters.getSnapshot(alice.id)?.equipment?.mainHand?.instanceId).toBe(gear["training-sword"]!.instanceId);
    } finally { release.resolve(); }
  });
});
