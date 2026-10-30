import { expect,it } from "vitest";
import { allocateWeaponExperience,emptyCharacterEquipment,getCharacterStatistics,getEquipmentCombatStatistics,normalizeWeaponTraining,type CharacterEquipment,type InventoryItem,type ItemStatModifier,type WeaponFamily } from "../src/index";

function gear(family:WeaponFamily,modifiers:ItemStatModifier[]=[]):CharacterEquipment {
  const equipment=emptyCharacterEquipment(),slot=family==="shield"?"offHand":"mainHand";
  equipment[slot]={instanceId:family,itemId:family,itemDefinitionId:family,name:family,quantity:1,category:family==="shield"?"armor":"weapon",description:"",rarity:"COMMON",upgradeLevel:0,equipment:{slot,weaponFamily:family,twoHanded:["bow","crossbow","staff"].includes(family),minimumLevel:1,modifiers}};
  return equipment;
}
it("ignores free legacy styles and exposes only unarmed melee without actual gear",()=>{
  const training=normalizeWeaponTraining({loadout:{melee:"axe",ranged:"bow",support:"staff",defense:"shield"},experience:{axe:25250,bow:25250,staff:25250,shield:25250}});
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),training)).toMatchObject({meleeDamage:20,rangedDamage:0,meleeEnabled:true,rangedEnabled:false});
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),training)).not.toHaveProperty("healingPower");
});
it("derives one equipped weapon bonus and armor from real item modifiers",()=>{
  const equipment=gear("axe",[{statCode:"MIN_DAMAGE",modifierType:"flat",value:4},{statCode:"MAX_DAMAGE",modifierType:"flat",value:8}]);
  equipment.chest={...equipment.mainHand!,instanceId:"chest",category:"armor",equipment:{slot:"chest",twoHanded:false,minimumLevel:1,modifiers:[{statCode:"ARMOR",modifierType:"flat",value:12}]}};
  const stats=getEquipmentCombatStatistics(getCharacterStatistics(1),{experience:{axe:25250}},equipment);
  expect(stats).toMatchObject({meleeDamage:33,rangedDamage:0,armor:12,meleeEnabled:true,rangedEnabled:false});
  const ranged=getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,gear("bow",[{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:5}]));
  expect(ranged).toMatchObject({meleeDamage:0,rangedDamage:20,meleeEnabled:false,rangedEnabled:true});
});
it("enables staff healing and shield mitigation only when their actual slots allow them",()=>{
  const shield=gear("shield",[{statCode:"BLOCK_POWER",modifierType:"flat",value:10}]).offHand;
  const sword=gear("sword");sword.offHand=shield;
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),{experience:{shield:25250}},sword).blockPercent).toBe(35);
  const staff=gear("staff",[{statCode:"SPELL_POWER",modifierType:"flat",value:8}]);staff.offHand=shield;
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),{experience:{staff:25250}},staff)).toMatchObject({healingPower:35,meleeEnabled:true,rangedEnabled:false});
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,staff)).not.toHaveProperty("blockPercent");
  staff.mainHand!.durability=0;expect(getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,staff)).not.toHaveProperty("healingPower");
});
it("applies finite attribute and flat/percent/multiplier modifiers without mutating inputs",()=>{
  const equipment=gear("sword",[{statCode:"STRENGTH",modifierType:"flat",value:3},{statCode:"VITALITY",modifierType:"flat",value:2},{statCode:"MAX_HP",modifierType:"percent",value:10},{statCode:"ARMOR",modifierType:"flat",value:10},{statCode:"ARMOR",modifierType:"multiplier",value:2},{statCode:"ARMOR",modifierType:"flat",value:Infinity}]);
  const original=structuredClone(equipment),base=getCharacterStatistics(1);
  expect(getEquipmentCombatStatistics(base,undefined,equipment)).toMatchObject({strength:13,vitality:12,meleeDamage:23,maxHp:132,armor:20});
  expect(equipment).toEqual(original);expect(base.maxHp).toBe(100);
});
it("allocates exactly half final XP only among distinct used families with stable remainder",()=>{
  expect(allocateWeaponExperience(45,["shield","axe","axe"])).toEqual({axe:11,shield:11});
  expect(allocateWeaponExperience(42,["shield","axe"])).toEqual({axe:11,shield:10});
  expect(allocateWeaponExperience(100,[])).toEqual({});expect(allocateWeaponExperience(0,["sword"])).toEqual({});
});
