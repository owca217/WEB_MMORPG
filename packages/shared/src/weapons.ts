import type { CharacterSnapshot } from "./character";
import type { CombatStatistics } from "./characterProgression";

export const WEAPON_FAMILIES = [
  {id:"sword",label:"Miecze",mode:"melee"},
  {id:"axe",label:"Topory",mode:"melee"},
  {id:"hammer",label:"Broń obuchowa",mode:"melee"},
  {id:"dagger",label:"Sztylety",mode:"melee"},
  {id:"spear",label:"Broń drzewcowa",mode:"melee"},
  {id:"bow",label:"Łuki",mode:"ranged"},
  {id:"crossbow",label:"Kusze",mode:"ranged"},
  {id:"staff",label:"Kostury leczące",mode:"support"},
  {id:"shield",label:"Tarcze",mode:"defense"}
] as const;
export type WeaponFamily = (typeof WEAPON_FAMILIES)[number]["id"];
export type MeleeWeaponFamily = Extract<(typeof WEAPON_FAMILIES)[number],{mode:"melee"}>["id"];
export type RangedWeaponFamily = Extract<(typeof WEAPON_FAMILIES)[number],{mode:"ranged"}>["id"];
export interface WeaponLoadout {melee:MeleeWeaponFamily;ranged:RangedWeaponFamily;support?:"staff"|"none";defense?:"shield"|"none"}
export interface WeaponTraining {experience:Record<WeaponFamily,number>;loadout:WeaponLoadout}
export type WeaponLoadoutResult = {ok:true;character:CharacterSnapshot}|{ok:false;code:string;message:string};
export const MAX_WEAPON_EXPERIENCE = 25250;
export const STAFF_HEAL_AP_COST = 3;

function record(value:unknown):Record<string,unknown> {
  return value!==null && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
function normalizeExperience(value:unknown):number {
  return typeof value==="number" && Number.isFinite(value) ? Math.max(0,Math.min(MAX_WEAPON_EXPERIENCE,Math.floor(value))) : 0;
}
export function isWeaponLoadout(value:unknown):value is WeaponLoadout {
  const loadout=record(value);
  return WEAPON_FAMILIES.some(family=>family.mode==="melee" && family.id===loadout.melee)
    && WEAPON_FAMILIES.some(family=>family.mode==="ranged" && family.id===loadout.ranged)
    && (loadout.support===undefined || loadout.support==="none" || loadout.support==="staff")
    && (loadout.defense===undefined || loadout.defense==="none" || loadout.defense==="shield");
}
export function normalizeWeaponTraining(value:unknown):WeaponTraining {
  const stored=record(value),experience=record(stored.experience),loadout=record(stored.loadout);
  return {
    experience:Object.fromEntries(WEAPON_FAMILIES.map(family=>[family.id,normalizeExperience(Object.hasOwn(experience,family.id) ? experience[family.id] : undefined)])) as Record<WeaponFamily,number>,
    loadout:{
      melee:WEAPON_FAMILIES.some(family=>family.mode==="melee" && family.id===loadout.melee) ? loadout.melee as MeleeWeaponFamily : "sword",
      ranged:WEAPON_FAMILIES.some(family=>family.mode==="ranged" && family.id===loadout.ranged) ? loadout.ranged as RangedWeaponFamily : "bow",
      ...(loadout.support==="staff" ? {support:"staff"} : {}),
      ...(loadout.defense==="shield" ? {defense:"shield"} : {})
    }
  };
}
export function getWeaponProficiency(totalExperience:number):{
  level:number;experience:number;current:number;required:number;percentage:number;damageBonusPercent:number;
} {
  const experience=normalizeExperience(totalExperience);
  const level=Math.min(100,Math.floor((Math.sqrt(1+8*experience/5)-1)/2));
  const current=level===100 ? 0 : experience-5*level*(level+1)/2;
  const required=level===100 ? 0 : 5*(level+1);
  return {level,experience,current,required,percentage:level===100 ? 100 : current/required*100,damageBonusPercent:level*0.25};
}
export function getWeaponCombatStatistics<T extends CombatStatistics>(base:T,value:unknown):T {
  const training=normalizeWeaponTraining(value);
  const bonus=(family:WeaponFamily)=>1+getWeaponProficiency(training.experience[family]).damageBonusPercent/100;
  const statistics={...base,meleeDamage:Math.round(base.meleeDamage*bonus(training.loadout.melee)),rangedDamage:Math.round(base.rangedDamage*bonus(training.loadout.ranged))};
  delete statistics.healingPower;delete statistics.blockPercent;
  if(training.loadout.support==="staff")statistics.healingPower=Math.round(base.meleeDamage*bonus("staff"));
  if(training.loadout.defense==="shield")statistics.blockPercent=10+getWeaponProficiency(training.experience.shield).level*0.15;
  return statistics;
}
