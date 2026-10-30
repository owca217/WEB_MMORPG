/* @vitest-environment jsdom */
import { emptyCharacterEquipment, type CharacterSnapshot, type InventoryItem } from "@web-mmorpg/shared";
import { afterEach, expect, it, vi } from "vitest";
import { CharacterPanel } from "../src/ui/CharacterPanel";
const hero:CharacterSnapshot={playerId:"hero",nickname:"Alicja",level:2,hp:100,maxHp:130,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
const sword:InventoryItem={instanceId:"sword",itemId:"sword",itemDefinitionId:"sword-def",name:"Miecz treningowy",category:"weapon",description:"",quantity:1,rarity:"COMMON",upgradeLevel:0,equipment:{slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:1,modifiers:[{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:5}]}};
function click(selector:string){document.querySelector<HTMLButtonElement>(selector)!.click();}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
afterEach(()=>document.body.replaceChildren());
it("has three accessible tabs, preserves selection and removes free style choices",()=>{
 const panel=new CharacterPanel();panel.update(hero,{items:[sword]});panel.show();
 expect([...document.querySelectorAll('[role="tab"]')].map(e=>e.textContent)).toEqual(["Statystyki","Władanie","Uzbrojenie"]);
 click('[data-character-tab="equipment"]');panel.update({...hero,hp:80},{items:[sword]});
 expect(document.querySelector('[data-character-tab="equipment"]')?.getAttribute("aria-selected")).toBe("true");
 expect(document.querySelector('[data-weapon-melee]')).toBeNull();
 expect(document.querySelector('[data-equipment-equip="sword"]')?.textContent).toContain("Załóż");panel.destroy();
});
it("keeps game pointer events inside the panel",()=>{
 const panel=new CharacterPanel();panel.update(hero);panel.show();const listener=vi.fn();document.addEventListener("pointerdown",listener);
 try{document.querySelector('[data-character-tab="proficiency"]')!.dispatchEvent(new Event("pointerdown",{bubbles:true}));expect(listener).not.toHaveBeenCalled();}finally{document.removeEventListener("pointerdown",listener);panel.destroy();}
});
it("shows proficiency levels with combat-only half-XP rules",()=>{
 const panel=new CharacterPanel();panel.update({...hero,weaponTraining:{experience:{sword:5,axe:0,hammer:0,dagger:0,spear:0,bow:25250,crossbow:0,staff:0,shield:0},loadout:{melee:"sword",ranged:"bow"}}});panel.show();click('[data-character-tab="proficiency"]');
 expect(document.querySelectorAll('[data-weapon-family]')).toHaveLength(9);expect(document.querySelector('[data-weapon-family="sword"] [data-weapon-level]')?.textContent).toBe("1/100");
 expect(document.querySelector('[data-weapon-family="bow"] [role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
 expect(document.querySelector('[data-character-panel="proficiency"]')?.textContent).toContain("połowę");panel.destroy();
});
it("equips once after acknowledgement and displays authoritative equipment/statistics",async()=>{
 const gate=deferred<any>(),request=vi.fn().mockReturnValue(gate.promise),changed=vi.fn();
 const panel=new CharacterPanel({onSetEquipmentSlot:request,onChanged:changed});panel.update(hero,{items:[sword]});panel.show();click('[data-character-tab="equipment"]');click('[data-equipment-equip="sword"]');click('[data-equipment-equip="sword"]');
 expect(request).toHaveBeenCalledExactlyOnceWith({slot:"mainHand",itemInstanceId:"sword"});expect(document.querySelector<HTMLButtonElement>('[data-equipment-equip="sword"]')!.disabled).toBe(true);
 const equipped={...sword,equippedSlot:"mainHand" as const},equipment={...emptyCharacterEquipment(),mainHand:equipped};
 const result={ok:true,character:{...hero,equipment,statistics:{strength:12,dexterity:11,vitality:13,maxHp:130,maxAp:5,initiative:10,meleeDamage:44,rangedDamage:0,armor:3}},inventory:{items:[equipped]}};
 gate.resolve(result);await vi.waitFor(()=>expect(changed).toHaveBeenCalledWith(result));
 expect(document.querySelector('[data-equipment-slot="mainHand"]')?.textContent).toContain("Miecz treningowy");click('[data-character-tab="statistics"]');expect(document.querySelector('[data-stat="meleeDamage"]')?.textContent).toBe("44");panel.destroy();
});
it("shows rejected equipment requests and ignores old acknowledgements after hiding or changing character",async()=>{
 const late=deferred<any>(),changed=vi.fn(),request=vi.fn().mockResolvedValueOnce({ok:false,code:"IN_BATTLE",message:"Nie można zmienić uzbrojenia podczas walki."}).mockReturnValueOnce(late.promise);
 const panel=new CharacterPanel({onSetEquipmentSlot:request,onChanged:changed});panel.update(hero,{items:[sword]});panel.show();click('[data-character-tab="equipment"]');click('[data-equipment-equip="sword"]');
 await vi.waitFor(()=>expect(document.querySelector('[data-equipment-status]')?.textContent).toContain("podczas walki"));click('[data-equipment-equip="sword"]');panel.hide();panel.update({...hero,playerId:"next"},{items:[]});panel.show();
 late.resolve({ok:true,character:hero,inventory:{items:[sword]}});await Promise.resolve();await Promise.resolve();expect(changed).not.toHaveBeenCalled();panel.destroy();
});
it("explains two-handed shield conflicts, level and broken item requirements",()=>{
 const bow={...sword,instanceId:"bow",name:"Łuk",equipment:{...sword.equipment!,weaponFamily:"bow" as const,twoHanded:true}};
 const shield={...sword,instanceId:"shield",name:"Tarcza",category:"armor",equipment:{...sword.equipment!,slot:"offHand" as const,weaponFamily:"shield" as const}};
 const broken={...sword,instanceId:"broken",durability:0},advanced={...sword,instanceId:"advanced",equipment:{...sword.equipment!,minimumLevel:5}};
 const panel=new CharacterPanel({onSetEquipmentSlot:vi.fn(),onChanged:vi.fn()});panel.update({...hero,equipment:{...emptyCharacterEquipment(),mainHand:bow}},{items:[bow,shield,broken,advanced]});panel.show();click('[data-character-tab="equipment"]');
 expect(document.querySelector<HTMLButtonElement>('[data-equipment-equip="shield"]')!.disabled).toBe(true);expect(document.querySelector('[data-equipment-item="shield"]')?.textContent).toContain("dwuręczną");
 expect(document.querySelector<HTMLButtonElement>('[data-equipment-equip="broken"]')!.disabled).toBe(true);expect(document.querySelector<HTMLButtonElement>('[data-equipment-equip="advanced"]')!.disabled).toBe(true);panel.destroy();
});
