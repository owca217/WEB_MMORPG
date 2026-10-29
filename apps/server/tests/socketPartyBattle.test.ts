import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { getBattleAttackPreview, type BattleCommand, type BattleSnapshot, type InventorySnapshot, type PlayerStateSnapshot } from "@web-mmorpg/shared";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { createGameServer } from "../src/server/createGameServer";
import { findPath, hexDistance, hexKey, hexNeighbors } from "../src/battle/hex";
import { hasLineOfSight } from "../src/battle/lineOfSight";

const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const pool = target && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/web_mmorpg_test" ? createPool(databaseUrl!) : null;
const describeDatabase = pool ? describe : describe.skip;
const clients: Socket[] = [];
let closeServer: (() => Promise<void>) | undefined;

interface Identity { id: string; socket: Socket; token: string; nickname: string }
interface BattleEnded {
  outcome: "victory" | "defeat";
  character: PlayerStateSnapshot["character"];
  inventory: InventorySnapshot;
  experienceGained?: number;
  goldGained?: number;
}
function waitFor<T>(socket: Socket, event: string, predicate: (value: T) => boolean = () => true, timeout = 4_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`TIMEOUT:${event}`)); }, timeout);
    function listener(value: T) {
      if (!predicate(value)) return;
      clearTimeout(timer); socket.off(event, listener); resolve(value);
    }
    socket.on(event, listener);
  });
}
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
  const lifecycle = new CharacterLifecycleService(pool);
  const auth = new AuthService(pool, new AccountRepository(pool), lifecycle);
  const http = createServer();
  const game = createGameServer(http, { pool, authService: auth, characterLifecycle: lifecycle, autoBattleStepMs: 10 });
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
  const identity = async (nickname: string, x = 1290, y = 455, hp = 100): Promise<Identity> => {
    const username = nickname.toLowerCase();
    await auth.register(username, "correct-horse-battery-staple");
    const account = await new AccountRepository(pool).findByNormalizedUsername(username);
    const character = await lifecycle.createCharacter(account!.id, { nickname, appearance: {} });
    await lifecycle.saveGameplayState(character.id, {
      locationId: "forest-settlement-01", x, y, level: 1, experience: 0,
      hp, maxHp: 100, maxAp: 5, initiative: 10, severelyInjured: false, injuries: []
    });
    const { token } = await auth.login(username, "correct-horse-battery-staple");
    const socket = await connect(); await authenticate(socket, token);
    return { id: character.id, nickname, socket, token };
  };
  const party = (leader: Identity, ...others: Identity[]) => {
    for (const member of others) {
      game.services.social.parties.invite(leader.id, member.id);
      game.services.social.parties.respond(member.id, game.services.social.parties.getInvites(member.id)[0]!.id, true);
    }
  };
  const start = async (leader: Identity, members: Identity[]) => {
    const starts = new Map<string, BattleSnapshot[]>();
    for (const member of [leader, ...members]) {
      const received: BattleSnapshot[] = []; starts.set(member.id, received);
      member.socket.on("battleStarted", (snapshot: BattleSnapshot) => received.push(snapshot));
    }
    const initial = waitFor<BattleSnapshot>(leader.socket, "battleStarted");
    leader.socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const snapshot = await initial;
    // Missing admission fails here without leaving another client's event promise pending.
    expect(snapshot.combatants.filter(actor => actor.ownerPlayerId)).toHaveLength(members.length + 1);
    await vi.waitFor(() => { for (const member of members) expect(starts.get(member.id)).toHaveLength(1); });
    return { snapshot, starts };
  };
  return { game, lifecycle, auth, connect, authenticate, identity, party, start };
}
function owners(snapshot: BattleSnapshot): string[] {
  return snapshot.combatants.flatMap(actor => actor.ownerPlayerId ? [actor.ownerPlayerId] : []).sort();
}
function activeAndOther(snapshot: BattleSnapshot, a: Identity, b: Identity) {
  const activeId = snapshot.combatants.find(actor => actor.id === snapshot.activeCombatantId)!.ownerPlayerId;
  return activeId === a.id ? { active: a, other: b } : { active: b, other: a };
}
function nextPlayerCommand(snapshot: BattleSnapshot): BattleCommand {
  const actor = snapshot.combatants.find(unit => unit.id === snapshot.activeCombatantId)!;
  const enemies = snapshot.combatants.filter(unit => unit.side === "enemy" && unit.hp > 0).sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id));
  const adjacent = enemies.find(enemy => hexDistance(actor.position, enemy.position) === 1);
  if (adjacent && actor.ap >= 2) return { type: "meleeAttack", combatantId: actor.id, targetId: adjacent.id };
  const blocked = new Set(snapshot.blockedCells.map(hexKey));
  const shot = enemies.find(enemy => hexDistance(actor.position, enemy.position) <= 6 && hasLineOfSight(actor.position, enemy.position, blocked));
  if (shot && actor.ap >= (actor.injuries.includes("brokenArm") ? 4 : 3)) return { type: "rangedAttack", combatantId: actor.id, targetId: shot.id };
  if (!adjacent && actor.ap >= (actor.injuries.includes("legTrauma") ? 2 : 1)) {
    const allowed = new Set(snapshot.cells.map(hexKey));
    for (const unit of snapshot.combatants) if (unit.id !== actor.id && unit.hp > 0) blocked.add(hexKey(unit.position));
    const paths = enemies.flatMap(enemy => hexNeighbors(enemy.position)
      .filter(cell => allowed.has(hexKey(cell)) && !blocked.has(hexKey(cell)))
      .map(cell => findPath(actor.position, cell, blocked, allowed))
      .filter((path): path is NonNullable<typeof path> => !!path?.length)).sort((a, b) => a.length - b.length);
    if (paths[0]?.[0]) return { type: "move", combatantId: actor.id, target: paths[0][0] };
  }
  return { type: "endTurn", combatantId: actor.id };
}

describeDatabase("shared party battle Socket.IO", () => {
  it("joins a distant member in the same location while excluding a member in another location", async () => {
    const { game, identity, party, start } = await setup();
    const leader = await identity("PartyLeader"), distant = await identity("PartyDistant", 100, 100), elsewhere = await identity("PartyElsewhere");
    party(leader, distant, elsewhere);
    game.services.world.addPlayer({ id: elsewhere.id, nickname: elsewhere.nickname, locationId: "another-location", x: 1290, y: 455 });
    let excludedStarts = 0; elsewhere.socket.on("battleStarted", () => { excludedStarts++; });
    const { snapshot, starts } = await start(leader, [distant]);
    expect(owners(snapshot)).toEqual([leader.id, distant.id].sort());
    expect(starts.get(distant.id)![0]!.id).toBe(snapshot.id);
    const positions = snapshot.combatants.filter(actor => actor.ownerPlayerId).map(actor => `${actor.position.q},${actor.position.r}`);
    expect(new Set(positions).size).toBe(2);
    expect(game.services.battles.hasBattle(elsewhere.id)).toBe(false); expect(excludedStarts).toBe(0);
  });

  it("enforces each owner's turn and broadcasts ally healing and item use to both players", async () => {
    const { game, identity, party, start } = await setup();
    const a = await identity("PartyHealer", 1290, 455, 60), b = await identity("PartyAlly", 100, 100, 60);
    for (const member of [a, b]) expect(await member.socket.timeout(1500).emitWithAck("setWeaponLoadout", { melee: "sword", ranged: "bow", support: "staff" })).toMatchObject({ ok: true });
    const bags = new Map<string, string>();
    for (const member of [a, b]) bags.set(member.id, (await game.services.inventory.addItems(member.id, [{ itemId: "field-bandage", quantity: 1 }])).items[0]!.instanceId);
    party(a, b); const { snapshot } = await start(a, [b]);
    const { active, other } = activeAndOther(snapshot, a, b);
    const actor = snapshot.combatants.find(unit => unit.ownerPlayerId === active.id)!;
    const ally = snapshot.combatants.find(unit => unit.ownerPlayerId === other.id)!;
    const foreign = waitFor<{ code: string }>(other.socket, "commandRejected");
    other.socket.emit("battleCommand", { type: "endTurn", combatantId: actor.id });
    expect((await foreign).code).toBe("NOT_OWNER");
    const inactive = waitFor<{ code: string }>(other.socket, "commandRejected");
    other.socket.emit("battleCommand", { type: "endTurn", combatantId: ally.id });
    expect((await inactive).code).toBe("NOT_ACTIVE_TURN");
    const friendly = waitFor<{ code: string }>(active.socket, "commandRejected");
    active.socket.emit("battleCommand", { type: "rangedAttack", combatantId: actor.id, targetId: ally.id });
    expect((await friendly).code).toBe("INVALID_TARGET");

    const healedA = waitFor<BattleSnapshot>(a.socket, "battleState", s => s.combatants.some(unit => unit.id === ally.id && unit.hp === 80));
    const healedB = waitFor<BattleSnapshot>(b.socket, "battleState", s => s.combatants.some(unit => unit.id === ally.id && unit.hp === 80));
    active.socket.emit("battleCommand", { type: "healAlly", combatantId: actor.id, targetId: ally.id });
    const [sa, sb] = await Promise.all([healedA, healedB]);
    expect(sa.combatants).toEqual(sb.combatants);
    expect(sa.combatants.find(unit => unit.id === actor.id)).toMatchObject({ ap: 2, healingUsedThisTurn: true });

    const itemA = waitFor<BattleSnapshot>(a.socket, "battleState", s => s.combatants.some(unit => unit.id === actor.id && unit.hp === 90));
    const itemB = waitFor<BattleSnapshot>(b.socket, "battleState", s => s.combatants.some(unit => unit.id === actor.id && unit.hp === 90));
    expect(await active.socket.timeout(2000).emitWithAck("useBattleItem", { combatantId: actor.id, itemInstanceId: bags.get(active.id) })).toMatchObject({ ok: true });
    const [ia, ib] = await Promise.all([itemA, itemB]);
    expect(ia.combatants).toEqual(ib.combatants); expect(ia.combatants.find(unit => unit.id === actor.id)).toMatchObject({ hp: 90, ap: 0 });
  });

  it("runs each player's Auto turns and settles each reward once before reconnect", async () => {
    const { identity, party, start, connect, authenticate } = await setup();
    const a = await identity("PartyAutoA"), b = await identity("PartyAutoB", 100, 100);
    party(a, b); await start(a, [b]);
    const receivedA: BattleEnded[] = [], receivedB: BattleEnded[] = [];
    a.socket.on("battleEnded", (result: BattleEnded) => receivedA.push(result)); b.socket.on("battleEnded", (result: BattleEnded) => receivedB.push(result));
    const endedA = waitFor<BattleEnded>(a.socket, "battleEnded", () => true, 10_000), endedB = waitFor<BattleEnded>(b.socket, "battleEnded", () => true, 10_000);
    for (const member of [a, b]) expect(await member.socket.timeout(1500).emitWithAck("setBattleAuto", { enabled: true })).toMatchObject({ ok: true, snapshot: { autoBattle: true } });
    const [ra, rb] = await Promise.all([endedA, endedB]);
    for (const result of [ra, rb]) {
      expect(result).toMatchObject({ outcome: "victory", experienceGained: 44, goldGained: 15, character: { experience: 44 } });
      expect(result.inventory.items.filter(item => item.itemId === "field-bandage").reduce((quantity, item) => quantity + item.quantity, 0)).toBe(2);
    }
    const state = waitFor<PlayerStateSnapshot>(a.socket, "playerState");
    a.socket.emit("battleCommand", { type: "endTurn", combatantId: `hero:${a.id}` }); a.socket.emit("requestPlayerState");
    expect((await state).character.experience).toBe(44); expect(receivedA).toHaveLength(1); expect(receivedB).toHaveLength(1);
    a.socket.disconnect(); b.socket.disconnect();
    const nextA = await connect(), nextB = await connect();
    const restoredA = await authenticate(nextA, a.token), restoredB = await authenticate(nextB, b.token);
    for (const restored of [restoredA, restoredB]) {
      expect(restored.character.experience).toBe(44); expect(restored.gold).toBe(115);
      expect(restored.inventory.items.filter(item => item.itemId === "field-bandage").reduce((quantity, item) => quantity + item.quantity, 0)).toBe(2);
    }
  }, 15_000);

  it("removes a disconnected active player without blocking the other participant's turn", async () => {
    const { game, identity, party, start, connect, authenticate } = await setup();
    const a = await identity("PartyLeaveA", 1290, 455, 70), b = await identity("PartyLeaveB", 100, 100, 80);
    party(a, b); const { snapshot } = await start(a, [b]); const { active: leaving, other: remaining } = activeAndOther(snapshot, a, b);
    const leavingHp = snapshot.combatants.find(unit => unit.ownerPlayerId === leaving.id)!.hp;
    const changed = waitFor<BattleSnapshot>(remaining.socket, "battleState", s => !s.combatants.some(unit => unit.ownerPlayerId === leaving.id));
    leaving.socket.disconnect(); const continued = await changed;
    expect(owners(continued)).toEqual([remaining.id]);
    const active = continued.combatants.find(unit => unit.id === continued.activeCombatantId)!; expect(active.ownerPlayerId).toBe(remaining.id);
    const nextState = waitFor<BattleSnapshot>(remaining.socket, "battleState");
    remaining.socket.emit("battleCommand", { type: "endTurn", combatantId: active.id }); await nextState;
    const replacement = await connect(), restored = await authenticate(replacement, leaving.token);
    expect(restored.character.hp).toBe(leavingHp); expect(game.services.battles.hasBattle(leaving.id)).toBe(false);
  });

  it("waits for a shared item mutation before detaching another participant", async () => {
    const { game, identity, party, start } = await setup();
    const a = await identity("PartyItemA", 1290, 455, 50), b = await identity("PartyItemB", 100, 100, 50);
    const items = new Map<string, string>();
    for (const member of [a, b]) items.set(member.id, (await game.services.inventory.addItems(member.id, [{ itemId: "field-bandage", quantity: 1 }])).items[0]!.instanceId);
    party(a, b); const { snapshot } = await start(a, [b]); const { active, other } = activeAndOther(snapshot, a, b);
    const hero = snapshot.combatants.find(unit => unit.ownerPlayerId === active.id)!;
    let release!: () => void, committed!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { committed = resolve; });
    const consume = game.services.inventory.consumeBattleItem.bind(game.services.inventory);
    vi.spyOn(game.services.inventory, "consumeBattleItem").mockImplementationOnce(async (...args) => { const result = await consume(...args); committed(); await hold; return result; });
    const used = active.socket.timeout(3000).emitWithAck("useBattleItem", { combatantId: hero.id, itemInstanceId: items.get(active.id) });
    await entered;
    const departed = waitFor<BattleSnapshot>(active.socket, "battleState", s => !s.combatants.some(unit => unit.ownerPlayerId === other.id));
    other.socket.disconnect(); release(); expect(await used).toMatchObject({ ok: true });
    const continued = await departed;
    expect(owners(continued)).toEqual([active.id]); expect(continued.combatants.find(unit => unit.id === hero.id)).toMatchObject({ hp: 80, ap: 3 });
  });

  it("does not count an excluded nearby party member when only one admitted player remains", async () => {
    const { game, identity, party, start } = await setup();
    const a = await identity("PartyBonusA"), b = await identity("PartyBonusB", 100, 100), busy = await identity("PartyBonusBusy", 700, 300);
    party(a, b, busy);
    // Already fighting: this nearby party member must not enter or boost the shared encounter.
    game.services.battles.startBattle(game.services.characters.getSnapshot(busy.id)!, "wolf-pack-01");
    let { snapshot } = await start(a, [b]);
    const rejected: string[] = [];
    for (const member of [a, b]) member.socket.on("commandRejected", (error: { code: string }) => rejected.push(error.code));
    let winningCommand: Extract<BattleCommand, { type: "meleeAttack" | "rangedAttack" }> | undefined;
    for (let guard = 0; guard < 200 && !snapshot.finished; guard++) {
      const command = nextPlayerCommand(snapshot);
      const actor = snapshot.combatants.find(unit => unit.id === snapshot.activeCombatantId)!;
      const member = actor.ownerPlayerId === a.id ? a : b;
      const enemies = snapshot.combatants.filter(unit => unit.side === "enemy" && unit.hp > 0);
      if (enemies.length === 1 && (command.type === "meleeAttack" || command.type === "rangedAttack")) {
        const preview = getBattleAttackPreview(snapshot, actor.id, command.targetId);
        if (preview?.available && preview.averageDamage >= enemies[0]!.hp) { winningCommand = command; break; }
      }
      const before = snapshot;
      const changed = waitFor<BattleSnapshot>(member.socket, "battleState", state => {
        if (state.id !== before.id || state.round < before.round) return false;
        if (command.type === "endTurn") return state.round > before.round || state.activeCombatantId !== before.activeCombatantId;
        const updated = state.combatants.find(unit => unit.id === actor.id);
        if (!updated || updated.ap >= actor.ap) return false;
        if (command.type === "move") return updated.position.q === command.target.q && updated.position.r === command.target.r;
        if (command.type === "meleeAttack" || command.type === "rangedAttack") {
          return (state.combatants.find(unit => unit.id === command.targetId)?.hp ?? 0) < before.combatants.find(unit => unit.id === command.targetId)!.hp;
        }
        return false;
      });
      member.socket.emit("battleCommand", command);
      try { snapshot = await changed; }
      catch { throw new Error(`MANUAL_DRIVER_STEP:${guard}:${command.type}:rejected=${rejected.join(",")}`); }
    }
    expect(winningCommand).toBeDefined();
    const { active: survivor, other: leaving } = activeAndOther(snapshot, a, b);
    const detached = waitFor<BattleSnapshot>(survivor.socket, "battleState", state => !state.combatants.some(unit => unit.ownerPlayerId === leaving.id));
    leaving.socket.disconnect(); const alone = await detached;
    expect(owners(alone)).toEqual([survivor.id]);
    const ended = waitFor<BattleEnded>(survivor.socket, "battleEnded");
    survivor.socket.emit("battleCommand", winningCommand!);
    expect(await ended).toMatchObject({ outcome: "victory", experienceGained: 40, character: { experience: 40 } });
  }, 15_000);
});
