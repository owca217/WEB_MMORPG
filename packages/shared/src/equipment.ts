import type { CharacterSnapshot } from "./character";
import type { InventoryItem, InventorySnapshot } from "./inventory";
import type { ItemStatModifier } from "./items";
import { WEAPON_FAMILIES, type WeaponFamily } from "./weapons";

export const EQUIPMENT_SLOTS = ["mainHand","offHand","helmet","chest","gloves","pants","boots","cloak"] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];
export const EQUIPMENT_SLOT_LABELS: Record<EquipmentSlot,string> = {
  mainHand:"Broń",offHand:"Tarcza",helmet:"Hełm",chest:"Napierśnik",gloves:"Rękawice",pants:"Spodnie",boots:"Buty",cloak:"Płaszcz"
};
export type EquipmentSlots = Record<EquipmentSlot,string|null>;
export type CharacterEquipment = Record<EquipmentSlot,InventoryItem|null>;
export interface EquipmentItemProperties {
  slot: EquipmentSlot;
  weaponFamily?: WeaponFamily;
  twoHanded: boolean;
  minimumLevel: number;
  modifiers: ItemStatModifier[];
}
export interface EquipmentUpdateRequest {slot:EquipmentSlot;itemInstanceId:string|null}
export type EquipmentUpdateResult = {ok:true;character:CharacterSnapshot;inventory:InventorySnapshot}|{ok:false;code:string;message:string};

export function isEquipmentSlot(value:unknown):value is EquipmentSlot {
  return EQUIPMENT_SLOTS.some(slot=>slot===value);
}
export function emptyEquipmentSlots():EquipmentSlots {
  return Object.fromEntries(EQUIPMENT_SLOTS.map(slot=>[slot,null])) as EquipmentSlots;
}
export function emptyCharacterEquipment():CharacterEquipment {
  return Object.fromEntries(EQUIPMENT_SLOTS.map(slot=>[slot,null])) as CharacterEquipment;
}
export function getEquipmentItemProperties(input:{category:string;subcategory?:string;minimumLevel:number;stats:ItemStatModifier[];specialData?:Record<string,unknown>}):EquipmentItemProperties|undefined {
  const special=input.specialData??{};
  let slot:EquipmentSlot,weaponFamily:WeaponFamily|undefined,twoHanded=false;
  if(input.category==="weapon") {
    const family=special.weaponFamily??input.subcategory;
    if(!WEAPON_FAMILIES.some(item=>item.id===family && item.id!=="shield"))return undefined;
    weaponFamily=family as WeaponFamily;slot="mainHand";
    twoHanded=["bow","crossbow","staff"].includes(weaponFamily)||input.subcategory==="two-handed";
  }else if(input.category==="armor") {
    const armorSlot=special.armorSlot??input.subcategory;
    if(armorSlot==="shield"){slot="offHand";weaponFamily="shield";}
    else if(isEquipmentSlot(armorSlot) && armorSlot!=="mainHand" && armorSlot!=="offHand")slot=armorSlot;
    else return undefined;
  }else return undefined;
  return {slot,...(weaponFamily?{weaponFamily}:{}),twoHanded,minimumLevel:Math.max(1,Math.floor(input.minimumLevel)||1),modifiers:input.stats.filter(stat=>Number.isFinite(stat.value)).map(stat=>({...stat}))};
}
export function getCharacterEquipment(inventory:InventorySnapshot,level=100):CharacterEquipment {
  const result=emptyCharacterEquipment();
  for(const item of inventory.items) {
    const slot=item.equippedSlot;
    if(!slot || !item.equipment || item.equipment.slot!==slot || item.equipment.minimumLevel>level || item.quantity!==1 || (item.durability!==undefined && item.durability<=0))continue;
    result[slot]=structuredClone(item);
  }
  if(result.mainHand?.equipment?.twoHanded)result.offHand=null;
  return result;
}
