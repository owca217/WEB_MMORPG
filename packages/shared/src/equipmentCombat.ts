import type { CharacterStatistics } from "./characterProgression";
import { EQUIPMENT_SLOTS,type CharacterEquipment,type EquipmentSlot } from "./equipment";
import type { InventoryItem } from "./inventory";
import type { ItemStatModifier } from "./items";
import { getWeaponProficiency,normalizeWeaponTraining,WEAPON_FAMILIES,type WeaponFamily } from "./weapons";
import { getLearnedWeaponSkills, getWeaponSkill } from "./weaponSkills";
import { getArmorBonuses, getEquippedArmorFamily } from "./armorSpecialization";

const MAX_STAT=1_000_000;
const bounded=(value:number,min=0,max=MAX_STAT)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):min;
function usable(item:InventoryItem|null|undefined,slot:EquipmentSlot):item is InventoryItem {
  return Boolean(item?.equipment && item.equipment.slot===slot && item.quantity===1 && (item.durability===undefined||item.durability>0));
}
function mainHand(equipment?:CharacterEquipment):InventoryItem|undefined {
  const item=equipment?.mainHand;
  return usable(item,"mainHand") && WEAPON_FAMILIES.some(f=>f.id!=="shield"&&f.id===item.equipment?.weaponFamily)?item:undefined;
}
export function getEquippedWeaponFamily(equipment?:CharacterEquipment):WeaponFamily|undefined {return mainHand(equipment)?.equipment?.weaponFamily;}
export function hasEquippedShield(equipment?:CharacterEquipment):boolean {
  return !mainHand(equipment)?.equipment?.twoHanded && usable(equipment?.offHand,"offHand") && equipment?.offHand?.equipment?.weaponFamily==="shield";
}
function apply(base:number,modifiers:readonly ItemStatModifier[],code:string):number {
  let flat=0,percent=0,multiplier=1;
  for(const modifier of modifiers) {
    if(modifier.statCode!==code||!Number.isFinite(modifier.value))continue;
    if(modifier.modifierType==="flat")flat+=bounded(modifier.value,-MAX_STAT);
    else if(modifier.modifierType==="percent")percent+=bounded(modifier.value,-100,10_000);
    else if(modifier.modifierType==="multiplier")multiplier=bounded(multiplier*bounded(modifier.value,0,100));
  }
  return bounded((bounded(base)+flat)*Math.max(0,1+percent/100)*multiplier);
}
/** Only the main weapon's attack channel can use an off-hand damage bonus. */
export function getEquippedShieldAttackBonus(equipment?:CharacterEquipment):number {
  const weapon=mainHand(equipment);
  if(!weapon || !hasEquippedShield(equipment))return 0;
  return apply(0,equipment!.offHand!.equipment!.modifiers,weapon.equipment!.weaponFamily==="wand"?"MAGIC_DAMAGE":"PHYSICAL_DAMAGE");
}
/** Gear is the only source of weapon modes; persisted free styles are ignored. */
export function getEquipmentCombatStatistics<T extends CharacterStatistics>(base:T,value:unknown,equipment?:CharacterEquipment,armorTraining?:unknown):T {
  const weapon=mainHand(equipment),family=weapon?.equipment?.weaponFamily;
  const shield=hasEquippedShield(equipment);
  const equipped=EQUIPMENT_SLOTS.flatMap(slot=>usable(equipment?.[slot],slot) && (slot!=="offHand"||shield)?[equipment![slot]!]:[]);
  const modifiers=equipped.flatMap(item=>{
    const family=getEquippedArmorFamily(item),bonuses=family?getArmorBonuses(armorTraining,family):undefined;
    return item.equipment!.modifiers.map(modifier=>{
      const percent=modifier.statCode==="ARMOR"?bonuses?.armorPercent:["MAX_HP","VITALITY"].includes(modifier.statCode)?bonuses?.hpPercent:0;
      return percent&&modifier.modifierType==="flat"&&modifier.value>0?{...modifier,value:modifier.value*(1+percent/100)}:modifier;
    });
  });
  const weaponModifiers=weapon?.equipment?.modifiers??[];
  const training=normalizeWeaponTraining(value);
  const bonus=(kind:WeaponFamily)=>1+getWeaponProficiency(training.experience[kind]).damageBonusPercent/100;
  const strength=Math.round(apply(base.strength,modifiers,"STRENGTH")),dexterity=Math.round(apply(base.dexterity,modifiers,"DEXTERITY")),vitality=Math.round(apply(base.vitality,modifiers,"VITALITY"));
  const hasMinimum=weaponModifiers.some(m=>m.statCode==="MIN_DAMAGE"),hasMaximum=weaponModifiers.some(m=>m.statCode==="MAX_DAMAGE");
  const minimum=apply(0,weaponModifiers,hasMinimum?"MIN_DAMAGE":"MAX_DAMAGE"),maximum=apply(0,weaponModifiers,hasMaximum?"MAX_DAMAGE":"MIN_DAMAGE");
  const weaponDamage=hasMinimum||hasMaximum?(minimum+maximum)/2:apply(0,weaponModifiers,"PHYSICAL_DAMAGE");
  const magic=family==="wand",ranged=family==="bow"||family==="crossbow"||magic,melee=!ranged;
  const shieldDamage=getEquippedShieldAttackBonus(equipment);
  const rangedBonus=magic?apply(0,weaponModifiers,"MAGIC_DAMAGE")+apply(0,modifiers,"SPELL_POWER"):dexterity-base.dexterity+weaponDamage;
  const statistics:T={...base,strength,dexterity,vitality,
    maxHp:Math.max(1,Math.round(apply(base.maxHp+(vitality-base.vitality)*10,modifiers,"MAX_HP"))),
    maxAp:Math.max(1,Math.min(8,Math.round(apply(base.maxAp,modifiers,"MAX_AP")))),
    initiative:Math.max(1,Math.round(apply(base.initiative,modifiers,"INITIATIVE"))),
    meleeDamage:melee?Math.max(1,Math.round(bounded((weapon?weaponDamage:base.meleeDamage)+strength-base.strength+shieldDamage)*(family?bonus(family):1))):0,
    rangedDamage:ranged?Math.max(1,Math.round(bounded(rangedBonus+shieldDamage)*bonus(family))):0,
    armor:Math.round(apply(base.armor,modifiers,"ARMOR")),meleeEnabled:melee,rangedEnabled:ranged};
  delete statistics.healingPower;delete statistics.blockPercent;
  if(family==="staff")statistics.healingPower=Math.max(1,Math.round(apply(0,modifiers,"SPELL_POWER")*bonus("staff")));
  if(shield)statistics.blockPercent=Math.min(95,apply(0,modifiers,"BLOCK_POWER")+getWeaponProficiency(training.experience.shield).level*0.15);
  for(const id of getLearnedWeaponSkills(training)) {
    const skill=getWeaponSkill(id)!;
    if(skill.kind!=="passive")continue;
    const percent=skill.passiveBonusPercent??0;
    if(skill.family==="shield"&&shield)statistics.blockPercent=Math.min(95,(statistics.blockPercent??0)+percent);
    else if(skill.family===family) {
      if(family==="staff")statistics.healingPower=Math.round((statistics.healingPower??0)*(1+percent/100));
      else if(ranged)statistics.rangedDamage=Math.round(statistics.rangedDamage*(1+percent/100));
      else statistics.meleeDamage=Math.round(statistics.meleeDamage*(1+percent/100));
    }
  }
  return statistics;
}

/** One half-XP budget, divided only among families actually used in that fight. */
export function allocateWeaponExperience(experienceGained:number,used:readonly WeaponFamily[]):Partial<Record<WeaponFamily,number>> {
  const families=WEAPON_FAMILIES.filter(family=>used.includes(family.id)).map(family=>family.id);
  if(!Number.isFinite(experienceGained)||experienceGained<=0||families.length===0)return{};
  const budget=Math.floor(Math.min(Number.MAX_SAFE_INTEGER,experienceGained)/2),share=Math.floor(budget/families.length),remainder=budget%families.length;
  return Object.fromEntries(families.flatMap((family,index)=>{const amount=share+(index<remainder?1:0);return amount>0?[[family,amount]]:[];}));
}
