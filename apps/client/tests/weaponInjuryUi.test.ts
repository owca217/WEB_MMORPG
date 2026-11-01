/* @vitest-environment jsdom */
import { emptyCharacterEquipment, type CharacterSnapshot, type InventoryItem, type WeaponInjuryUpgradeResult, type WeaponInjuryUpgradeRequest } from "@web-mmorpg/shared";
import { afterEach, expect, it, vi } from "vitest";
import { ContainerContentsPanel } from "../src/ui/ContainerContentsPanel";
import { HudEquipmentSlots } from "../src/ui/HudEquipmentSlots";
import { BattleHud } from "../src/ui/BattleHud";

const hero:CharacterSnapshot={playerId:"hero",nickname:"Alicja",level:2,hp:100,maxHp:130,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
const item=(instanceId:string,changes:Partial<InventoryItem>={}):InventoryItem=>({instanceId,itemId:instanceId,itemDefinitionId:instanceId,name:instanceId,quantity:1,category:"material",description:"",rarity:"COMMON",upgradeLevel:0,...changes});
const pack=item("pack",{category:"container",containerCapacity:16,permanentContainer:true});
const stone=item("stone",{itemId:"injury-stone",category:"upgrade-item",containerInstanceId:"pack"});
const sword=item("sword",{category:"weapon",quality:"EXCELLENT",containerInstanceId:"other-bag",equipment:{slot:"mainHand",weaponFamily:"sword",minimumLevel:1,twoHanded:false,modifiers:[]}});
const upgrade={kind:"handInjury" as const,chancePercent:8,duration:3 as const};
const inventory=(items:InventoryItem[])=>({items,containerSlots:["pack",null,null,null] as [string,null,null,null]});
const cleanups:Array<()=>void>=[];
const button=(selector:string)=>document.querySelector<HTMLButtonElement>(selector)!;
function panel(apply:(request:WeaponInjuryUpgradeRequest)=>Promise<WeaponInjuryUpgradeResult>,items=[pack,stone,sword],onInventoryChanged=vi.fn(),onRefresh=vi.fn()) {
 const value=new ContainerContentsPanel({onMoveItem:vi.fn(),onInventoryChanged,onChangeContainer:vi.fn(),onApplyWeaponInjury:apply,onRefresh});
 cleanups.push(()=>value.destroy());value.update(inventory(items),hero);value.show(0);button('[data-container-item="stone"]').click();return value;
}
afterEach(()=>{cleanups.splice(0).forEach(run=>run());document.body.replaceChildren();vi.restoreAllMocks();});

it("offers owned eligible weapons across bags and equipped slots, explicitly describes replacement",()=>{
 const equipped={...sword,instanceId:"equipped",name:"Equipped",equippedSlot:"mainHand" as const,injuryUpgrade:upgrade};delete equipped.containerInstanceId;
 panel(vi.fn(),[pack,stone,sword,equipped,{...sword,instanceId:"low",quality:"GOOD"},{...sword,instanceId:"armor",category:"armor"}]);
 const choices=[...document.querySelectorAll<HTMLOptionElement>('[data-injury-weapon] option')];
 expect(choices.map(option=>option.value)).toEqual(["sword","equipped"]);
 const select=document.querySelector<HTMLSelectElement>('[data-injury-weapon]')!;select.value="equipped";select.dispatchEvent(new Event("change"));
 expect(button('[data-apply-injury]').textContent).toContain("Zastąp");
 expect(document.querySelector('[data-injury-replacement]')?.textContent).toContain("Uszkodzona dłoń");
 expect(document.querySelector('[data-injury-replacement]')?.textContent).toContain("8%");
});

it("locks an in-flight roll and retries uncertain results with the same ID after reopening details",async()=>{
 let finish!:(result:WeaponInjuryUpgradeResult)=>void;
 const apply=vi.fn((_request:WeaponInjuryUpgradeRequest)=>new Promise<WeaponInjuryUpgradeResult>(resolve=>{finish=resolve;}));
 const value=panel(apply);button('[data-apply-injury]').click();
 expect(value.isBusy).toBe(true);expect(button('[data-apply-injury]').disabled).toBe(true);
 const first=apply.mock.calls[0]![0];expect(first).toMatchObject({weaponInstanceId:"sword",stoneInstanceId:"stone"});expect(first.requestId).toBeTruthy();
 finish({ok:false,code:"WEAPON_INJURY_REQUEST_UNCERTAIN",message:"Brak potwierdzenia"});
 await vi.waitFor(()=>expect(value.isBusy).toBe(false));value.hide();value.show(0);button('[data-container-item="stone"]').click();
 button('[data-injury-retry-details]').click();expect(apply.mock.calls[1]![0]).toEqual(first);
 finish({ok:true,inventory:inventory([pack,{...sword,injuryUpgrade:upgrade}]),character:hero,upgrade});
 await vi.waitFor(()=>expect(value.isBusy).toBe(false));expect(document.querySelector('[data-container-item="stone"]')).toBeNull();
 expect(document.querySelector('[data-container-contents-feedback]')?.textContent).toContain("Uszkodzona dłoń");
});

it("preserves uncertain receipt recovery if a player-state push has removed the consumed stone",async()=>{
 const apply=vi.fn().mockResolvedValue({ok:false,code:"WEAPON_INJURY_REQUEST_UNCERTAIN",message:"Brak potwierdzenia"});
 const value=panel(apply);button('[data-apply-injury]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 const request=apply.mock.calls[0]![0];value.update(inventory([pack,{...sword,injuryUpgrade:upgrade}]),hero);
 expect(document.querySelector('[data-container-item="stone"]')).toBeNull();button('[data-injury-retry]').click();
 expect(apply.mock.calls[1]![0]).toEqual(request);
});

it.each(["EQUIPMENT_ACTION_PENDING","AUTHENTICATION_REQUIRED","BATTLE_IN_PROGRESS","TRADE_IN_PROGRESS","WEAPON_INJURY_FAILED"])("keeps the original receipt across uncertain recovery and %s",async(code)=>{
 const charged=new Set<string>(),requests:WeaponInjuryUpgradeRequest[]=[];let committed=false;
 const result={ok:true as const,inventory:inventory([pack,{...stone,quantity:1},{...sword,injuryUpgrade:upgrade}]),character:hero,upgrade};
 const apply=vi.fn(async(request:WeaponInjuryUpgradeRequest):Promise<WeaponInjuryUpgradeResult>=>{
  requests.push(request);
  if(requests.length===1){charged.add(request.requestId);return {ok:false,code:"WEAPON_INJURY_REQUEST_UNCERTAIN",message:"Brak potwierdzenia"};}
  if(!committed)return {ok:false,code,message:"Ponów po zakończeniu poprzedniej czynności"};
  charged.add(request.requestId);return result;
 });
 const value=panel(apply,[pack,{...stone,quantity:2},sword]);button('[data-apply-injury]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 button('[data-injury-retry-details]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 expect(document.querySelector('[data-apply-injury]')).toBeNull();expect(button('[data-injury-retry-details]')).toBeTruthy();
 committed=true;button('[data-injury-retry-details]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 expect(requests).toHaveLength(3);expect(requests).toEqual([requests[0],requests[0],requests[0]]);expect(charged.size).toBe(1);
});

it("retains a hidden original request after a busy retry and ignores its superseded payload",async()=>{
 let finish!:(result:WeaponInjuryUpgradeResult)=>void;const changed=vi.fn();const requests:WeaponInjuryUpgradeRequest[]=[];
 const result={ok:true as const,inventory:inventory([pack,{...stone,quantity:1},{...sword,injuryUpgrade:upgrade}]),character:hero,upgrade};
 const apply=vi.fn((request:WeaponInjuryUpgradeRequest):Promise<WeaponInjuryUpgradeResult>=>{
  requests.push(request);
  if(requests.length===1)return new Promise(resolve=>{finish=resolve;});
  if(requests.length===2)return Promise.resolve({ok:false,code:"EQUIPMENT_ACTION_PENDING",message:"Poczekaj"});
  return Promise.resolve(result);
 });
 const value=panel(apply,[pack,{...stone,quantity:2},sword],changed);button('[data-apply-injury]').click();value.hide();value.show(0);button('[data-container-item="stone"]').click();
 button('[data-injury-retry-details]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 expect(button('[data-injury-retry-details]')).toBeTruthy();expect(document.querySelector('[data-apply-injury]')).toBeNull();
 finish(result);await Promise.resolve();await Promise.resolve();expect(changed).not.toHaveBeenCalled();
 button('[data-injury-retry-details]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 expect(requests).toEqual([requests[0],requests[0],requests[0]]);expect(changed).toHaveBeenCalledOnce();
});

it.each(["WEAPON_INJURY_INELIGIBLE","WEAPON_INJURY_INVALID_STONE","INVENTORY_ITEM_NOT_OWNED"])("releases a recovery receipt after definitive transaction rejection %s",async(code)=>{
 const requests:WeaponInjuryUpgradeRequest[]=[];
 const apply=vi.fn(async(request:WeaponInjuryUpgradeRequest):Promise<WeaponInjuryUpgradeResult>=>{requests.push(request);return requests.length===1?{ok:false,code:"WEAPON_INJURY_REQUEST_UNCERTAIN",message:"Brak potwierdzenia"}:{ok:false,code,message:"Odrzucono w transakcji"};});
 const value=panel(apply);button('[data-apply-injury]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 button('[data-injury-retry-details]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 expect(button('[data-apply-injury]')).toBeTruthy();expect(document.querySelector('[data-injury-retry-details]')).toBeNull();
 button('[data-apply-injury]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));expect(requests[2]!.requestId).not.toBe(requests[0]!.requestId);
});

it("allows a fresh target after a definite original transaction rejection",async()=>{
 const apply=vi.fn().mockResolvedValue({ok:false,code:"WEAPON_INJURY_INELIGIBLE",message:"Odrzucono"});
 const value=panel(apply);button('[data-apply-injury]').click();await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 expect(button('[data-apply-injury]')).toBeTruthy();expect(document.querySelector('[data-injury-retry-details]')).toBeNull();
});

it("ignores old player and newer inventory ACKs without replacing authoritative data",async()=>{
 let finish!:(result:WeaponInjuryUpgradeResult)=>void;const changed=vi.fn(),refresh=vi.fn();
 const apply=vi.fn(()=>new Promise<WeaponInjuryUpgradeResult>(resolve=>{finish=resolve;}));const value=panel(apply,[pack,stone,sword],changed,refresh);
 button('[data-apply-injury]').click();value.update(inventory([pack,stone,sword,item("new",{containerInstanceId:"pack"})]),hero);
 finish({ok:true,inventory:inventory([pack]),character:hero,upgrade});await vi.waitFor(()=>expect(value.isBusy).toBe(false));
 expect(refresh).toHaveBeenCalledOnce();expect(changed).not.toHaveBeenCalled();expect(button('[data-container-item="new"]')).toBeTruthy();
 button('[data-container-item="stone"]').click();button('[data-apply-injury]').click();
 value.update(inventory([pack]),{...hero,playerId:"other"});finish({ok:true,inventory:inventory([pack,stone]),character:hero,upgrade});
 await Promise.resolve();await Promise.resolve();expect(changed).not.toHaveBeenCalled();expect(document.querySelector('[data-container-item="stone"]')).toBeNull();
});

it("shows equipped rolls and full-own-turn injury timers for both sides",()=>{
 const slots=new HudEquipmentSlots();cleanups.push(()=>slots.destroy());document.body.append(slots.element);
 slots.update({...hero,equipment:{...emptyCharacterEquipment(),mainHand:{...sword,injuryUpgrade:upgrade}}},inventory([pack]));
 expect(button('[data-hud-equipment-slot="mainHand"]').title).toContain("Uszkodzona dłoń");expect(button('[data-hud-equipment-slot="mainHand"]').title).toContain("8%");
 const hud=new BattleHud({onEndTurn:vi.fn(),onUseItem:vi.fn(),onInventoryChanged:vi.fn()});cleanups.push(()=>hud.destroy());
 const own={id:"own",ownerPlayerId:"hero",name:"Alicja",hp:100,maxHp:130,ap:5,maxAp:5,initiative:10,position:{q:0,r:0},injuries:[],severelyInjured:false,temporaryInjuries:[{kind:"handInjury" as const,remainingTurns:3}]};
 const {ownerPlayerId: _owner,...unit}=own;
 const enemy={...unit,id:"enemy",name:"Wilk",temporaryInjuries:[{kind:"eyeInjury" as const,remainingTurns:null}]};
 hud.update(own,true,{items:[]});hud.setBattleContext({id:"battle",round:1,activeCombatantId:"own",turnOrder:["own","enemy"],combatants:[own,enemy],cells:[],blockedCells:[],coverCells:[],finished:false});
 expect(document.querySelector('[data-injuries]')?.textContent).toContain("Uszkodzona dłoń");expect(document.querySelector('[data-injuries]')?.textContent).toContain("3");
 expect(document.querySelector('[data-combatant-injuries="enemy"]')?.textContent).toContain("Uszkodzone oko");expect(document.querySelector('[data-combatant-injuries="enemy"]')?.textContent).toContain("do końca walki");
});
