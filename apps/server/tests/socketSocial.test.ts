import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { BattleSnapshot, PlayerStateSnapshot, SocialAction, SocialActionResult, SocialSnapshot } from "@web-mmorpg/shared";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { createGameServer } from "../src/server/createGameServer";

const pool=process.env.DATABASE_URL ? createPool(process.env.DATABASE_URL):null;
const describeDb=pool ? describe:describe.skip;
const clients:Socket[]=[];
let closeServer:(()=>Promise<void>)|undefined;
function once<T>(socket:Socket,event:string):Promise<T> {
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`TIMEOUT:${event}`)),3000);
    socket.once(event,value=>{clearTimeout(timer);resolve(value as T);});});
}
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
beforeAll(async()=>{if(pool){await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");await runMigrations(pool);await seedItemMetadata(pool);}});
beforeEach(async()=>{if(pool)await pool.query("TRUNCATE trade_receipts,item_instances,accounts CASCADE");});
afterEach(async()=>{for(const socket of clients.splice(0))socket.disconnect();await closeServer?.();closeServer=undefined;vi.restoreAllMocks();});
afterAll(async()=>{await pool?.end();});
async function setup() {
  if(!pool)throw new Error("DATABASE_REQUIRED");
  const lifecycle=new CharacterLifecycleService(pool),auth=new AuthService(pool,new AccountRepository(pool),lifecycle);
  const http=createServer();const game=createGameServer(http,{pool,authService:auth,characterLifecycle:lifecycle});
  await new Promise<void>(done=>http.listen(0,"127.0.0.1",done));
  const connect=async()=>{const socket=io(`http://127.0.0.1:${(http.address() as AddressInfo).port}`,{transports:["websocket"],forceNew:true});clients.push(socket);await once(socket,"connect");return socket;};
  closeServer=async()=>{await new Promise<void>(done=>game.io.close(()=>done()));if(http.listening)await new Promise<void>(done=>http.close(()=>done()));};
  const identity=async(name:string)=>{
    await auth.register(name,"correct-horse-battery-staple");
    const account=await new AccountRepository(pool).findByNormalizedUsername(name);
    const character=await lifecycle.createCharacter(account!.id,{nickname:`Hero${name}`,appearance:{}});
    await lifecycle.saveGameplayState(character.id,{locationId:"forest-settlement-01",x:1290,y:455,level:1,experience:0,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]});
    const {token}=await auth.login(name,"correct-horse-battery-staple");const socket=await connect();
    const state=once<PlayerStateSnapshot>(socket,"playerState");
    expect(await socket.timeout(2000).emitWithAck("authenticate",{sessionToken:token})).toMatchObject({ok:true});await state;
    return {id:character.id,nickname:character.nickname,socket,token};
  };
  return {game,connect,identity,lifecycle};
}
async function act(socket:Socket,action:SocialAction):Promise<SocialSnapshot> {
  const result:SocialActionResult=await socket.timeout(4000).emitWithAck("socialAction",action);
  if(!result.ok)throw new Error(result.code);return result.social;
}
async function state(socket:Socket):Promise<SocialSnapshot> {
  const result:SocialActionResult=await socket.timeout(4000).emitWithAck("requestSocialState");
  if(!result.ok)throw new Error(result.code);return result.social;
}

describeDb("authenticated social Socket.IO",()=>{
  it("requires authentication and persists consent-based friends with private per-character snapshots",async()=>{
    const {identity,connect}=await setup();const unauth=await connect();
    expect(await unauth.timeout(1000).emitWithAck("requestSocialState")).toMatchObject({ok:false,code:"AUTHENTICATION_REQUIRED"});
    const alice=await identity("alice"),bob=await identity("bob");
    expect((await act(alice.socket,{type:"requestFriend",nickname:bob.nickname})).outgoingFriendRequests[0]?.id).toBe(bob.id);
    const accepted=await act(bob.socket,{type:"respondFriend",playerId:alice.id,accept:true});
    expect(accepted.friends[0]).toMatchObject({id:alice.id,online:true});
    expect((await state(alice.socket)).selfId).toBe(alice.id);
    expect((await pool!.query("SELECT COUNT(*)::int AS count FROM friendships")).rows[0].count).toBe(1);
    expect(await bob.socket.timeout(1000).emitWithAck("socialAction",{type:"respondParty",inviteId:"fake",accept:"yes"})).toMatchObject({ok:false,code:"INVALID_SOCIAL_ACTION"});
  });

  it.each([{far:false},{far:true}])("splits shared battle XP and awards only admitted party members regardless of world distance (far:$far)",async({far})=>{
    const {identity,game}=await setup();const alice=await identity("alice"),bob=await identity("bob");
    await act(alice.socket,{type:"inviteParty",playerId:bob.id});
    const invites=(await state(bob.socket)).partyInvites;
    await act(bob.socket,{type:"respondParty",inviteId:invites[0]!.id,accept:true});
    const started=once<BattleSnapshot>(alice.socket,"battleStarted"),joined=once<BattleSnapshot>(bob.socket,"battleStarted");
    alice.socket.emit("startEncounter",{encounterId:"wolf-pack-01"});const battle=await started;
    expect((await joined).id).toBe(battle.id);
    const late=await identity("late");await act(alice.socket,{type:"inviteParty",playerId:late.id});
    await act(late.socket,{type:"respondParty",inviteId:(await state(late.socket)).partyInvites[0]!.id,accept:true});
    if(far)game.services.world.addPlayer({id:bob.id,nickname:bob.nickname,x:0,y:0});
    vi.spyOn(game.services.battles,"applyCommand").mockReturnValue({result:{ok:true,state:{} as never},snapshot:{...battle,finished:true},finished:true,victory:true,encounterId:"wolf-pack-01",seed:12345,participantIds:[alice.id,bob.id],initialParticipantCount:2,playerOutcomes:{[alice.id]:{hp:80,severelyInjured:false,injuries:[]},[bob.id]:{hp:80,severelyInjured:false,injuries:[]}},experienceReward:80});
    const ended=once<{experienceGained:number;partyBonusExperience?:number}>(alice.socket,"battleEnded"),bobEnded=once<{experienceGained:number;partyBonusExperience?:number}>(bob.socket,"battleEnded");
    alice.socket.emit("battleCommand",{type:"endTurn",combatantId:battle.activeCombatantId});
    for(const outcome of await Promise.all([ended,bobEnded])) {
      expect(outcome.experienceGained).toBe(44);expect(outcome.partyBonusExperience).toBe(4);
    }
    for(const id of [alice.id,bob.id])expect((await pool!.query("SELECT experience FROM characters WHERE id=$1",[id])).rows[0].experience).toBe(44);
    expect((await pool!.query("SELECT experience FROM characters WHERE id=$1",[late.id])).rows[0].experience).toBe(0);
  });

  it("pushes both committed inventories after partial barter and prevents receipt replay",async()=>{
    const {identity,game}=await setup();const alice=await identity("alice"),bob=await identity("bob");
    const pelt=(await game.services.inventory.addItems(alice.id,[{itemId:"wolf-pelt",quantity:3}])).items[0]!;
    const bandage=(await game.services.inventory.addItems(bob.id,[{itemId:"field-bandage",quantity:2}])).items[0]!;
    const invited=(await act(alice.socket,{type:"requestTrade",playerId:bob.id})).trade!;
    await act(bob.socket,{type:"respondTrade",tradeId:invited.id,accept:true});
    const first=(await act(alice.socket,{type:"setTradeOffer",tradeId:invited.id,revision:0,items:[{instanceId:pelt.instanceId,quantity:1}]})).trade!;
    const current=(await act(bob.socket,{type:"setTradeOffer",tradeId:invited.id,revision:first.revision,items:[{instanceId:bandage.instanceId,quantity:1}]})).trade!;
    await act(alice.socket,{type:"confirmTrade",tradeId:invited.id,revision:current.revision});
    const aliceInventory=once<PlayerStateSnapshot>(alice.socket,"playerState"),bobInventory=once<PlayerStateSnapshot>(bob.socket,"playerState");
    const completed=await act(bob.socket,{type:"confirmTrade",tradeId:invited.id,revision:current.revision});
    expect(completed.trade?.status).toBe("completed");
    expect((await aliceInventory).inventory.items).toEqual(expect.arrayContaining([expect.objectContaining({itemId:"field-bandage",quantity:1}),expect.objectContaining({itemId:"wolf-pelt",quantity:2})]));
    expect((await bobInventory).inventory.items).toEqual(expect.arrayContaining([expect.objectContaining({itemId:"wolf-pelt",quantity:1})]));
    await act(bob.socket,{type:"confirmTrade",tradeId:invited.id,revision:current.revision});
    expect((await pool!.query("SELECT COUNT(*)::int AS count FROM trade_receipts")).rows[0].count).toBe(1);
  });
});
