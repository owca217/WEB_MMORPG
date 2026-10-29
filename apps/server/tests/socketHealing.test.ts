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
  const identity = async (name="healhero",hp=40) => {
    await auth.register(name, "correct-horse-battery-staple");
    const account = await new AccountRepository(pool).findByNormalizedUsername(name.toLowerCase());
    const character = await lifecycle.createCharacter(account!.id, { nickname: name, appearance: {} });
    await lifecycle.saveGameplayState(character.id, {
      locationId: "forest-settlement-01", x: 450, y: 450, level: 1, experience: 0,
      hp, maxHp: 100, maxAp: 5, initiative: 10, severelyInjured: false, injuries: []
    });
    const { token } = await auth.login(name, "correct-horse-battery-staple"), socket = await connect();
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

describeDatabase("healing staff cross-player Socket.IO",()=>{
 it("requires authentication and an active healing staff",async()=>{
  const {connect,identity}=await setup(),guest=await connect();
  expect(await guest.timeout(1000).emitWithAck("requestHealingTargets")).toMatchObject({ok:false,code:"AUTHENTICATION_REQUIRED"});
  const hero=await identity();
  expect(await hero.socket.timeout(1000).emitWithAck("castHealing",{requestId:"first-cast",targetId:hero.id})).toMatchObject({ok:false,code:"HEALING_STAFF_REQUIRED"});
 });
 it("heals party-owned HP, trains the caster once, replays safely and restores both on reconnect",async()=>{
  const {game,identity,connect,authenticate}=await setup(),caster=await identity("HealAlice"),ally=await identity("HealBob");
  expect(await caster.socket.timeout(1500).emitWithAck("setWeaponLoadout",{melee:"sword",ranged:"bow",support:"staff",defense:"shield"})).toMatchObject({ok:true});
  expect(await caster.socket.timeout(1000).emitWithAck("castHealing",{requestId:"notparty",targetId:ally.id})).toMatchObject({ok:false});
  game.services.social.parties.invite(caster.id,ally.id);game.services.social.parties.respond(ally.id,game.services.social.parties.getInvites(ally.id)[0]!.id,true);
  const targets=await caster.socket.timeout(1500).emitWithAck("requestHealingTargets");
  expect(targets).toMatchObject({ok:true,healingPower:20});expect(targets.targets.map((t:any)=>t.id)).toContain(ally.id);
  const targetPush=waitFor<PlayerStateSnapshot>(ally.socket,"playerState",s=>s.character.hp===60);
  const request={requestId:"party-cast-01",targetId:ally.id};
  const result=await caster.socket.timeout(2000).emitWithAck("castHealing",request);
  expect(result).toMatchObject({ok:true,targetId:ally.id,restoredHp:20});await targetPush;
  expect(await caster.socket.timeout(2000).emitWithAck("castHealing",request)).toEqual(result);
  expect(game.services.characters.getSnapshot(ally.id)?.hp).toBe(60);
  expect(game.services.characters.getSnapshot(caster.id)?.weaponTraining?.experience.staff).toBe(1);
  caster.socket.disconnect();ally.socket.disconnect();
  const nextCaster=await connect(),nextAlly=await connect();const restoredCaster=await authenticate(nextCaster,caster.token),restoredAlly=await authenticate(nextAlly,ally.token);
  expect(restoredCaster.character.weaponTraining?.experience.staff).toBe(1);expect(restoredAlly.character.hp).toBe(60);
  expect(await nextCaster.timeout(1000).emitWithAck("castHealing",{requestId:"cooldown-cast",targetId:restoredCaster.character.playerId})).toMatchObject({ok:false,code:"HEAL_COOLDOWN"});
 });
 it("waits for the healed player's durable mutation before reconnecting that player",async()=>{
  const {game,lifecycle,identity,connect,authenticate}=await setup(),caster=await identity("HealKeeper"),ally=await identity("HealTarget");
  expect(await caster.socket.timeout(1500).emitWithAck("setWeaponLoadout",{melee:"sword",ranged:"bow",support:"staff"})).toMatchObject({ok:true});
  game.services.social.parties.invite(caster.id,ally.id);game.services.social.parties.respond(ally.id,game.services.social.parties.getInvites(ally.id)[0]!.id,true);
  const save=lifecycle.saveGameplayState.bind(lifecycle);let resume!:()=>void,entered!:()=>void;
  const hold=new Promise<void>(resolve=>{resume=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  let blocked=false;
  vi.spyOn(lifecycle,"saveGameplayState").mockImplementation(async(id,state)=>{if(id===ally.id&&!blocked){blocked=true;entered();await hold;}await save(id,state);});
  const casting=caster.socket.timeout(3000).emitWithAck("castHealing",{requestId:"durable-party-heal",targetId:ally.id});
  await started;ally.socket.disconnect();const next=await connect();let restoredEarly=false;
  const restoring=authenticate(next,ally.token).then(state=>{restoredEarly=true;return state;});
  try{await new Promise(resolve=>setTimeout(resolve,30));expect(restoredEarly).toBe(false);}finally{resume();}
  expect(await casting).toMatchObject({ok:true,restoredHp:20});expect((await restoring).character.hp).toBe(60);
 });

 it("trains and persists self-healing and shield blocks in an automatic battle",async()=>{
  const {game,identity,start,connect,authenticate}=await setup(10),hero=await identity("SupportAuto",30);
  expect(await hero.socket.timeout(1500).emitWithAck("setWeaponLoadout",{melee:"sword",ranged:"bow",support:"staff",defense:"shield"})).toMatchObject({ok:true});
  game.services.world.addPlayer({id:hero.id,nickname:"SupportAuto",x:1290,y:455});
  const finished=waitFor<{character:{weaponTraining:{experience:{staff:number;shield:number}}}}>(hero.socket,"battleEnded");
  await start(hero.socket,"auto");const result=await finished;
  expect(result.character.weaponTraining.experience.staff).toBeGreaterThan(0);expect(result.character.weaponTraining.experience.shield).toBeGreaterThan(0);
  hero.socket.disconnect();const next=await connect(),restored=await authenticate(next,hero.token);
  expect(restored.character.weaponTraining?.experience.staff).toBe(result.character.weaponTraining.experience.staff);
  expect(restored.character.weaponTraining?.experience.shield).toBe(result.character.weaponTraining.experience.shield);
 });

});
