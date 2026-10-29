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

const target=process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const pool=target && ["localhost","127.0.0.1"].includes(target.hostname) && target.pathname==="/web_mmorpg_test" ? createPool(process.env.DATABASE_URL) : null;
const describeDb=pool ? describe : describe.skip;
const clients:Socket[]=[];
let closeServer:(()=>Promise<void>)|undefined;
const SETTLEMENT="forest-settlement-01",FOREST="eastern-forest-01",SPAWN="forest-boars-01";

function once<T>(socket:Socket,event:string,predicate:(value:T)=>boolean=()=>true):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off(event,receive);reject(new Error(`TIMEOUT:${event}`));},3500);
    function receive(value:T){if(!predicate(value))return;clearTimeout(timer);socket.off(event,receive);resolve(value);}
    socket.on(event,receive);
  });
}
beforeAll(async()=>{if(pool){await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");await runMigrations(pool);await seedItemMetadata(pool);}});
beforeEach(async()=>{if(pool)await pool.query("TRUNCATE item_instances,accounts,encounter_respawns CASCADE");});
afterEach(async()=>{for(const socket of clients.splice(0))socket.disconnect();await closeServer?.();closeServer=undefined;vi.restoreAllMocks();});
afterAll(async()=>{await pool?.end();});

async function setup(){
  if(!pool)throw new Error("TEST_DB_REQUIRED");
  const lifecycle=new CharacterLifecycleService(pool),accounts=new AccountRepository(pool);
  const auth=new AuthService(pool,accounts,lifecycle),http=createServer();
  const game=createGameServer(http,{pool,authService:auth,characterLifecycle:lifecycle,autoBattleStepMs:10});
  await new Promise<void>(done=>http.listen(0,"127.0.0.1",done));
  const connect=async()=>{const socket=io(`http://127.0.0.1:${(http.address() as AddressInfo).port}`,{transports:["websocket"],forceNew:true});clients.push(socket);await once(socket,"connect");return socket;};
  closeServer=async()=>{await new Promise<void>(done=>game.io.close(()=>done()));if(http.listening)await new Promise<void>(done=>http.close(()=>done()));};
  const authenticate=async(socket:Socket,token:string)=>{
    const state=once<PlayerStateSnapshot>(socket,"playerState");
    expect(await socket.timeout(3000).emitWithAck("authenticate",{sessionToken:token})).toMatchObject({ok:true});await state;
  };
  const identity=async(nickname:string,locationId=FOREST,x=480,y=410)=>{
    await auth.register(nickname.toLowerCase(),"correct-horse-battery-staple");
    const account=await accounts.findByNormalizedUsername(nickname.toLowerCase());
    const character=await lifecycle.createCharacter(account!.id,{nickname,appearance:{}});
    await lifecycle.saveGameplayState(character.id,{locationId,x,y,level:1,experience:0,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]});
    const {token}=await auth.login(nickname.toLowerCase(),"correct-horse-battery-staple");
    const socket=await connect();await authenticate(socket,token);return{id:character.id,nickname,socket,token};
  };
  const snapshot=async(socket:Socket)=>{const state=once<WorldStateSnapshot>(socket,"worldState");socket.emit("requestWorldState");return state;};
  return{game,identity,connect,authenticate,snapshot};
}

describeDb("eastern forest socket lifecycle",()=>{
  it("transfers rooms through both edge zones, rejects stale movement and persists the destination",async()=>{
    const {game,identity,connect,authenticate,snapshot}=await setup();
    const alice=await identity("ForestAlice",SETTLEMENT,1490,450),bob=await identity("ForestBob",SETTLEMENT,400,450);
    game.services.world.addPlayer({id:alice.id,nickname:alice.nickname,locationId:SETTLEMENT,x:1490,y:450},Date.now()-1000);
    const entered=once<WorldStateSnapshot>(alice.socket,"worldState",s=>s.locationId===FOREST);
    alice.socket.emit("moveIntent",{x:1540,y:450,locationId:SETTLEMENT});
    expect((await entered).players.find(p=>p.id===alice.id)).toMatchObject({x:150,y:600});
    expect((await snapshot(bob.socket)).players.some(p=>p.id===alice.id)).toBe(false);
    alice.socket.emit("moveIntent",{x:1500,y:450,locationId:SETTLEMENT});
    expect((await snapshot(alice.socket)).players.find(p=>p.id===alice.id)).toMatchObject({x:150,y:600});
    alice.socket.disconnect();
    const reconnected=await connect();await authenticate(reconnected,alice.token);
    expect((await snapshot(reconnected)).locationId).toBe(FOREST);
    game.services.world.addPlayer({id:alice.id,nickname:alice.nickname,locationId:FOREST,x:110,y:600},Date.now()-1000);
    const returned=once<WorldStateSnapshot>(reconnected,"worldState",s=>s.locationId===SETTLEMENT);
    reconnected.emit("moveIntent",{x:50,y:600,locationId:FOREST});
    expect((await returned).players.find(p=>p.id===alice.id)).toMatchObject({x:1450,y:450});
    expect((await snapshot(bob.socket)).players.some(p=>p.id===alice.id)).toBe(true);
  });

  it("admits the same-location party once and rejects another battle against the engaged spawn",async()=>{
    const {game,identity}=await setup();const alice=await identity("PartyForestAlice"),bob=await identity("PartyForestBob",FOREST,1800,1100),outsider=await identity("OtherForestHero");
    game.services.social.parties.invite(alice.id,bob.id);
    game.services.social.parties.respond(bob.id,game.services.social.parties.getInvites(bob.id)[0]!.id,true);
    const first=once<BattleSnapshot>(alice.socket,"battleStarted"),teammate=once<BattleSnapshot>(bob.socket,"battleStarted");
    alice.socket.emit("startEncounter",{encounterId:SPAWN});const battle=await first;
    expect((await teammate).id).toBe(battle.id);
    expect(battle.combatants.filter(unit=>unit.ownerPlayerId)).toHaveLength(2);
    const rejected=once<{code:string}>(outsider.socket,"commandRejected");outsider.socket.emit("startEncounter",{encounterId:SPAWN});
    expect(await rejected).toMatchObject({code:"ENCOUNTER_BUSY"});
  });

  it("starts one persisted three-minute countdown on victory and keeps it after server recreation",async()=>{
    const first=await setup(),alice=await first.identity("RespawnForestAlice"),bob=await first.identity("RespawnForestBob");
    const started=once<BattleSnapshot>(alice.socket,"battleStarted");alice.socket.emit("startEncounter",{encounterId:SPAWN});const battle=await started;
    const terminal={...battle,finished:true};
    vi.spyOn(first.game.services.battles,"applyCommand").mockReturnValue({result:{ok:true,state:{} as never},snapshot:terminal,finished:true,victory:true,encounterId:SPAWN,seed:12345,participantIds:[alice.id],initialParticipantCount:1,playerOutcomes:{[alice.id]:{hp:80,severelyInjured:false,injuries:[]}},experienceReward:80});
    const ended=once<{goldGained:number}>(alice.socket,"battleEnded"),before=Date.now();
    alice.socket.emit("battleCommand",{type:"endTurn",combatantId:battle.activeCombatantId});expect((await ended).goldGained).toBe(18);
    const dead=(await first.snapshot(bob.socket)).encounters.find(e=>e.id===SPAWN)!;
    expect(dead.status).toBe("respawning");expect(dead.respawnAt).toBeGreaterThanOrEqual(before+180000);expect(dead.respawnAt).toBeLessThan(Date.now()+180001);
    const denied=once<{code:string}>(bob.socket,"commandRejected");bob.socket.emit("startEncounter",{encounterId:SPAWN});expect(await denied).toMatchObject({code:"ENCOUNTER_RESPAWNING"});
    for(const socket of clients.splice(0))socket.disconnect();await closeServer?.();closeServer=undefined;vi.restoreAllMocks();
    const second=await setup(),next=await second.connect();await second.authenticate(next,bob.token);
    expect((await second.snapshot(next)).encounters.find(e=>e.id===SPAWN)).toMatchObject({status:"respawning",respawnAt:dead.respawnAt});
  });

  it("releases the spawn only after the final participant disconnects",async()=>{
    const {game,identity,snapshot}=await setup(),alice=await identity("LeaveForestAlice"),bob=await identity("LeaveForestBob"),next=await identity("NextForestHero");
    game.services.social.parties.invite(alice.id,bob.id);game.services.social.parties.respond(bob.id,game.services.social.parties.getInvites(bob.id)[0]!.id,true);
    const started=once<BattleSnapshot>(alice.socket,"battleStarted");alice.socket.emit("startEncounter",{encounterId:SPAWN});await started;alice.socket.disconnect();
    await vi.waitFor(()=>expect(game.services.world.getPlayer(alice.id)).toBeUndefined());
    expect((await snapshot(next.socket)).encounters.find(e=>e.id===SPAWN)?.status).toBe("engaged");bob.socket.disconnect();
    await vi.waitFor(()=>expect(game.services.world.getPlayer(bob.id)).toBeUndefined());
    expect((await snapshot(next.socket)).encounters.find(e=>e.id===SPAWN)?.status).toBe("alive");
    const again=once<BattleSnapshot>(next.socket,"battleStarted");next.socket.emit("startEncounter",{encounterId:SPAWN});expect((await again).finished).toBe(false);
  });
});
