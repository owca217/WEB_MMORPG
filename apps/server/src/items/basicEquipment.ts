import type { ItemStatModifier, WeaponFamily } from "@web-mmorpg/shared";

export interface BasicEquipmentItem {
  itemId:string;
  name:string;
  categoryId:"weapon"|"armor";
  subcategoryId:string;
  weaponFamily?:WeaponFamily;
  unitPrice:number;
  stats:ItemStatModifier[];
}
const flat=(statCode:string,value:number):ItemStatModifier=>({statCode,modifierType:"flat",value});
const weapon=(family:Exclude<WeaponFamily,"shield">,name:string,damage:number,unitPrice:number,extra:ItemStatModifier[]=[]):BasicEquipmentItem=>({
  itemId:`training-${family}`,name,categoryId:"weapon",subcategoryId:family,weaponFamily:family,unitPrice,stats:[flat("PHYSICAL_DAMAGE",damage),...extra]
});
const armor=(slot:string,name:string,value:number,unitPrice:number):BasicEquipmentItem=>({itemId:`cloth-${slot}`,name,categoryId:"armor",subcategoryId:slot,unitPrice,stats:[flat("ARMOR",value)]});

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
  armor("cloak","Płócienny płaszcz",1,8)
];
