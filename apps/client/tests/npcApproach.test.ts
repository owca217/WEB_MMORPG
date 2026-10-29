/* @vitest-environment jsdom */
import { EventEmitter } from "node:events";
import type { NpcSnapshot } from "@web-mmorpg/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({ default: {
  Scene: class {}, Scenes: { Events: { SHUTDOWN: "shutdown" } },
  Math: { Clamp: (n:number,min:number,max:number)=>Math.max(min,Math.min(n,max)),
    Linear: (a:number,b:number,t:number)=>a+(b-a)*t,
    Distance: { Between: (x:number,y:number,u:number,v:number)=>Math.hypot(u-x,v-y) } }
} }));
vi.mock("../src/world/ForestSettlementRenderer", () => ({ ForestSettlementRenderer: class { render() {} destroy() {} } }));
vi.mock("../src/world/WorldEntitiesRenderer", () => ({ WorldEntitiesRenderer: class {
  render() {} destroy() {} setLocalPlayerPosition() {} updateRemotePlayers() {} getLocalPlayerObject() {}
} }));
import { gameSocket } from "../src/net/GameSocket";
import { WorldScene } from "../src/scenes/WorldScene";

const miro:NpcSnapshot={id:"merchant-miro",name:"Miro",kind:"merchant",x:480,y:420,interactionRadius:95};
let transport:EventEmitter;
let connection:(state:"connected"|"disconnected")=>void;
const scenes:EventEmitter[]=[];

function setup() {
  const scene=new WorldScene(),events=new EventEmitter(),input=new EventEmitter(),clock={now:0,delayedCall:vi.fn()};
  const cursors={left:{isDown:false},right:{isDown:false},up:{isDown:false},down:{isDown:false}};
  Object.assign(scene,{events,time:clock,cameras:{main:{setBackgroundColor(){},setBounds(){}}},physics:{world:{setBounds(){}}},textures:{exists:()=>false},input,add:{text:()=>({setScrollFactor(){return this;},setOrigin(){return this;},setDepth(){return this;},destroy(){}})}});
  scene.init({playerId:"hero"});scene.create();Object.assign(scene,{cursors});scenes.push(events);
  const renderer=(scene as unknown as {entitiesRenderer:{onNpcSelected:(id:string)=>void;onEncounterSelected:(id:string)=>void}}).entitiesRenderer;
  const world=(x=300,npcs:NpcSnapshot[]=[miro])=>transport.emit("worldState",{locationId:"forest-settlement-01",players:[{id:"hero",nickname:"Hero",x,y:420}],npcs,encounters:[{id:"wolves",label:"Wilki",x:800,y:420}]});
  const choose=(action:"talk"|"shop")=>{renderer.onNpcSelected(miro.id);document.querySelector<HTMLButtonElement>(`[data-npc-action="${action}"]`)!.click();};
  const step=(delta=100)=>{clock.now+=delta;scene.update(clock.now,delta);};
  return {scene,events,input,clock,cursors,renderer,world,choose,step};
}

beforeEach(()=>{
  document.body.replaceChildren();transport=new EventEmitter();
  vi.spyOn(gameSocket,"connect").mockReturnValue(transport as unknown as ReturnType<typeof gameSocket.connect>);
  vi.spyOn(gameSocket,"onConnectionState").mockImplementation(handler=>{connection=handler;handler("connected");return ()=>{};});
});
afterEach(()=>{for(const events of scenes.splice(0))events.emit("shutdown");vi.restoreAllMocks();document.body.replaceChildren();});

it.each(["talk","shop"] as const)("walks before %s, keeps sending the endpoint, and acts once only after confirmed arrival",async action=>{
  const talk=vi.spyOn(gameSocket,"interactNpc"),shop=vi.spyOn(gameSocket,"requestMerchantShop").mockResolvedValue({ok:true,shop:{npcId:miro.id,npcName:miro.name,gold:100,offers:[]}});
  const moves:Array<{x:number;y:number}>=[];transport.on("moveIntent",position=>moves.push({...position}));
  const {world,choose,step}=setup();world();choose(action);
  expect(talk).not.toHaveBeenCalled();expect(shop).not.toHaveBeenCalled();
  for(let i=0;i<12;i++)step();
  expect(moves[0]).toEqual({x:322,y:420});
  expect(moves.slice(-2)).toEqual([{x:401,y:420},{x:401,y:420}]);
  expect(talk).not.toHaveBeenCalled();expect(shop).not.toHaveBeenCalled();
  world(384);expect(talk).not.toHaveBeenCalled();expect(shop).not.toHaveBeenCalled();
  world(385);world(390);step();await Promise.resolve();
  if(action==="talk") {
    expect(talk).toHaveBeenCalledExactlyOnceWith(miro.id);expect(shop).not.toHaveBeenCalled();
    transport.emit("npcInteraction",{npcId:miro.id,npcName:miro.name,kind:miro.kind,title:"Miro",lines:["Witaj"],canHeal:false});
    expect(document.querySelector(".dialogue-panel")?.classList.contains("is-hidden")).toBe(false);
  }else {
    expect(shop).toHaveBeenCalledExactlyOnceWith(miro.id);expect(talk).not.toHaveBeenCalled();
    expect(document.querySelector("[data-merchant-panel]")?.classList.contains("is-hidden")).toBe(false);
  }
});

it("executes an already reachable option immediately without moving",()=>{
  const talk=vi.spyOn(gameSocket,"interactNpc"),move=vi.spyOn(gameSocket,"sendMoveIntent");
  const {world,choose,step}=setup();world(400);choose("talk");step();
  expect(talk).toHaveBeenCalledExactlyOnceWith(miro.id);expect(move).not.toHaveBeenCalled();
});

it.each(["pointer","keyboard","new NPC","monster","typing","disconnect","removed NPC","removed player","shutdown"])("cancels deferred interaction on %s",reason=>{
  const talk=vi.spyOn(gameSocket,"interactNpc");
  const {scene,events,input,cursors,renderer,world,choose,step}=setup();world();choose("talk");step();
  if(reason==="pointer")input.emit("pointerdown",{worldX:100,worldY:200});
  if(reason==="keyboard"){cursors.left.isDown=true;step();cursors.left.isDown=false;}
  if(reason==="new NPC")renderer.onNpcSelected(miro.id);
  if(reason==="monster")renderer.onEncounterSelected("wolves");
  if(reason==="typing"){Object.assign(scene,{chat:{isTyping:true,destroy(){},updateViewport(){}}});step();}
  if(reason==="disconnect")connection("disconnected");
  if(reason==="removed NPC")world(300,[]);
  if(reason==="removed player")transport.emit("worldState",{locationId:"forest-settlement-01",players:[],npcs:[miro],encounters:[]});
  if(reason==="shutdown")events.emit("shutdown");
  world(400);expect(talk).not.toHaveBeenCalled();
});

it("stops an approach when the server has confirmed no progress for five seconds",()=>{
  const talk=vi.spyOn(gameSocket,"interactNpc"),move=vi.spyOn(gameSocket,"sendMoveIntent");
  const {world,choose,step}=setup();world();choose("talk");
  for(let i=0;i<50;i++)step();
  const attempts=move.mock.calls.length;step();world(400);
  expect(move).toHaveBeenCalledTimes(attempts);expect(talk).not.toHaveBeenCalled();
});
