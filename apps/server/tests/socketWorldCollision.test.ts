import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isWorldPositionWalkable, type PlayerStateSnapshot, type WorldStateSnapshot } from "@web-mmorpg/shared";
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

describeDb("authenticated world collisions",()=>{
  it("stops a long movement command at a building and persists the safe position on reconnect",async()=>{
    const {game,identity,connect,authenticate,snapshot}=await setup();
    const alice=await identity("CollisionAlice",SETTLEMENT,400,235);
    game.services.world.addPlayer({id:alice.id,nickname:alice.nickname,locationId:SETTLEMENT,x:400,y:235},Date.now()-100000);
    alice.socket.emit("moveIntent",{x:100,y:235,locationId:SETTLEMENT});
    const stopped=(await snapshot(alice.socket)).players.find(p=>p.id===alice.id)!;
    expect(stopped.x).toBeGreaterThan(370);
    expect(stopped.x).toBeLessThan(400);
    expect(isWorldPositionWalkable(SETTLEMENT,stopped)).toBe(true);
    alice.socket.disconnect();const next=await connect();await authenticate(next,alice.token);
    expect((await snapshot(next)).players.find(p=>p.id===alice.id)).toMatchObject({x:stopped.x,y:stopped.y});
  });

  it("moves old inside-obstacle saves to safe ground and keeps the gate and teleport traversable",async()=>{
    const {game,identity,snapshot}=await setup();
    const alice=await identity("CollisionRescue",SETTLEMENT,245,235);
    const rescued=(await snapshot(alice.socket)).players.find(p=>p.id===alice.id)!;
    expect(isWorldPositionWalkable(SETTLEMENT,rescued)).toBe(true);
    expect(Math.hypot(rescued.x-245,rescued.y-235)).toBeGreaterThan(10);
    game.services.world.addPlayer({id:alice.id,nickname:alice.nickname,locationId:SETTLEMENT,x:850,y:450},Date.now()-1000);
    alice.socket.emit("moveIntent",{x:1000,y:450,locationId:SETTLEMENT});
    expect((await snapshot(alice.socket)).players.find(p=>p.id===alice.id)).toMatchObject({x:1000,y:450});
    game.services.world.addPlayer({id:alice.id,nickname:alice.nickname,locationId:SETTLEMENT,x:1480,y:450},Date.now()-1000);
    const transferred=once<WorldStateSnapshot>(alice.socket,"worldState",s=>s.locationId===FOREST);
    alice.socket.emit("moveIntent",{x:1540,y:450,locationId:SETTLEMENT});
    const arrived=(await transferred).players.find(p=>p.id===alice.id)!;
    expect(arrived).toMatchObject({x:150,y:600});expect(isWorldPositionWalkable(FOREST,arrived)).toBe(true);
  });
});
