import type { CharacterEquipment } from './equipment';
import type { InventoryItem } from './inventory';
import { getWeaponProficiency, normalizeWeaponExperience } from './weaponProgression';

export const ARMOR_FAMILIES = [
  { id: 'cloth', label: 'Pancerze płócienne' },
  { id: 'leather', label: 'Pancerze skórzane' },
  { id: 'plate', label: 'Pancerze płytowe' }
] as const;
export type ArmorFamily = (typeof ARMOR_FAMILIES)[number]['id'];
export type ArmorSkillId = `${ArmorFamily}:${'power' | 'technique' | 'mastery' | 'ultimate'}`;
export interface ArmorTraining { experience: Record<ArmorFamily, number>; learnedSkills?: ArmorSkillId[]; }
export interface ArmorSkillDefinition {
  id: ArmorSkillId; family: ArmorFamily; name: string; description: string;
  kind: 'passive'; requiredLevel: number; pointCost: number; prerequisite?: ArmorSkillId;
  armorBonusPercent: number; hpBonusPercent: number;
}

export const ARMOR_SKILLS: readonly ArmorSkillDefinition[] = ARMOR_FAMILIES.flatMap(({id:family,label}) => [
  { id:`${family}:power` as ArmorSkillId, family, name:'Pewna ochrona', requiredLevel:10, pointCost:2, armorBonusPercent:5, hpBonusPercent:0 },
  { id:`${family}:technique` as ArmorSkillId, family, name:'Dopasowane uzbrojenie', requiredLevel:30, pointCost:6, armorBonusPercent:0, hpBonusPercent:5 },
  { id:`${family}:mastery` as ArmorSkillId, family, name:'Mistrzowska ochrona', requiredLevel:50, pointCost:8, prerequisite:`${family}:technique` as ArmorSkillId, armorBonusPercent:10, hpBonusPercent:0 },
  { id:`${family}:ultimate` as ArmorSkillId, family, name:'Druga skóra', requiredLevel:60, pointCost:8, prerequisite:`${family}:power` as ArmorSkillId, armorBonusPercent:0, hpBonusPercent:10 }
].map(node => ({ ...node, kind:'passive' as const, description:node.armorBonusPercent
  ? `Zwiększa pancerz zapewniany przez ${label.toLowerCase()} o ${node.armorBonusPercent}%. Działa wyłącznie na założone, sprawne elementy tej rodziny.`
  : `Zwiększa premie do HP i żywotności zapewniane przez ${label.toLowerCase()} o ${node.hpBonusPercent}%. Nie zwiększa bazowego HP postaci.`
})));
const skillsById = new Map(ARMOR_SKILLS.map(skill => [skill.id, skill]));
const record=(value:unknown):Record<string,unknown> => value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
export function getArmorSkill(id:unknown):ArmorSkillDefinition|undefined { return typeof id==='string' ? skillsById.get(id as ArmorSkillId) : undefined; }

export function normalizeArmorTraining(value:unknown):ArmorTraining {
  const input=record(value), stored=record(input.experience);
  const experience=Object.fromEntries(ARMOR_FAMILIES.map(({id})=>[id,normalizeWeaponExperience(stored[id])])) as Record<ArmorFamily,number>;
  const requested=new Set(Array.isArray(input.learnedSkills) ? input.learnedSkills : []), learnedSkills:ArmorSkillId[]=[];
  for(const {id:family} of ARMOR_FAMILIES){
    const level=getWeaponProficiency(experience[family]).level;
    let points=Math.floor(level/5);
    for(const skill of ARMOR_SKILLS.filter(skill=>skill.family===family)){
      if(!requested.has(skill.id) || level<skill.requiredLevel || points<skill.pointCost || skill.prerequisite&&!learnedSkills.includes(skill.prerequisite))continue;
      learnedSkills.push(skill.id);points-=skill.pointCost;
    }
  }
  return {experience,...(learnedSkills.length?{learnedSkills}:{})};
}

export function getArmorSkillProgress(value:unknown,family:ArmorFamily){
  const training=normalizeArmorTraining(value), progress=getWeaponProficiency(training.experience[family]);
  const learnedSkills=(training.learnedSkills??[]).filter(id=>getArmorSkill(id)!.family===family);
  const earnedPoints=Math.floor(progress.level/5), spentPoints=learnedSkills.reduce((total,id)=>total+getArmorSkill(id)!.pointCost,0);
  return {level:progress.level,experience:progress.experience,current:progress.current,required:progress.required,percentage:progress.percentage,earnedPoints,spentPoints,availablePoints:earnedPoints-spentPoints,learnedSkills};
}

export function learnArmorSkill(value:unknown,id:unknown):ArmorTraining {
  const skill=getArmorSkill(id);if(!skill)throw new Error('INVALID_ARMOR_SKILL');
  const training=normalizeArmorTraining(value),progress=getArmorSkillProgress(training,skill.family);
  if(progress.learnedSkills.includes(skill.id))return training;
  if(progress.level<skill.requiredLevel)throw new Error('ARMOR_LEVEL_REQUIRED');
  if(skill.prerequisite&&!progress.learnedSkills.includes(skill.prerequisite))throw new Error('SKILL_PREREQUISITE_REQUIRED');
  if(progress.availablePoints<skill.pointCost)throw new Error('INSUFFICIENT_SKILL_POINTS');
  return {...training,learnedSkills:[...(training.learnedSkills??[]),skill.id]};
}

export function resetArmorSkillFamily(value:unknown,family:unknown):ArmorTraining {
  if(!ARMOR_FAMILIES.some(item=>item.id===family))throw new Error('INVALID_ARMOR_FAMILY');
  const training=normalizeArmorTraining(value);
  return {...training,learnedSkills:(training.learnedSkills??[]).filter(id=>getArmorSkill(id)!.family!==family)};
}

export function getArmorBonuses(value:unknown,family:ArmorFamily):{armorPercent:number;hpPercent:number}{
  const progress=getArmorSkillProgress(value,family);
  const bonuses={armorPercent:progress.level*0.2,hpPercent:progress.level*0.2};
  for(const id of progress.learnedSkills){const skill=getArmorSkill(id)!;bonuses.armorPercent+=skill.armorBonusPercent;bonuses.hpPercent+=skill.hpBonusPercent;}
  return bonuses;
}

const armorSlots=['helmet','chest','gloves','pants','boots','cloak'] as const;
export function getEquippedArmorFamily(item:InventoryItem|null|undefined):ArmorFamily|undefined {
  if(!item?.equipment || item.category!=='armor' || !armorSlots.some(slot=>slot===item.equipment!.slot) || item.quantity!==1 || item.durability!==undefined&&item.durability<=0)return;
  if(ARMOR_FAMILIES.some(family=>family.id===item.equipment!.armorFamily))return item.equipment.armorFamily;
  // Only these known original seeds have a safe legacy classification.
  if(armorSlots.some(slot=>item.itemId===`cloth-${slot}`))return 'cloth';
}

/** Second half of the fight reward; worn piece counts weight mixed armor families. */
export function allocateArmorExperience(reward:number,equipment?:CharacterEquipment):Partial<Record<ArmorFamily,number>> {
  if(!Number.isFinite(reward)||reward<=0)return{};
  const counts:Record<ArmorFamily,number>={cloth:0,leather:0,plate:0};
  for(const slot of armorSlots){const item=equipment?.[slot];if(item?.equipment?.slot!==slot)continue;const family=getEquippedArmorFamily(item);if(family)counts[family]++;}
  const count=Object.values(counts).reduce((sum,value)=>sum+value,0);if(!count)return{};
  const budget=Math.floor(Math.min(Number.MAX_SAFE_INTEGER,reward)/2);
  const shares=ARMOR_FAMILIES.filter(({id})=>counts[id]>0).map(({id},index)=>{
    const exact=budget*counts[id]/count;return {id,amount:Math.floor(exact),remainder:exact%1,index};
  });
  let rest=budget-shares.reduce((sum,share)=>sum+share.amount,0);
  for(const share of [...shares].sort((a,b)=>b.remainder-a.remainder||a.index-b.index)){if(rest--<=0)break;share.amount++;}
  return Object.fromEntries(shares.filter(share=>share.amount>0).map(share=>[share.id,share.amount]));
}
