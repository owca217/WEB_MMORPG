import { emptyCharacterEquipment,type CharacterEquipment,type EquipmentSlot,type InventoryItem,type ItemStatModifier,type WeaponFamily } from "@web-mmorpg/shared";
export function combatItem(family:WeaponFamily,modifiers?:ItemStatModifier[]):InventoryItem {
  const slot=family==="shield"?"offHand":"mainHand";
  modifiers ??= family==="shield" ? [{statCode:"BLOCK_POWER",modifierType:"flat",value:10}]
    : family==="staff" ? [{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:20},{statCode:"SPELL_POWER",modifierType:"flat",value:20}]
    : [{statCode:family==="wand"?"MAGIC_DAMAGE":"PHYSICAL_DAMAGE",modifierType:"flat",value:20}];
  return {instanceId:`test-${family}`,itemId:family,itemDefinitionId:family,name:family,quantity:1,category:family==="shield"?"armor":"weapon",description:"",rarity:"COMMON",upgradeLevel:0,equipment:{slot,weaponFamily:family,twoHanded:["bow","crossbow","staff"].includes(family),minimumLevel:1,modifiers}};
}
export function combatEquipment(family?:WeaponFamily,shield=false,modifiers?:ItemStatModifier[]):CharacterEquipment {
  const equipment=emptyCharacterEquipment();
  if(family)equipment[family==="shield"?"offHand":"mainHand"]=combatItem(family,modifiers);
  if(shield)equipment.offHand=combatItem("shield");
  return equipment;
}
export function armorItem(slot:EquipmentSlot,modifiers:ItemStatModifier[]):InventoryItem {
  return {instanceId:`test-${slot}`,itemId:slot,itemDefinitionId:slot,name:slot,quantity:1,category:"armor",description:"",rarity:"COMMON",upgradeLevel:0,equipment:{slot,twoHanded:false,minimumLevel:1,modifiers}};
}
