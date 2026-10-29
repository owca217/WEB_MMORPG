/* @vitest-environment jsdom */

import { EventEmitter } from "node:events";
import type { InventorySnapshot, PlayerStateSnapshot } from "@web-mmorpg/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({ default: {
  Scene: class {}, Scenes: { Events: { SHUTDOWN: "shutdown" } }
} }));
// These renderers only draw the map; keep the scene lifecycle, transport and DOM HUD real.
vi.mock("../src/world/ForestSettlementRenderer", () => ({ ForestSettlementRenderer: class {
  render() {} destroy() {}
} }));
vi.mock("../src/world/EasternForestRenderer", () => ({ EasternForestRenderer: class {
  render() {} destroy() {}
} }));
vi.mock("../src/world/WorldEntitiesRenderer", () => ({ WorldEntitiesRenderer: class {
  render() {} destroy() {} setLocalPlayerPosition() {} getLocalPlayerObject() {}
} }));

import { gameSocket } from "../src/net/GameSocket";
import { WorldScene } from "../src/scenes/WorldScene";
import { playerStateStore } from "../src/state/PlayerStateStore";
import { socialStateStore } from "../src/state/SocialStateStore";

let transport: EventEmitter;

it("switches location bounds, discards old movement and snaps prediction at the forest entrance",()=>{
  const scene=new WorldScene(),events=new EventEmitter();
  const camera={setBackgroundColor:vi.fn(),setBounds:vi.fn(),stopFollow:vi.fn(),centerOn:vi.fn()};
  const bounds=vi.fn();
  Object.assign(scene,{events,cameras:{main:camera},physics:{world:{setBounds:bounds}},textures:{exists:()=>false},time:{now:0},input:{on(){}}});
  scene.init({playerId:"hero"});scene.create();
  transport.emit("worldState",{locationId:"forest-settlement-01",players:[{id:"hero",nickname:"Hero",x:1550,y:455}],npcs:[],encounters:[]});
  Object.assign(scene,{pointerTarget:{x:1600,y:455},navigationPath:[{x:1580,y:455}],navigationKey:"old",pendingFinalIntent:true,selectedEncounterId:"old",pendingNpcAction:{npcId:"old"}});
  transport.emit("worldState",{locationId:"eastern-forest-01",location:{name:"Gęsty Las",width:2000,height:1200,theme:"dense-forest"},players:[{id:"hero",nickname:"Hero",x:150,y:600}],npcs:[],encounters:[]});
  expect(camera.setBounds).toHaveBeenLastCalledWith(0,0,2000,1200);
  expect(bounds).toHaveBeenLastCalledWith(0,0,2000,1200);
  expect(scene).toMatchObject({pointerTarget:null,navigationPath:[],navigationKey:null,pendingFinalIntent:false,pendingNpcAction:null,selectedEncounterId:null,localPosition:{x:150,y:600},authoritativePosition:{x:150,y:600}});
  expect(camera.centerOn).toHaveBeenLastCalledWith(150,600);
  expect(document.querySelector('[data-location-name]')?.textContent).toBe("Gęsty Las");
  events.emit("shutdown");
});

it("applies an acknowledged weapon style while retaining newer character state, inventory and gold",async()=>{
  let finish!:(value:any)=>void;
  vi.spyOn(gameSocket,"setWeaponLoadout").mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const scene=new WorldScene(),events=new EventEmitter();
  Object.assign(scene,{events,cameras:{main:{setBackgroundColor(){},setBounds(){}}},physics:{world:{setBounds(){}}},textures:{exists:()=>false},input:{on(){}}});
  scene.init({playerId:"hero"});scene.create();
  const character={playerId:"hero",nickname:"Hero",level:1,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
  transport.emit("playerState",{character,inventory:{items:[]},gold:100});
  document.querySelector<HTMLButtonElement>("[data-character]")!.click();
  const melee=document.querySelector<HTMLSelectElement>("[data-weapon-melee]")!;
  melee.value="axe";melee.dispatchEvent(new Event("change",{bubbles:true}));
  document.querySelector<HTMLButtonElement>("[data-save-weapon-style]")!.click();
  const inventory:InventorySnapshot={items:[{instanceId:"new-bag",itemId:"rag-bag",itemDefinitionId:"rag",name:"Worek",category:"container",description:"",quantity:1,rarity:"COMMON",upgradeLevel:0}]};
  transport.emit("playerState",{character:{...character,level:2,experience:150,hp:77,maxHp:130,severelyInjured:true,injuries:["bleeding"]},inventory,gold:70});
  finish({ok:true,character:{...character,weaponTraining:{experience:{sword:0,axe:25250,hammer:0,dagger:0,spear:0,bow:0,crossbow:0},loadout:{melee:"axe",ranged:"bow"}}}});
  await vi.waitFor(()=>expect(playerStateStore.get()?.character.weaponTraining?.loadout.melee).toBe("axe"));
  expect(playerStateStore.get()?.inventory.items[0]?.instanceId).toBe("new-bag");
  expect(playerStateStore.get()?.gold).toBe(70);
  expect(playerStateStore.get()?.character).toMatchObject({level:2,experience:150,hp:77,maxHp:130,severelyInjured:true,injuries:["bleeding"],statistics:{meleeDamage:28,rangedDamage:16,strength:12}});
  expect(document.querySelector('[data-stat="hp"]')?.textContent).toBe("77/130");
  events.emit("shutdown");
});

it("opens the monster menu without starting combat and forwards the explicit mode choice",()=>{
  const start=vi.spyOn(gameSocket,"startEncounter");
  const scene=new WorldScene(),events=new EventEmitter();
  Object.assign(scene,{events,cameras:{main:{setBackgroundColor(){},setBounds(){}}},physics:{world:{setBounds(){}}},textures:{exists:()=>false},time:{now:0},input:{on(){}}});
  scene.init({playerId:"hero"});scene.create();
  transport.emit("worldState",{locationId:"forest-settlement-01",players:[],npcs:[],encounters:[{id:"wolf-pack-01",label:"Wilki",x:800,y:400}]});
  const renderer=(scene as unknown as {entitiesRenderer:{onEncounterSelected:(id:string)=>void}}).entitiesRenderer;
  renderer.onEncounterSelected("wolf-pack-01");
  expect(start).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLElement>("[data-encounter-menu]")?.hidden).toBe(false);
  document.querySelector<HTMLButtonElement>('[data-encounter-mode="auto"]')!.click();
  expect(start).toHaveBeenCalledExactlyOnceWith("wolf-pack-01","auto");
  renderer.onEncounterSelected("wolf-pack-01");
  document.querySelector<HTMLButtonElement>('[data-encounter-mode="manual"]')!.click();
  expect(start).toHaveBeenLastCalledWith("wolf-pack-01","manual");
  events.emit("shutdown");expect(document.querySelector("[data-encounter-menu]")).toBeNull();
});

it("releases captured movement keys while typing chat and restores them when the window closes", async () => {
  vi.spyOn(gameSocket,"onConnectionState").mockImplementation(handler=>{handler("connected");return ()=>{};});
  const keyboard={enabled:true,resetKeys:vi.fn(),disableGlobalCapture:vi.fn(),enableGlobalCapture:vi.fn(),createCursorKeys:()=>({}),addKeys:()=>({})};
  const scene=new WorldScene(); const events=new EventEmitter();
  Object.assign(scene,{events,cameras:{main:{setBackgroundColor(){},setBounds(){}}},physics:{world:{setBounds(){}}},textures:{exists:()=>false},input:{on(){},keyboard}});
  scene.init({playerId:"hero"});scene.create();
  document.querySelector<HTMLButtonElement>("[data-chat-toggle]")!.click();
  await Promise.resolve();
  expect(keyboard.enabled).toBe(false);expect(keyboard.disableGlobalCapture).toHaveBeenCalled();
  socialStateStore.set({selfId:"hero",onlinePlayers:[],friends:[],incomingFriendRequests:[],outgoingFriendRequests:[],party:null,partyInvites:[],trade:null});
  document.querySelector<HTMLButtonElement>("[data-social-toggle]")!.click();
  document.querySelector<HTMLButtonElement>('[data-social-tab="friends"]')!.click();
  document.querySelector<HTMLInputElement>("[data-friend-nickname]")!.focus();
  await Promise.resolve();expect(keyboard.enabled).toBe(false);
  document.querySelector<HTMLTextAreaElement>("[data-chat-input]")!.focus();
  await Promise.resolve();expect(keyboard.enabled).toBe(false);
  document.querySelector<HTMLTextAreaElement>("[data-chat-input]")!.value="wasd";
  document.querySelector<HTMLButtonElement>("[data-chat-panel] [data-close]")!.click();
  await Promise.resolve();
  expect(keyboard.enabled).toBe(true);expect(keyboard.enableGlobalCapture).toHaveBeenCalled();
  expect(transport.listenerCount("chatMessage")).toBe(1);
  events.emit("shutdown");
  expect(transport.listenerCount("chatMessage")).toBe(0);
  expect(document.querySelector("[data-chat-widget]")).toBeNull();
  expect(document.querySelector("[data-social-widget]")).toBeNull();socialStateStore.reset();
});

it("opens the merchant only after choosing Sklep and applies a purchase to inventory and gold HUD",async()=>{
  const shop={npcId:"merchant-miro",npcName:"Miro",gold:100,offers:[{itemId:"rag-bag",name:"Szmaciany worek",description:"Osiem miejsc",categoryId:"container",unitPrice:30,maxQuantity:1,capacity:8}]};
  const inventory:InventorySnapshot={items:[{instanceId:"bag",itemId:"rag-bag",itemDefinitionId:"def",name:"Szmaciany worek",category:"container",quantity:1,description:"",rarity:"COMMON",upgradeLevel:0,containerCapacity:8}]};
  const requestShop=vi.spyOn(gameSocket,"requestMerchantShop").mockResolvedValue({ok:true,shop});
  const talk=vi.spyOn(gameSocket,"interactNpc");
  vi.spyOn(gameSocket,"purchaseMerchantItem").mockResolvedValue({ok:true,shop:{...shop,gold:70},inventory});
  const scene=new WorldScene(),events=new EventEmitter();
  Object.assign(scene,{events,cameras:{main:{setBackgroundColor(){},setBounds(){}}},physics:{world:{setBounds(){}}},textures:{exists:()=>false},time:{now:0},input:{on(){}}});
  scene.init({playerId:"hero"});scene.create();
  transport.emit("playerState",{character:{playerId:"hero",nickname:"Hero",level:1,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]},inventory:{items:[]},gold:100});
  transport.emit("worldState",{locationId:"forest-settlement-01",players:[{id:"hero",nickname:"Hero",x:480,y:420}],encounters:[],npcs:[{id:shop.npcId,name:"Miro",kind:"merchant",x:480,y:420,interactionRadius:95}]});
  const renderer=(scene as unknown as {entitiesRenderer:{onNpcSelected:(id:string)=>void}}).entitiesRenderer;
  renderer.onNpcSelected(shop.npcId);
  expect(requestShop).not.toHaveBeenCalled();expect(talk).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-npc-action="shop"]')!.click();
  await vi.waitFor(()=>expect(document.querySelector<HTMLElement>("[data-merchant-panel]")?.classList.contains("is-hidden")).toBe(false));
  document.querySelector<HTMLButtonElement>('[data-merchant-buy="rag-bag"]')!.click();
  await vi.waitFor(()=>expect(playerStateStore.get()?.gold).toBe(70));
  expect(playerStateStore.get()?.inventory.items[0]?.itemId).toBe("rag-bag");
  expect(document.querySelector("[data-gold]")?.textContent).toBe("70");
  events.emit("shutdown");expect(document.querySelector("[data-merchant-panel]")).toBeNull();
});

it("routes Rozmowa to dialogue for both merchant and healer, retaining the healer action",()=>{
  const talk=vi.spyOn(gameSocket,"interactNpc"),shop=vi.spyOn(gameSocket,"requestMerchantShop"),heal=vi.spyOn(gameSocket,"healAtNpc");
  const scene=new WorldScene(),events=new EventEmitter();
  Object.assign(scene,{events,cameras:{main:{setBackgroundColor(){},setBounds(){}}},physics:{world:{setBounds(){}}},textures:{exists:()=>false},time:{now:0},input:{on(){}}});
  scene.init({playerId:"hero"});scene.create();
  transport.emit("worldState",{locationId:"forest-settlement-01",players:[{id:"hero",nickname:"Hero",x:545,y:420}],encounters:[],npcs:[{id:"merchant-miro",name:"Miro",kind:"merchant",x:480,y:420,interactionRadius:95},{id:"healer-ada",name:"Ada",kind:"healer",x:560,y:420,interactionRadius:95}]});
  const renderer=(scene as unknown as {entitiesRenderer:{onNpcSelected:(id:string)=>void}}).entitiesRenderer;
  renderer.onNpcSelected("merchant-miro");
  document.querySelector<HTMLButtonElement>('[data-npc-action="talk"]')!.click();
  expect(talk).toHaveBeenLastCalledWith("merchant-miro");
  transport.emit("npcInteraction",{npcId:"merchant-miro",npcName:"Miro",kind:"merchant",title:"Zaopatrzenie",lines:["Towary na drogę."],canHeal:false});
  expect(document.querySelector(".dialogue-panel")?.textContent).toContain("Towary na drogę.");
  expect(document.querySelector(".dialogue-panel")?.classList.contains("is-hidden")).toBe(false);
  expect(shop).not.toHaveBeenCalled();
  renderer.onNpcSelected("healer-ada");
  expect(document.querySelector<HTMLButtonElement>('[data-npc-action="shop"]')?.hidden).toBe(true);
  document.querySelector<HTMLButtonElement>('[data-npc-action="talk"]')!.click();
  transport.emit("npcInteraction",{npcId:"healer-ada",npcName:"Ada",kind:"healer",title:"Lecznica",lines:[],canHeal:true});
  document.querySelector<HTMLButtonElement>("[data-heal]")!.click();expect(heal).toHaveBeenCalledWith("healer-ada");
  events.emit("shutdown");expect(document.querySelector("[data-npc-menu]")).toBeNull();
});

it("ignores delayed shop and dialogue responses after selecting a different NPC",async()=>{
  let finishShop!:(result:unknown)=>void;
  vi.spyOn(gameSocket,"requestMerchantShop").mockImplementation(()=>new Promise(resolve=>{finishShop=resolve as typeof finishShop;}));
  const scene=new WorldScene(),events=new EventEmitter();
  Object.assign(scene,{events,cameras:{main:{setBackgroundColor(){},setBounds(){}}},physics:{world:{setBounds(){}}},textures:{exists:()=>false},time:{now:0},input:{on(){}}});
  scene.init({playerId:"hero"});scene.create();
  transport.emit("worldState",{locationId:"forest-settlement-01",players:[{id:"hero",nickname:"Hero",x:545,y:420}],encounters:[],npcs:[{id:"merchant-miro",name:"Miro",kind:"merchant",x:480,y:420,interactionRadius:95},{id:"guide-boran",name:"Boran",kind:"guide",x:610,y:420,interactionRadius:95}]});
  const renderer=(scene as unknown as {entitiesRenderer:{onNpcSelected:(id:string)=>void}}).entitiesRenderer;
  renderer.onNpcSelected("merchant-miro");document.querySelector<HTMLButtonElement>('[data-npc-action="shop"]')!.click();
  renderer.onNpcSelected("guide-boran");document.querySelector<HTMLButtonElement>('[data-npc-action="talk"]')!.click();
  transport.emit("npcInteraction",{npcId:"merchant-miro",npcName:"Miro",kind:"merchant",title:"Stare",lines:[],canHeal:false});
  expect(document.querySelector(".dialogue-panel")?.classList.contains("is-hidden")).toBe(true);
  transport.emit("npcInteraction",{npcId:"guide-boran",npcName:"Boran",kind:"guide",title:"Las",lines:["Aktualna rozmowa"],canHeal:false});
  finishShop({ok:true,shop:{npcId:"merchant-miro",npcName:"Miro",gold:100,offers:[]}});
  await Promise.resolve();await Promise.resolve();
  expect(document.querySelector("[data-merchant-panel]")?.classList.contains("is-hidden")).toBe(true);
  expect(document.querySelector(".dialogue-panel")?.textContent).toContain("Aktualna rozmowa");
  events.emit("shutdown");
});

beforeEach(() => {
  document.body.replaceChildren();
  transport = new EventEmitter();
  vi.spyOn(gameSocket, "connect").mockReturnValue(
    transport as unknown as ReturnType<typeof gameSocket.connect>
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("displays the battle summary after scene creation and clears it on the next entry", () => {
  const scene = new WorldScene();
  const events = new EventEmitter();
  Object.assign(scene, {
    events,
    cameras: { main: { setBackgroundColor() {}, setBounds() {} } },
    physics: { world: { setBounds() {} } },
    textures: { exists: () => false },
    input: { on() {} }
  });
  scene.init({ playerId: "hero", battleResult: {
    outcome: "victory", experienceGained: 80, levelsGained: 1, level: 2
  } });
  scene.create();

  expect(document.querySelector("[data-battle-result]")?.textContent).toContain("+80 XP");
  expect(document.querySelector("[data-battle-result]")?.textContent).toContain("poziom 2");
  expect(transport.listenerCount("playerState")).toBe(1);
  events.emit("shutdown");
  expect(document.querySelector(".world-hud")).toBeNull();
  expect(transport.listenerCount("playerState")).toBe(0);

  scene.init({ playerId: "hero" });
  scene.create();
  expect(document.querySelector<HTMLElement>("[data-battle-result]")?.hidden).toBe(true);
  expect(transport.listenerCount("playerState")).toBe(1);
  events.emit("shutdown");
});

it("opens the HUD container slot and applies the acknowledged inventory to the HUD and stored player state", async () => {
  const scene = new WorldScene();
  const events = new EventEmitter();
  Object.assign(scene, {
    events,
    cameras: { main: { setBackgroundColor() {}, setBounds() {} } },
    physics: { world: { setBounds() {} } },
    textures: { exists: () => false },
    input: { on() {} }
  });
  const inventory: InventorySnapshot = {
    items: [{ instanceId: "bag", itemId: "bag", itemDefinitionId: "bag", name: "Torba podróżna", quantity: 1,
      category: "container", description: "Torba", rarity: "COMMON", upgradeLevel: 0 }],
    containerSlots: [null, null, null, null]
  };
  const state: PlayerStateSnapshot = {
    character: { playerId: "hero", nickname: "Owczy", level: 1, experience: 0, hp: 100, maxHp: 100,
      maxAp: 4, initiative: 10, severelyInjured: false, injuries: [] },
    inventory
  };
  let request: unknown;
  let acknowledge!: (result: unknown) => void;
  Object.assign(transport, {
    timeout: () => ({ emitWithAck: (event: string, payload: unknown) => {
      request = { event, payload };
      return new Promise((resolve) => { acknowledge = resolve; });
    } })
  });
  scene.init({ playerId: "hero" });
  scene.create();
  transport.emit("playerState", state);
  document.querySelector<HTMLButtonElement>('[data-container-slot="2"]')!.click();

  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(false);
  document.querySelector<HTMLButtonElement>('[data-container-instance="bag"]')!.click();
  expect(request).toEqual({ event: "setContainerSlot", payload: { slotIndex: 2, itemInstanceId: "bag" } });
  expect(document.querySelector('[data-container-slot="2"]')?.getAttribute("aria-label")).toBe("Pojemnik 3: pusty. Wybierz pojemnik");

  const acknowledged: InventorySnapshot = { ...inventory, containerSlots: [null, null, "bag", null] };
  acknowledge({ ok: true, inventory: acknowledged });
  await vi.waitFor(() => expect(document.querySelector('[data-container-slot="2"]')?.textContent).toContain("Torba podróżna"));
  expect(playerStateStore.get()?.inventory).toEqual(acknowledged);
  events.emit("shutdown");
  expect(document.querySelector("[data-container-picker]")).toBeNull();
});

it("opens eight-place contents for an equipped bag and can switch to the container chooser", () => {
  const scene = new WorldScene();
  const events = new EventEmitter();
  Object.assign(scene, {
    events, cameras: { main: { setBackgroundColor() {}, setBounds() {} } },
    physics: { world: { setBounds() {} } }, textures: { exists: () => false }, input: { on() {} }
  });
  const state: PlayerStateSnapshot = {
    character: { playerId: "hero", nickname: "Owczy", level: 1, hp: 100, maxHp: 100, maxAp: 5,
      initiative: 10, severelyInjured: false, injuries: [] },
    inventory: { items: [{ instanceId: "rag", itemId: "rag-bag", itemDefinitionId: "rag-def",
      name: "Szmaciany worek", category: "container", description: "Worek", quantity: 1,
      rarity: "COMMON", upgradeLevel: 0, containerCapacity: 8 }], containerSlots: ["rag", null, null, null] }
  };
  scene.init({ playerId: "hero" }); scene.create(); transport.emit("playerState", state);
  document.querySelector<HTMLButtonElement>('[data-container-slot="0"]')!.click();
  const contents = document.querySelector<HTMLElement>('[data-container-contents]');
  expect(contents?.classList.contains("is-hidden")).toBe(false);
  expect(contents?.textContent).toContain("Szmaciany worek");
  expect(contents?.querySelectorAll("[data-storage-cell]")).toHaveLength(8);
  document.querySelector<HTMLButtonElement>('[data-container-slot="1"]')!.click();
  expect(contents?.classList.contains("is-hidden")).toBe(true);
  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(false);
  document.querySelector<HTMLButtonElement>('[data-container-slot="0"]')!.click();
  expect(contents?.classList.contains("is-hidden")).toBe(false);
  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(true);
  contents?.querySelector<HTMLButtonElement>("[data-change-container]")!.click();
  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(false);
  events.emit("shutdown");
  expect(document.querySelector("[data-container-contents]")).toBeNull();
});
