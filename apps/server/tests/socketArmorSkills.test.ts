import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MAX_WEAPON_EXPERIENCE, normalizeArmorTraining, type PlayerStateSnapshot, type WeaponSkillUpdateResult } from "@web-mmorpg/shared";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { ArmorSkillService } from "../src/character/ArmorSkillService";
import { Pool } from "pg";
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
const learn = (socket: Socket, skillId: string): Promise<WeaponSkillUpdateResult> => socket.timeout(3500).emitWithAck("learnArmorSkill", { skillId });
const reset = (socket: Socket, family: string): Promise<WeaponSkillUpdateResult> => socket.timeout(3500).emitWithAck("resetArmorSkills", { family });

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
    const training = normalizeArmorTraining(undefined);
    training.experience.cloth = MAX_WEAPON_EXPERIENCE;
    training.experience.plate = MAX_WEAPON_EXPERIENCE;
    training.experience.leather = 6375;
    await pool!.query("UPDATE characters SET armor_training=$2::jsonb,weapon_training=$3::jsonb WHERE id=$1", [character.id, JSON.stringify(training), JSON.stringify({experience:{sword:MAX_WEAPON_EXPERIENCE}})]);
    const { token } = await auth.login(username, "correct-horse-battery-staple"), socket = await connect();
    await authenticate(socket, token);
    return { id: character.id, socket, token };
  }
  const stored = async (id: string) => (await pool.query("SELECT armor_training FROM characters WHERE id=$1", [id])).rows[0].armor_training;
  return { game, identity, connect, authenticate, stored };
}

describeDb("armor skill tree socket persistence", () => {
  it("authenticates, persists idempotent learning across reconnect and resets only the selected family without losing XP", async () => {
    const { identity, connect, authenticate, stored } = await setup();
    expect(await learn(await connect(), "cloth:power")).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    const alice = await identity();
    expect(await alice.socket.timeout(3500).emitWithAck("learnWeaponSkill", {skillId:"sword:power"})).toMatchObject({ok:true});
    const learned = await learn(alice.socket, "cloth:power");
    expect(learned).toMatchObject({ ok: true, character: { armorTraining: { learnedSkills: ["cloth:power"], experience: { cloth: MAX_WEAPON_EXPERIENCE } } } });
    expect(await learn(alice.socket, "cloth:power")).toEqual(learned);
    expect(await learn(alice.socket, "plate:power")).toMatchObject({ ok: true });
    expect((await stored(alice.id)).learnedSkills).toEqual(expect.arrayContaining(["cloth:power", "plate:power"]));
    alice.socket.disconnect();
    const next = await connect(), restored = await authenticate(next, alice.token);
    expect(restored.character.armorTraining?.learnedSkills).toEqual(expect.arrayContaining(["cloth:power", "plate:power"]));
    expect(restored.character.armorTraining?.experience.leather).toBe(6375);
    expect(restored.character.weaponTraining?.learnedSkills).toEqual(["sword:power"]);
    expect(await next.timeout(3500).emitWithAck("resetWeaponSkills", {family:"sword"})).toMatchObject({ok:true,character:{armorTraining:{learnedSkills:["cloth:power","plate:power"]}}});
    expect(await reset(next, "cloth")).toMatchObject({ ok: true, character: { armorTraining: { learnedSkills: ["plate:power"], experience: { cloth: MAX_WEAPON_EXPERIENCE, plate: MAX_WEAPON_EXPERIENCE } } } });
    expect((await stored(alice.id)).learnedSkills).toEqual(["plate:power"]);
    expect((await stored(alice.id)).experience.leather).toBe(6375);
    expect(await learn(next, "arbitrary:ultimate")).toMatchObject({ ok: false, code: "INVALID_ARMOR_SKILL" });
    expect(await reset(next, "arbitrary")).toMatchObject({ ok: false, code: "INVALID_ARMOR_FAMILY" });
  });

  it("reserves mutation and battle starts, blocks stale movement saves, and rejects a replaced owner before commit", async () => {
    const { game, identity, connect, authenticate, stored } = await setup();
    const alice = await identity(), entered = deferred(), release = deferred();
    const original = game.services.armorSkills.apply.bind(game.services.armorSkills);
    vi.spyOn(game.services.armorSkills, "apply").mockImplementation(async (...args) => { entered.resolve(); await release.promise; return original(...args); });
    const pending = learn(alice.socket, "cloth:power").catch(() => undefined);
    await entered.promise;
    expect(await learn(alice.socket, "cloth:technique")).toMatchObject({ ok: false, code: "EQUIPMENT_ACTION_PENDING" });
    expect(await alice.socket.timeout(3000).emitWithAck("setEquipmentSlot", { slot: "mainHand", itemInstanceId: null })).toMatchObject({ ok: false, code: "EQUIPMENT_ACTION_PENDING" });
    const oldPosition = game.services.world.getPlayer(alice.id)!;
    alice.socket.emit("moveIntent", { x: oldPosition.x + 16, y: oldPosition.y });
    const healingRejected = waitFor<{ code: string }>(alice.socket, "commandRejected");
    alice.socket.emit("healAtNpc", { npcId: "healer-ada" });
    expect(await healingRejected).toMatchObject({ code: "EQUIPMENT_ACTION_PENDING" });
    const rejected = waitFor<{ code: string }>(alice.socket, "commandRejected");
    alice.socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
    expect(await rejected).toMatchObject({ code: "EQUIPMENT_ACTION_PENDING" });
    expect(game.services.world.getPlayer(alice.id)).toMatchObject({ x: oldPosition.x, y: oldPosition.y });
    const disconnected = new Promise<void>(resolve => alice.socket.once("disconnect", () => resolve()));
    const replacement = await connect(), reauth = authenticate(replacement, alice.token);
    await disconnected;
    release.resolve();
    await pending; await reauth;
    expect((await stored(alice.id)).learnedSkills).toBeUndefined();
    expect(game.services.characters.getSnapshot(alice.id)?.armorTraining?.learnedSkills).toBeUndefined();
  });

  it("rejects battle/trade and rolls back a failed database update without publishing a learned skill", async () => {
    const { game, identity, stored } = await setup();
    const alice = await identity(), bob = await identity("bob");
    game.services.battles.startBattle(game.services.characters.getSnapshot(alice.id)!, "wolf-pack-01");
    expect(await learn(alice.socket, "cloth:power")).toMatchObject({ ok: false, code: "BATTLE_IN_PROGRESS" });
    game.services.battles.removeBattleForPlayer(alice.id);
    const trade = await game.services.social.trades.request(alice.id, bob.id);
    expect(await reset(alice.socket, "cloth")).toMatchObject({ ok: false, code: "TRADE_IN_PROGRESS" });
    await game.services.social.trades.cancel(alice.id, trade.id);
    await pool!.query("CREATE FUNCTION fail_armor_skills() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.armor_training ? 'learnedSkills' THEN RAISE EXCEPTION 'TEST_SKILL_WRITE_FAILED'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_armor_skills BEFORE UPDATE OF armor_training ON characters FOR EACH ROW EXECUTE FUNCTION fail_armor_skills()");
    try {
      expect(await learn(alice.socket, "cloth:power")).toMatchObject({ ok: false, code: "ARMOR_SKILL_FAILED" });
      expect((await stored(alice.id)).learnedSkills).toBeUndefined();
      expect(game.services.characters.getSnapshot(alice.id)?.armorTraining?.learnedSkills).toBeUndefined();
    } finally { await pool!.query("DROP TRIGGER fail_armor_skills ON characters; DROP FUNCTION fail_armor_skills()"); }
    expect(await learn(alice.socket, "cloth:power")).toMatchObject({ ok: true });
  });

  it("reconciles a lost reset COMMIT reply before acknowledging and never restores the removed skills", async () => {
    const { game, identity, stored } = await setup(), alice = await identity();
    expect(await learn(alice.socket, "cloth:power")).toMatchObject({ ok: true });
    const reconciliationPool = new Pool({ connectionString: url!, max: 1 });
    const realConnect = reconciliationPool.connect.bind(reconciliationPool);
    vi.spyOn(reconciliationPool, "connect").mockImplementationOnce(async () => {
      const client = await realConnect(), query = client.query.bind(client);
      client.query = (async (...args: unknown[]) => {
        const result = await (query as (...parameters: unknown[]) => Promise<unknown>)(...args);
        if (args[0] === "COMMIT") throw new Error("TEST_LOST_COMMIT_REPLY");
        return result;
      }) as typeof client.query;
      return client;
    });
    const recovering = new ArmorSkillService(reconciliationPool);
    vi.spyOn(game.services.armorSkills, "apply").mockImplementationOnce((...args) => recovering.apply(...args));
    try {
      expect(await reset(alice.socket, "cloth")).toMatchObject({ ok: true });
      expect((await stored(alice.id)).learnedSkills).toBeUndefined();
      expect(game.services.characters.getSnapshot(alice.id)?.armorTraining?.learnedSkills).toBeUndefined();
    } finally { await reconciliationPool.end(); }
  });

  it("retains an unresolved authorized choice on a later action when both COMMIT and readback fail", async () => {
    const { game, identity, stored } = await setup(), alice = await identity();
    const reconciliationPool = new Pool({ connectionString: url!, max: 1 });
    const realConnect = reconciliationPool.connect.bind(reconciliationPool);
    vi.spyOn(reconciliationPool, "connect").mockImplementationOnce(async () => {
      const client = await realConnect(), query = client.query.bind(client);
      client.query = (async (...args: unknown[]) => {
        if (args[0] === "COMMIT") throw new Error("TEST_COMMIT_NOT_SENT");
        return (query as (...parameters: unknown[]) => Promise<unknown>)(...args);
      }) as typeof client.query;
      return client;
    });
    vi.spyOn(reconciliationPool, "query").mockRejectedValueOnce(new Error("TEST_READBACK_FAILED") as never);
    const recovering = new ArmorSkillService(reconciliationPool);
    vi.spyOn(game.services.armorSkills, "apply").mockImplementation((...args) => recovering.apply(...args));
    try {
      expect(await learn(alice.socket, "cloth:power")).toMatchObject({ ok: false, code: "ARMOR_SKILL_REQUEST_UNCERTAIN" });
      expect((await stored(alice.id)).learnedSkills).toBeUndefined();
      expect(game.services.characters.getSnapshot(alice.id)?.armorTraining?.learnedSkills).toEqual(["cloth:power"]);
      expect(await learn(alice.socket, "cloth:technique")).toMatchObject({ ok: true });
      expect((await stored(alice.id)).learnedSkills).toEqual(expect.arrayContaining(["cloth:power", "cloth:technique"]));
    } finally { await reconciliationPool.end(); }
  });
});
