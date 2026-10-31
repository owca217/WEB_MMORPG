/* @vitest-environment jsdom */
import { emptyCharacterEquipment, EQUIPMENT_SLOTS, EQUIPMENT_SLOT_LABELS, type CharacterSnapshot, type InventoryItem } from "@web-mmorpg/shared";
import { afterEach, expect, it, vi } from "vitest";
import { HudEquipmentSlots } from "../src/ui/HudEquipmentSlots";

const hero:CharacterSnapshot={playerId:"hero",nickname:"Alicja",level:2,hp:100,maxHp:130,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
const sword:InventoryItem={instanceId:"current-sword",itemId:"training-sword",itemDefinitionId:"sword-def",name:"Miecz treningowy",quantity:1,category:"weapon",description:"",rarity:"COMMON",quality:"GOOD",upgradeLevel:0,iconUrl:"/sword.png",equippedSlot:"mainHand",equipment:{slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:1,modifiers:[]}};
const slots:HudEquipmentSlots[]=[];
function create(onSelect=vi.fn()){const result=new HudEquipmentSlots({onSelect});slots.push(result);document.body.append(result.element);return result;}
function button(slot:string){return document.querySelector<HTMLButtonElement>(`[data-hud-equipment-slot="${slot}"]`)!;}
afterEach(()=>{slots.splice(0).forEach(slot=>slot.destroy());document.body.replaceChildren();});

it("exposes eight labelled category placeholders and real drop targets without character-sheet selectors",()=>{
  const component=create();component.update(hero,{items:[]});
  expect([...component.element.querySelectorAll<HTMLElement>('[data-hud-equipment-slot]')].map(node=>node.dataset.hudEquipmentSlot)).toEqual([...EQUIPMENT_SLOTS]);
  const icons:string[]=[];
  for(const slot of EQUIPMENT_SLOTS){const control=button(slot);expect(control.dataset.equipmentDropTarget).toBe(slot);expect(control.getAttribute("aria-label")).toContain(EQUIPMENT_SLOT_LABELS[slot]);expect(control.title).toContain("Puste");icons.push(control.querySelector("svg")!.innerHTML);}
  expect(new Set(icons).size).toBe(8);expect(component.element.querySelector('[data-equipment-slot]')).toBeNull();
});
it("uses authoritative equipped identity and quality while retaining focused buttons across updates",()=>{
  const onSelect=vi.fn(),component=create(onSelect),equipment={...emptyCharacterEquipment(),mainHand:sword};
  component.update({...hero,equipment},{items:[{...sword,instanceId:"inventory-copy"}]});const main=button("mainHand");main.focus();
  expect(main.dataset.hudEquipmentItem).toBe("current-sword");expect(main.getAttribute("aria-label")).toContain(sword.name);expect(main.querySelector<HTMLImageElement>("img")?.getAttribute("src")).toBe("/sword.png");expect(main.querySelector('[data-item-quality="GOOD"]')).not.toBeNull();main.click();expect(onSelect).toHaveBeenLastCalledWith("mainHand",sword);
  component.update({...hero,equipment:emptyCharacterEquipment()},{items:[]});
  expect(button("mainHand")).toBe(main);expect(document.activeElement).toBe(main);expect(main.hasAttribute("data-hud-equipment-item")).toBe(false);expect(main.querySelector('[data-item-quality]')).toBeNull();main.click();expect(onSelect).toHaveBeenLastCalledWith("mainHand",null);
});
it("resolves legacy equipped inventory and keeps a two-handed offhand visibly empty and labelled blocked",()=>{
  const onSelect=vi.fn(),component=create(onSelect);component.update(hero,{items:[sword]});expect(button("mainHand").dataset.hudEquipmentItem).toBe(sword.instanceId);
  const staff={...sword,instanceId:"staff",name:"Kostur ucznia",equipment:{...sword.equipment!,weaponFamily:"staff" as const,twoHanded:true}};
  component.update({...hero,equipment:{...emptyCharacterEquipment(),mainHand:staff}},{items:[staff]});
  const offhand=button("offHand");expect(offhand.title).toContain("dwuręczną");expect(offhand.getAttribute("aria-label")).toContain("Tarcza");expect(offhand.querySelector("img")).toBeNull();expect(offhand.querySelector("svg")).not.toBeNull();expect(offhand.dataset.equipmentDropTarget).toBe("offHand");offhand.click();expect(onSelect).toHaveBeenLastCalledWith("offHand",null);
});
it("stops callbacks and updates after destruction",()=>{
  const onSelect=vi.fn(),component=create(onSelect),main=button("mainHand");component.destroy();component.update(hero,{items:[sword]});main.click();expect(onSelect).not.toHaveBeenCalled();expect(component.element.isConnected).toBe(false);
});
