import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { BattleSnapshot, PlayerStateSnapshot, WorldStateSnapshot } from "@web-mmorpg/shared";
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
  return { game, connect, authenticate, identity, start, lifecycle };
}

describeDatabase("weapon training Socket.IO",()=>{
 it("guards unauthenticated and invalid style selection",async()=>{
  const {connect,identity}=await setup(),guest=await connect();
  expect(await guest.timeout(1000).emitWithAck("setWeaponLoadout",{melee:"axe",ranged:"crossbow"})).toMatchObject({ok:false,code:"AUTHENTICATION_REQUIRED"});
  const hero=await identity();
  expect(await hero.socket.timeout(1000).emitWithAck("setWeaponLoadout",{melee:"bow",ranged:"sword"})).toMatchObject({ok:false,code:"INVALID_WEAPON_LOADOUT"});
 });
 it("persists selected styles, blocks changes in battle and restores them on a new connection",async()=>{
  const {identity,start,connect,authenticate}=await setup(),hero=await identity();
  const state=waitFor<PlayerStateSnapshot>(hero.socket,"playerState",s=>s.character.weaponTraining?.loadout.melee==="axe");
  expect(await hero.socket.timeout(2000).emitWithAck("setWeaponLoadout",{melee:"axe",ranged:"crossbow"})).toMatchObject({ok:true,character:{weaponTraining:{loadout:{melee:"axe",ranged:"crossbow"}}}});
  await state;await start(hero.socket);
  expect(await hero.socket.timeout(1000).emitWithAck("setWeaponLoadout",{melee:"sword",ranged:"bow"})).toMatchObject({ok:false,code:"BATTLE_IN_PROGRESS"});
  hero.socket.disconnect();
  const next=await connect(),restored=await authenticate(next,hero.token);
  expect(restored.character.weaponTraining?.loadout).toEqual({melee:"axe",ranged:"crossbow"});
 });
 it("saves accepted automatic attacks under only the selected families and survives reconnect",async()=>{
  const {identity,start,connect,authenticate}=await setup(15),hero=await identity();
  expect(await hero.socket.timeout(2000).emitWithAck("setWeaponLoadout",{melee:"axe",ranged:"crossbow"})).toMatchObject({ok:true});
  const progress=waitFor<PlayerStateSnapshot>(hero.socket,"playerState",s=>Boolean(s.character.weaponTraining && s.character.weaponTraining.experience.axe+s.character.weaponTraining.experience.crossbow>0));
  await start(hero.socket,"auto");const trained=await progress;
  hero.socket.disconnect();const next=await connect(),restored=await authenticate(next,hero.token);
  expect(restored.character.weaponTraining!.experience.axe+restored.character.weaponTraining!.experience.crossbow).toBeGreaterThanOrEqual(trained.character.weaponTraining!.experience.axe+trained.character.weaponTraining!.experience.crossbow);
  expect(restored.character.weaponTraining!.experience.sword).toBe(0);expect(restored.character.weaponTraining!.experience.bow).toBe(0);
 });
 it("blocks starting combat or another style change until the style save completes",async()=>{
  const {identity,lifecycle}=await setup(),hero=await identity();
  const original=lifecycle.saveGameplayState.bind(lifecycle);let resume!:()=>void,entered!:()=>void;
  const enteredSave=new Promise<void>(resolve=>{entered=resolve;});
  const hold=new Promise<void>(resolve=>{resume=resolve;});
  vi.spyOn(lifecycle,"saveGameplayState").mockImplementationOnce(async(...args)=>{entered();await hold;await original(...args);});
  const changing=hero.socket.timeout(3000).emitWithAck("setWeaponLoadout",{melee:"dagger",ranged:"bow"});
  await enteredSave;
  const rejected=waitFor<{code:string}>(hero.socket,"commandRejected");hero.socket.emit("startEncounter",{encounterId:"wolf-pack-01"});
  expect((await rejected).code).toBe("WEAPON_ACTION_PENDING");
  expect(await hero.socket.timeout(1000).emitWithAck("setWeaponLoadout",{melee:"axe",ranged:"bow"})).toMatchObject({ok:false,code:"WEAPON_ACTION_PENDING"});
  resume();expect(await changing).toMatchObject({ok:true});
 });

 it("acknowledges a durable selection and reconnects without waiting for an old presentation read",async()=>{
  const {game,identity,connect,authenticate}=await setup(),hero=await identity();
  const original=game.services.inventory.getSnapshot.bind(game.services.inventory);
  let unblock!:()=>void,blockOldRead=true;
  const hold=new Promise<void>(resolve=>{unblock=resolve;});
  vi.spyOn(game.services.inventory,"getSnapshot").mockImplementation(async(...args)=>{
    if(blockOldRead){blockOldRead=false;await hold;}
    return original(...args);
  });
  try {
    expect(await hero.socket.timeout(500).emitWithAck("setWeaponLoadout",{melee:"axe",ranged:"crossbow"})).toMatchObject({ok:true});
    // If the handler no longer performs the presentation read, do not hold the new session's read.
    blockOldRead=false;
    hero.socket.disconnect();
    const replacement=await connect(),restored=await authenticate(replacement,hero.token);
    expect(restored.character.weaponTraining?.loadout).toEqual({melee:"axe",ranged:"crossbow"});
  }finally{unblock();}
 });

 it("persists the restored style after a failed selection even when movement already queued its unconfirmed style",async()=>{
  const {identity,lifecycle}=await setup(),hero=await identity();
  const original=lifecycle.saveGameplayState.bind(lifecycle);
  let calls=0,fail!:()=>void,entered!:()=>void,queuedSaved!:()=>void;
  const held=new Promise<void>(resolve=>{fail=resolve;}),enteredSave=new Promise<void>(resolve=>{entered=resolve;}),laterSave=new Promise<void>(resolve=>{queuedSaved=resolve;});
  vi.spyOn(lifecycle,"saveGameplayState").mockImplementation(async(...args)=>{
    const current=++calls;
    if(current===1){entered();await held;throw new Error("SIMULATED_SELECTION_SAVE_FAILED");}
    await original(...args);if(current===2)queuedSaved();
  });
  const changing=hero.socket.timeout(2500).emitWithAck("setWeaponLoadout",{melee:"axe",ranged:"crossbow"});
  try {
    await enteredSave;
    const moved=waitFor<WorldStateSnapshot>(hero.socket,"worldState",snapshot=>snapshot.players.some(player=>player.id===hero.id && player.x>1290));
    hero.socket.emit("moveIntent",{x:1300,y:455});await moved;
    fail();expect(await changing).toMatchObject({ok:false,code:"WEAPON_SAVE_FAILED"});
    await laterSave;
    expect((await pool!.query("SELECT weapon_training FROM characters WHERE id=$1",[hero.id])).rows[0].weapon_training.loadout).toEqual({melee:"sword",ranged:"bow"});
  }finally{fail();}
 });
});
