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
  render() {} destroy() {} setLocalPlayerPosition() {} updateRemotePlayers() {} updateEncounters() {} getLocalPlayerObject() {}
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
  const world=(x=300,npcs:NpcSnapshot[]=[miro],y=420)=>transport.emit("worldState",{locationId:"forest-settlement-01",players:[{id:"hero",nickname:"Hero",x,y}],npcs,encounters:[{id:"wolves",label:"Wilki",x:800,y:420}]});
  const choose=(action:"talk"|"shop",npcId=miro.id)=>{renderer.onNpcSelected(npcId);document.querySelector<HTMLButtonElement>(`[data-npc-action="${action}"]`)!.click();};
  const step=(delta=100)=>{clock.now+=delta;scene.update(clock.now,delta);};
  return {scene,events,input,clock,cursors,renderer,world,choose,step};
}

beforeEach(()=>{
  document.body.replaceChildren();transport=new EventEmitter();
  vi.spyOn(gameSocket,"connect").mockReturnValue(transport as unknown as ReturnType<typeof gameSocket.connect>);
  vi.spyOn(gameSocket,"onConnectionState").mockImplementation(handler=>{connection=handler;handler("connected");return ()=>{};});
});
afterEach(()=>{for(const events of scenes.splice(0))events.emit("shutdown");vi.restoreAllMocks();document.body.replaceChildren();});

it("blocks map clicks in chrome and cancels queued movement while the HUD menu is open", () => {
  const move=vi.spyOn(gameSocket,"sendMoveIntent"),{world,input,cursors,step,scene}=setup();world();
  input.emit("pointerdown",{x:100,y:20,worldX:700,worldY:420});step();
  expect(move).not.toHaveBeenCalled();
  input.emit("pointerdown",{x:100,y:180,worldX:700,worldY:420});step();
  expect(move).toHaveBeenCalled();move.mockClear();
  document.querySelector<HTMLButtonElement>("[data-hud-menu-toggle]")!.click();cursors.right.isDown=true;step();
  expect(move).not.toHaveBeenCalled();expect(scene).toMatchObject({pointerTarget:null,navigationPath:[],pendingNpcAction:null});
  document.querySelector<HTMLButtonElement>("[data-menu-close]")!.click();step();expect(move).toHaveBeenCalled();
});

it("keeps desktop map movement available with persistent inline backpack contents", () => {
  vi.stubGlobal("matchMedia", () => ({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  const move=vi.spyOn(gameSocket,"sendMoveIntent"),{world,input,step}=setup();world();
  transport.emit("playerState",{character:{playerId:"hero",nickname:"Hero",level:1,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]},inventory:{items:[{instanceId:"permanent",itemId:"permanent-backpack",itemDefinitionId:"permanent-backpack",name:"Plecak",category:"container",description:"",quantity:1,rarity:"COMMON",upgradeLevel:0,permanentContainer:true,containerCapacity:16}],containerSlots:["permanent",null,null,null]}});
  expect(document.querySelector('.world-hud [data-container-contents]')?.getAttribute("role")).toBe("region");
  input.emit("pointerdown",{x:100,y:180,worldX:700,worldY:420});step();
  expect(move).toHaveBeenLastCalledWith({x:322,y:420,locationId:"forest-settlement-01"});
  vi.unstubAllGlobals();
});

it.each(["talk","shop"] as const)("walks before %s, keeps sending the endpoint, and acts once only after confirmed arrival",async action=>{
  const talk=vi.spyOn(gameSocket,"interactNpc"),shop=vi.spyOn(gameSocket,"requestMerchantShop").mockResolvedValue({ok:true,shop:{npcId:miro.id,npcName:miro.name,gold:100,offers:[]}});
  const moves:Array<{x:number;y:number;locationId?:string}>=[];transport.on("moveIntent",position=>moves.push({...position}));
  const {world,choose,step}=setup();world();choose(action);
  expect(talk).not.toHaveBeenCalled();expect(shop).not.toHaveBeenCalled();
  for(let i=0;i<12;i++)step();
  expect(moves[0]).toEqual({x:322,y:420,locationId:"forest-settlement-01"});
  expect(moves.slice(-2)).toEqual([{x:401,y:420,locationId:"forest-settlement-01"},{x:401,y:420,locationId:"forest-settlement-01"}]);
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

it("blocks keyboard movement at a rock instead of predicting through it",()=>{
  const moves:Array<{x:number;y:number}>=[];
  transport.on("moveIntent",position=>moves.push({...position}));
  const {world,cursors,step}=setup();world(1040,[],340);cursors.right.isDown=true;
  for(let i=0;i<5;i++)step();
  expect(moves.length).toBeGreaterThan(0);
  expect(moves.every(point=>point.x<=1058.01)).toBe(true);
});

it("places an old position inside a building on nearby ground and keeps reconciliation outside the wall",()=>{
  const {scene,world,step}=setup();world(625,[],560);step();
  const p=(scene as unknown as {localPosition:{x:number;y:number}}).localPosition;
  expect(p.x<=502.5 || p.x>=747.5 || p.y<=490 || p.y>=640).toBe(true);
});

it("routes a clicked destination around the healer building and sends the final endpoint",()=>{
  const moves:Array<{x:number;y:number}>=[];
  const {world,input,step}=setup();world(450,[],560);
  transport.on("moveIntent",position=>{moves.push({...position});world(position.x,[],position.y);});
  input.emit("pointerdown",{worldX:800,worldY:560});
  for(let i=0;i<200;i++)step(50);
  expect(moves.length).toBeGreaterThan(0);
  expect(moves.every(p=>p.x<=502.5 || p.x>=747.5 || p.y<=490 || p.y>=640)).toBe(true);
  expect(moves.at(-1)).toMatchObject({x:800,y:560});
});

it("sends a short clicked route's final endpoint even if it finishes before the next packet interval",()=>{
  const move=vi.spyOn(gameSocket,"sendMoveIntent");
  const {world,input,step}=setup();world();input.emit("pointerdown",{worldX:301,worldY:420});
  step(16);expect(move).not.toHaveBeenCalled();step(40);
  expect(move).toHaveBeenLastCalledWith({x:301,y:420,locationId:"forest-settlement-01"});
});

it("reaches Ada outside her building and talks only after a confirmed reachable arrival",()=>{
  const ada:NpcSnapshot={id:"healer-ada",name:"Ada",kind:"healer",x:720,y:535,interactionRadius:95};
  const talk=vi.spyOn(gameSocket,"interactNpc"),moves:Array<{x:number;y:number}>=[];
  const {world,choose,step}=setup();world(450,[ada],560);
  transport.on("moveIntent",position=>{moves.push({...position});world(position.x,[ada],position.y);});
  choose("talk",ada.id);expect(talk).not.toHaveBeenCalled();
  for(let i=0;i<200 && talk.mock.calls.length===0;i++)step(50);
  expect(moves.every(p=>p.x<=502.5 || p.x>=747.5 || p.y<=490 || p.y>=640)).toBe(true);
  expect(talk).toHaveBeenCalledExactlyOnceWith(ada.id);
  const arrived=moves.at(-1)!;
  expect(Math.hypot(arrived.x-ada.x,arrived.y-ada.y)).toBeLessThanOrEqual(ada.interactionRadius);
});
