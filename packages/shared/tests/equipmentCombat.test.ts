import { expect,it } from "vitest";
import { allocateWeaponExperience,emptyCharacterEquipment,getCharacterStatistics,getEquipmentCombatStatistics,normalizeWeaponTraining,learnWeaponSkill,type CharacterEquipment,type InventoryItem,type ItemStatModifier,type WeaponFamily } from "../src/index";

function gear(family:WeaponFamily,modifiers:ItemStatModifier[]=[{statCode:family==="staff"?"SPELL_POWER":family==="shield"?"BLOCK_POWER":"PHYSICAL_DAMAGE",modifierType:"flat",value:family==="shield"?0:20}]):CharacterEquipment {
  const equipment=emptyCharacterEquipment(),slot=family==="shield"?"offHand":"mainHand";
  equipment[slot]={instanceId:family,itemId:family,itemDefinitionId:family,name:family,quantity:1,category:family==="shield"?"armor":"weapon",description:"",rarity:"COMMON",upgradeLevel:0,equipment:{slot,weaponFamily:family,twoHanded:["bow","crossbow","staff"].includes(family),minimumLevel:1,modifiers}};
  return equipment;
}
it("ignores free legacy styles and exposes only unarmed melee without actual gear",()=>{
  const training=normalizeWeaponTraining({loadout:{melee:"axe",ranged:"bow",support:"staff",defense:"shield"},experience:{axe:25250,bow:25250,staff:25250,shield:25250}});
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),training)).toMatchObject({meleeDamage:5,rangedDamage:0,meleeEnabled:true,rangedEnabled:false});
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),training)).not.toHaveProperty("healingPower");
});
it("derives one equipped weapon bonus and armor from real item modifiers",()=>{
  const equipment=gear("axe",[{statCode:"MIN_DAMAGE",modifierType:"flat",value:4},{statCode:"MAX_DAMAGE",modifierType:"flat",value:8}]);
  equipment.chest={...equipment.mainHand!,instanceId:"chest",category:"armor",equipment:{slot:"chest",twoHanded:false,minimumLevel:1,modifiers:[{statCode:"ARMOR",modifierType:"flat",value:12}]}};
  const stats=getEquipmentCombatStatistics(getCharacterStatistics(1),{experience:{axe:25250}},equipment);
  expect(stats).toMatchObject({meleeDamage:8,rangedDamage:0,armor:12,meleeEnabled:true,rangedEnabled:false});
  const ranged=getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,gear("bow",[{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:5}]));
  expect(ranged).toMatchObject({meleeDamage:0,rangedDamage:5,meleeEnabled:false,rangedEnabled:true});
});
it("enables staff healing and shield mitigation only when their actual slots allow them",()=>{
  const shield=gear("shield",[{statCode:"BLOCK_POWER",modifierType:"flat",value:10}]).offHand;
  const sword=gear("sword");sword.offHand=shield;
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),{experience:{shield:25250}},sword).blockPercent).toBe(25);
  const staff=gear("staff",[{statCode:"SPELL_POWER",modifierType:"flat",value:8}]);staff.offHand=shield;
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),{experience:{staff:25250}},staff)).toMatchObject({healingPower:10,meleeEnabled:true,rangedEnabled:false});
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,staff)).not.toHaveProperty("blockPercent");
  staff.mainHand!.durability=0;expect(getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,staff)).not.toHaveProperty("healingPower");
});
it("applies finite attribute and flat/percent/multiplier modifiers without mutating inputs",()=>{
  const equipment=gear("sword",[{statCode:"STRENGTH",modifierType:"flat",value:3},{statCode:"VITALITY",modifierType:"flat",value:2},{statCode:"MAX_HP",modifierType:"percent",value:10},{statCode:"ARMOR",modifierType:"flat",value:10},{statCode:"ARMOR",modifierType:"multiplier",value:2},{statCode:"ARMOR",modifierType:"flat",value:Infinity}]);
  const original=structuredClone(equipment),base=getCharacterStatistics(1);
  expect(getEquipmentCombatStatistics(base,undefined,equipment)).toMatchObject({strength:3,vitality:2,meleeDamage:3,maxHp:132,armor:20});
  expect(equipment).toEqual(original);expect(base.maxHp).toBe(100);
});
it("allocates exactly half final XP only among distinct used families with stable remainder",()=>{
  expect(allocateWeaponExperience(45,["shield","axe","axe"])).toEqual({axe:11,shield:11});
  expect(allocateWeaponExperience(42,["shield","axe"])).toEqual({axe:11,shield:10});
  expect(allocateWeaponExperience(42,["shield","wand","shield"])).toEqual({wand:11,shield:10});
  expect(allocateWeaponExperience(100,[])).toEqual({});expect(allocateWeaponExperience(0,["sword"])).toEqual({});
});
it("applies learned passives only to their equipped weapon or shield and never compounds them",()=>{
  let training=normalizeWeaponTraining({experience:{sword:25250,staff:25250,wand:25250,shield:25250}});
  for(const family of ["sword","staff","wand","shield"] as const){training=learnWeaponSkill(training,`${family}:technique`);training=learnWeaponSkill(training,`${family}:mastery`);}
  const base=getCharacterStatistics(1), sword=gear("sword");sword.offHand=gear("shield").offHand;
  const swordStats=getEquipmentCombatStatistics(base,training,sword);
  expect(swordStats).toMatchObject({meleeDamage:28,blockPercent:20});
  expect(getEquipmentCombatStatistics(base,training,sword)).toEqual(swordStats);
  expect(getEquipmentCombatStatistics(base,training,gear("staff")).healingPower).toBe(28);
  expect(getEquipmentCombatStatistics(base,training,gear("axe")).meleeDamage).toBe(20);
  const wand=gear("wand",[{statCode:"MAGIC_DAMAGE",modifierType:"flat",value:12}]);wand.offHand=offensiveShield();
  expect(getEquipmentCombatStatistics(base,training,wand)).toMatchObject({meleeDamage:0,rangedDamage:22,blockPercent:20});
  sword.mainHand!.durability=0;
  expect(getEquipmentCombatStatistics(base,training,sword).meleeDamage).toBe(5);
});

const offensiveShield=()=>gear("shield",[
  {statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:4},
  {statCode:"MAGIC_DAMAGE",modifierType:"flat",value:4},
  {statCode:"BLOCK_POWER",modifierType:"flat",value:0}
]).offHand;

it("adds only the matching shield damage once before main-hand mastery",()=>{
  const equipment=gear("sword",[{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:12}]);equipment.offHand=offensiveShield();
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),{experience:{sword:25250,shield:25250}},equipment)).toMatchObject({meleeDamage:20,blockPercent:15});
});

it("uses a one-handed wand for ranged magic plus spell power, without melee or healing",()=>{
  const equipment=gear("wand",[
    {statCode:"MAGIC_DAMAGE",modifierType:"flat",value:12},
    {statCode:"SPELL_POWER",modifierType:"flat",value:5},
    {statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:999}
  ]);equipment.offHand=offensiveShield();
  const stats=getEquipmentCombatStatistics(getCharacterStatistics(1),{experience:{wand:25250}},equipment);
  expect(stats).toMatchObject({meleeDamage:0,rangedDamage:26,meleeEnabled:false,rangedEnabled:true,blockPercent:0});
  expect(stats).not.toHaveProperty("healingPower");
});

it("excludes shield offense for bare hands, two-handed weapons and staff healing",()=>{
  const bare=gear("shield");bare.offHand=offensiveShield();
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,bare).meleeDamage).toBe(5);
  const sword=gear("sword",[{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:25}]);sword.mainHand!.equipment!.twoHanded=true;sword.offHand=offensiveShield();
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,sword).meleeDamage).toBe(25);
  const staff=gear("staff",[{statCode:"SPELL_POWER",modifierType:"flat",value:12}]);staff.offHand=offensiveShield();
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,staff).healingPower).toBe(12);
  const wand=gear("wand",[{statCode:"MAGIC_DAMAGE",modifierType:"flat",value:12}]);wand.offHand=offensiveShield();wand.offHand!.durability=0;
  expect(getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,wand).rangedDamage).toBe(12);
});
