import type { ArmorFamily, ItemStatModifier, WeaponFamily } from "@web-mmorpg/shared";

export interface BasicEquipmentItem {
  itemId:string;
  name:string;
  categoryId:"weapon"|"armor";
  subcategoryId:string;
  weaponFamily?:WeaponFamily;
  armorFamily?:ArmorFamily;
  unitPrice:number;
  stats:ItemStatModifier[];
}
const flat=(statCode:string,value:number):ItemStatModifier=>({statCode,modifierType:"flat",value});
const weapon=(family:Exclude<WeaponFamily,"shield">,name:string,damage:number,unitPrice:number,extra:ItemStatModifier[]=[]):BasicEquipmentItem=>({
  itemId:`training-${family}`,name,categoryId:"weapon",subcategoryId:family,weaponFamily:family,unitPrice,stats:[flat("PHYSICAL_DAMAGE",damage),...extra]
});
const armor=(slot:string,name:string,value:number,unitPrice:number,armorFamily:ArmorFamily="cloth",extra:ItemStatModifier[]=[]):BasicEquipmentItem=>({
  itemId:`${armorFamily}-${slot}`,name,categoryId:"armor",subcategoryId:slot,armorFamily,unitPrice,stats:[flat("ARMOR",value),...extra]
});

export const BASIC_EQUIPMENT_ITEMS:readonly BasicEquipmentItem[]=[
  weapon("sword","Miecz treningowy",12,20),
  weapon("axe","Topór treningowy",15,25),
  weapon("hammer","Młot treningowy",14,25),
  weapon("dagger","Sztylet treningowy",8,20),
  weapon("spear","Włócznia treningowa",13,25),
  weapon("bow","Łuk treningowy",12,30),
  weapon("crossbow","Kusza treningowa",16,35),
  weapon("staff","Kostur ucznia",6,30,[flat("SPELL_POWER",8)]),
  {itemId:"training-shield",name:"Tarcza treningowa",categoryId:"armor",subcategoryId:"shield",unitPrice:20,stats:[flat("BLOCK_POWER",10)]},
  armor("helmet","Płócienny kaptur",1,10),
  armor("chest","Płócienna tunika",3,20),
  armor("gloves","Płócienne rękawice",1,8),
  armor("pants","Płócienne spodnie",2,15),
  armor("boots","Płócienne buty",1,10),
  armor("cloak","Płócienny płaszcz",1,8),
  armor("helmet","Skórzany kaptur",2,25,"leather",[flat("MAX_HP",4),flat("DEXTERITY",1)]),
  armor("chest","Skórzany kaftan",6,55,"leather",[flat("MAX_HP",10),flat("VITALITY",1)]),
  armor("gloves","Skórzane rękawice",2,20,"leather",[flat("MAX_HP",3),flat("DEXTERITY",1)]),
  armor("pants","Skórzane spodnie",4,40,"leather",[flat("MAX_HP",7),flat("VITALITY",1)]),
  armor("boots","Skórzane buty",2,25,"leather",[flat("MAX_HP",3),flat("DEXTERITY",1)]),
  armor("cloak","Skórzany płaszcz",2,20,"leather",[flat("MAX_HP",3),flat("DEXTERITY",1)]),
  armor("helmet","Płytowy hełm",3,40,"plate",[flat("MAX_HP",6),flat("STRENGTH",1)]),
  armor("chest","Płytowy napierśnik",9,85,"plate",[flat("MAX_HP",15),flat("VITALITY",2)]),
  armor("gloves","Płytowe rękawice",3,35,"plate",[flat("MAX_HP",5),flat("STRENGTH",1)]),
  armor("pants","Płytowe nogawice",6,60,"plate",[flat("MAX_HP",10),flat("VITALITY",1)]),
  armor("boots","Płytowe buty",3,40,"plate",[flat("MAX_HP",5),flat("VITALITY",1)]),
  armor("cloak","Płaszcz płytkowy",3,35,"plate",[flat("MAX_HP",4),flat("STRENGTH",1)])
];
