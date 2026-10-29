import { getCharacterStatistics, type CharacterSnapshot } from "@web-mmorpg/shared";
import { expect, it, vi } from "vitest";
import { HealingService, type HealingServiceDependencies } from "../src/healing/HealingService";

function setup() {
  let now=1000;
  const make=(id:string,hp:number)=>({playerId:id,nickname:id,level:1,hp,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[],statistics:getCharacterStatistics(1),weaponTraining:{experience:{sword:0,axe:0,hammer:0,dagger:0,spear:0,bow:0,crossbow:0,staff:0,shield:0},loadout:{melee:"sword",ranged:"bow",support:"staff"}}} as CharacterSnapshot);
  const chars=new Map<string,CharacterSnapshot>([["alice",make("alice",60)],["bob",make("bob",90)],["stranger",make("stranger",40)]]);
  const offline=new Set<string>(),busy=new Set<string>(),battling=new Set<string>();
  const positions=new Map([...chars.keys()].map(id=>[id,{locationId:"forest",x:0,y:0}]));
  const restoreHp=vi.fn((id:string,amount:number)=>{const char=chars.get(id)!;const restored=Math.min(amount,char.maxHp-char.hp);char.hp+=restored;return restored;});
  const trainStaff=vi.fn(),persist=vi.fn(async(_id:string)=>{}),push=vi.fn(async(_id:string)=>{});
  const deps:HealingServiceDependencies={getCharacter:id=>chars.get(id),isOnline:id=>chars.has(id)&&!offline.has(id),isBusy:id=>busy.has(id),isInBattle:id=>battling.has(id),getPartyMemberIds:id=>id==="stranger" ? [id] : ["alice","bob"],getPosition:id=>positions.get(id),restoreHp,trainStaff,persist,push};
  const service=new HealingService(deps,()=>now);
  return {service,deps,chars,offline,busy,battling,positions,restoreHp,trainStaff,persist,push,advance:(ms:number)=>{now+=ms;}};
}

it("lists only self and online party members with eligibility and actual healing power",()=>{
  const {service,chars,offline,positions}=setup();
  chars.get("alice")!.hp=100;positions.set("bob",{locationId:"forest",x:161,y:0});
  expect(service.getTargets("alice")).toMatchObject({ok:true,healingPower:20,cooldownMs:0,targets:[{id:"alice",available:false},{id:"bob",available:false}]});
  offline.add("bob");
  const result=service.getTargets("alice");expect(result.ok && result.targets.map(target=>target.id)).toEqual(["alice"]);
});

it("restores only missing party HP, trains once, persists both owners and preserves injuries",async()=>{
  const {service,chars,positions,restoreHp,trainStaff,persist}=setup();chars.get("bob")!.injuries=["bleeding"];
  positions.set("bob",{locationId:"forest",x:160,y:0});
  expect(await service.cast("alice",{requestId:"cast-1",targetId:"bob",ok:false,restoredHp:999})).toEqual({ok:true,requestId:"cast-1",targetId:"bob",restoredHp:10,cooldownMs:10000});
  expect(chars.get("bob")!.hp).toBe(100);expect(chars.get("bob")!.injuries).toEqual(["bleeding"]);
  expect(restoreHp).toHaveBeenCalledExactlyOnceWith("bob",20);expect(trainStaff).toHaveBeenCalledExactlyOnceWith("alice");
  expect(persist.mock.calls.map(([id])=>id).sort()).toEqual(["alice","bob"]);
  expect(service.getTargets("alice")).toMatchObject({ok:true,cooldownMs:10000});
});

it("heals self once for a replayed request and retains cooldown across offline/online changes",async()=>{
  const {service,chars,offline,advance,restoreHp,trainStaff,persist}=setup();
  const request={requestId:"self-1",targetId:"alice"};
  const first=await service.cast("alice",request);expect(first).toMatchObject({ok:true,restoredHp:20});
  expect(await service.cast("alice",request)).toEqual(first);
  expect(await service.cast("alice",{...request,targetId:"bob"})).toMatchObject({ok:false,code:"HEAL_REQUEST_CONFLICT"});
  offline.add("alice");offline.delete("alice");
  expect(await service.cast("alice",{requestId:"self-2",targetId:"alice"})).toMatchObject({ok:false,code:"HEAL_COOLDOWN"});
  expect(restoreHp).toHaveBeenCalledTimes(1);expect(trainStaff).toHaveBeenCalledTimes(1);expect(persist).toHaveBeenCalledTimes(1);
  advance(10000);expect(await service.cast("alice",{requestId:"self-2",targetId:"alice"})).toMatchObject({ok:true,restoredHp:20});expect(chars.get("alice")!.hp).toBe(100);
});

it.each([
  ["invalid", "INVALID_HEAL_REQUEST"], ["no staff","HEALING_STAFF_REQUIRED"], ["caster offline","PLAYER_OFFLINE"],
  ["target offline","PLAYER_OFFLINE"], ["stranger","HEAL_TARGET_NOT_IN_PARTY"], ["busy","HEAL_ACTION_PENDING"],
  ["battle","HEAL_BATTLE_IN_PROGRESS"], ["far","HEAL_OUT_OF_RANGE"], ["location","HEAL_OUT_OF_RANGE"],
  ["full","HEAL_NO_EFFECT"], ["dead","HEAL_TARGET_DOWN"]
])("rejects %s without training or state mutation",async(reason,code)=>{
  const {service,chars,offline,busy,battling,positions,restoreHp,trainStaff,persist}=setup();
  if(reason==="no staff")delete chars.get("alice")!.weaponTraining!.loadout.support;
  if(reason==="caster offline")offline.add("alice");if(reason==="target offline")offline.add("bob");
  if(reason==="busy")busy.add("bob");if(reason==="battle")battling.add("bob");
  if(reason==="far")positions.set("bob",{locationId:"forest",x:161,y:0});
  if(reason==="location")positions.set("bob",{locationId:"other",x:0,y:0});
  if(reason==="full")chars.get("bob")!.hp=100;if(reason==="dead")chars.get("bob")!.hp=0;
  const payload=reason==="invalid" ? {requestId:"",targetId:"bob"} : {requestId:"guard-1",targetId:reason==="stranger" ? "stranger" : "bob"};
  expect(await service.cast("alice",payload)).toMatchObject({ok:false,code});
  expect(restoreHp).not.toHaveBeenCalled();expect(trainStaff).not.toHaveBeenCalled();expect(persist).not.toHaveBeenCalled();
});

it("locks both participants before persistence and releases them before delayed presentation reads",async()=>{
  const {service,persist,push,restoreHp}=setup();let finish!:()=>void;
  const save=new Promise<void>(resolve=>{finish=resolve;});persist.mockImplementationOnce(async()=>save);
  push.mockImplementation(async()=>new Promise<void>(()=>{}));
  const cast=service.cast("alice",{requestId:"pending-1",targetId:"bob"});
  const replay=service.cast("alice",{requestId:"pending-1",targetId:"bob"});
  expect(service.pendingFor("alice")).toBeDefined();expect(service.pendingFor("bob")).toBeDefined();
  expect(await service.cast("bob",{requestId:"other-1",targetId:"alice"})).toMatchObject({ok:false,code:"HEAL_ACTION_PENDING"});
  finish();expect(await cast).toMatchObject({ok:true});expect(await replay).toMatchObject({ok:true});
  expect(service.pendingFor("alice")).toBeUndefined();expect(service.pendingFor("bob")).toBeUndefined();expect(restoreHp).toHaveBeenCalledTimes(1);
});

it("retries uncertain persistence with the same request without restoring or training twice",async()=>{
  const {service,persist,restoreHp,trainStaff}=setup();persist.mockRejectedValueOnce(new Error("database unavailable"));
  const request={requestId:"uncertain-1",targetId:"bob"};
  expect(await service.cast("alice",request)).toMatchObject({ok:false,code:"HEAL_SAVE_UNCERTAIN"});
  expect(await service.cast("alice",request)).toMatchObject({ok:true,restoredHp:10});
  expect(restoreHp).toHaveBeenCalledTimes(1);expect(trainStaff).toHaveBeenCalledTimes(1);
});
