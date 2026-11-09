import { expect, it } from 'vitest';
import { allocateArmorExperience, emptyCharacterEquipment, getArmorBonuses, getArmorSkillProgress, getCharacterStatistics, getEquipmentCombatStatistics, learnArmorSkill, normalizeArmorTraining, resetArmorSkillFamily, type ArmorFamily, type EquipmentSlot, type InventoryItem } from '../src/index';

const armor=(family:ArmorFamily,slot:EquipmentSlot='chest'):InventoryItem=>({instanceId:`${family}-${slot}`,itemId:`${family}-${slot}`,itemDefinitionId:'armor',name:'Pancerz',quantity:1,category:'armor',description:'',rarity:'COMMON',upgradeLevel:0,equipment:{slot,twoHanded:false,minimumLevel:30,armorFamily:family,modifiers:[{statCode:'ARMOR',modifierType:'flat',value:20},{statCode:'MAX_HP',modifierType:'flat',value:100}]}});

it('never derives stats from historical general level and uses only the equipped weapon damage',()=>{
 const gear=emptyCharacterEquipment();
 gear.mainHand={...armor('cloth'),category:'weapon',equipment:{slot:'mainHand',weaponFamily:'sword',twoHanded:false,minimumLevel:30,modifiers:[{statCode:'PHYSICAL_DAMAGE',modifierType:'flat',value:12}]}};
 const low=getEquipmentCombatStatistics(getCharacterStatistics(1),undefined,gear);
 expect(getEquipmentCombatStatistics(getCharacterStatistics(100),undefined,gear)).toEqual(low);
 expect(low).toMatchObject({strength:0,dexterity:0,vitality:0,maxHp:100,maxAp:5,initiative:10,meleeDamage:12,armor:0});
 expect(getEquipmentCombatStatistics(getCharacterStatistics(),undefined)).toMatchObject({meleeDamage:5,maxHp:100});
});

it('normalizes armor progress and validates point budgets, ranks and prerequisites independently',()=>{
 expect(normalizeArmorTraining({experience:{cloth:Infinity,leather:-10,plate:999999},learnedSkills:['unknown']})).toEqual({experience:{cloth:0,leather:0,plate:25250}});
 expect(()=>learnArmorSkill(undefined,'cloth:power')).toThrow('ARMOR_LEVEL_REQUIRED');
 expect(()=>learnArmorSkill(undefined,'sword:power')).toThrow('INVALID_ARMOR_SKILL');
 let training=normalizeArmorTraining({experience:{cloth:25250,plate:25250}});
 expect(()=>learnArmorSkill(training,'cloth:mastery')).toThrow('SKILL_PREREQUISITE_REQUIRED');
 for(const id of ['cloth:power','cloth:technique','cloth:mastery','plate:power'] as const)training=learnArmorSkill(training,id);
 expect(()=>learnArmorSkill(training,'cloth:ultimate')).toThrow('INSUFFICIENT_SKILL_POINTS');
 expect(getArmorSkillProgress(training,'cloth')).toMatchObject({level:100,earnedPoints:20,spentPoints:16,availablePoints:4,percentage:100});
 const reset=resetArmorSkillFamily(training,'cloth');
 expect(reset.experience).toEqual(training.experience);
 expect(reset.learnedSkills).toEqual(['plate:power']);
 expect(()=>resetArmorSkillFamily(training,'weapon')).toThrow('INVALID_ARMOR_FAMILY');
});

it('adds armor specialization only to usable matching worn pieces without compounding or touching naked stats',()=>{
 let training=normalizeArmorTraining({experience:{cloth:25250}});
 training=learnArmorSkill(training,'cloth:power');training=learnArmorSkill(training,'cloth:technique');
 expect(getArmorBonuses(training,'cloth')).toEqual({armorPercent:25,hpPercent:25});
 const gear=emptyCharacterEquipment();gear.chest=armor('cloth');gear.helmet=armor('plate','helmet');
 const base=getCharacterStatistics(),before=structuredClone(gear);
 const actual=getEquipmentCombatStatistics(base,undefined,gear,training);
 expect(actual).toMatchObject({armor:45,maxHp:325});
 expect(getEquipmentCombatStatistics(base,undefined,gear,training)).toEqual(actual);
 expect(gear).toEqual(before);expect(base.maxHp).toBe(100);
 gear.chest.durability=0;
 expect(getEquipmentCombatStatistics(base,undefined,gear,training)).toMatchObject({armor:20,maxHp:200});
 expect(getEquipmentCombatStatistics(base,undefined,undefined,training)).toMatchObject({armor:0,maxHp:100});
});

it('splits the half-XP armor budget by worn piece count with a stable remainder and no credit for invalid gear',()=>{
 const gear=emptyCharacterEquipment();gear.chest=armor('cloth');gear.helmet=armor('cloth','helmet');gear.boots=armor('leather','boots');
 expect(allocateArmorExperience(45,gear)).toEqual({cloth:15,leather:7});
 gear.helmet.durability=0;
 expect(allocateArmorExperience(43,gear)).toEqual({cloth:11,leather:10});
 gear.chest.quantity=2;
 expect(allocateArmorExperience(43,gear)).toEqual({leather:21});
 expect(allocateArmorExperience(Number.NaN,gear)).toEqual({});
 expect(allocateArmorExperience(40,emptyCharacterEquipment())).toEqual({});
});
