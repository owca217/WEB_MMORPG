import { expect,it } from "vitest";
import { CharacterService } from "../src/character/CharacterService";
import { combatEquipment,armorItem } from "./combatEquipmentFixtures";

it("trains families independently, caps progress and isolates returned equipment snapshots",()=>{
 const service=new CharacterService();service.createPlayer("hero","Hero");
 expect(service.trainWeapon("hero","sword",5).weaponTraining?.experience).toEqual({sword:5,axe:0,hammer:0,dagger:0,spear:0,bow:0,crossbow:0,staff:0,shield:0});
 service.trainWeapon("hero","bow",25251);
 const input=combatEquipment("axe"),loaded=service.setEquipment("hero",input);
 loaded.weaponTraining!.experience.bow=999;loaded.equipment!.mainHand!.name="changed";input.mainHand!.name="also changed";
 expect(service.getSnapshot("hero")?.weaponTraining?.experience).toMatchObject({sword:5,bow:25250});
 expect(service.getSnapshot("hero")?.equipment?.mainHand?.name).toBe("axe");
 for(const amount of [-1,0.5,NaN,Infinity])expect(()=>service.trainWeapon("hero","sword",amount)).toThrow("INVALID_WEAPON_EXPERIENCE");
 expect(()=>service.trainWeapon("hero","wand" as "sword",1)).toThrow("INVALID_WEAPON_FAMILY");
});

it("recalculates equipped bonuses once through hydration and character level ups",()=>{
 const service=new CharacterService(),fresh=service.createPlayer("hero","Hero");
 const input={...fresh,equipment:combatEquipment("sword"),weaponTraining:{experience:{sword:25250,axe:0,hammer:0,dagger:0,spear:0,bow:25250,crossbow:0,staff:0,shield:0},loadout:{melee:"axe" as const,ranged:"bow" as const}}};
 const hydrated=service.hydrate(input);input.weaponTraining.experience.sword=0;
 expect(hydrated.statistics).toMatchObject({strength:10,meleeDamage:25,rangedDamage:0});
 expect(service.hydrate(hydrated).statistics).toMatchObject({meleeDamage:25,rangedDamage:0});
 expect(service.awardExperience("hero",100).statistics).toMatchObject({strength:12,meleeDamage:28,rangedDamage:0});
 expect(service.setEquipment("hero",combatEquipment("crossbow")).statistics).toMatchObject({meleeDamage:0,rangedDamage:16});
});

it("equipment changes clamp HP but never heal when armor is removed and re-equipped",()=>{
 const service=new CharacterService(),fresh=service.createPlayer("hero","Hero");service.hydrate({...fresh,hp:57});
 const armor=combatEquipment();armor.chest=armorItem("chest",[{statCode:"MAX_HP",modifierType:"flat",value:50}]);
 expect(service.setEquipment("hero",armor)).toMatchObject({hp:57,maxHp:150});
 expect(service.setEquipment("hero",combatEquipment())).toMatchObject({hp:57,maxHp:100});
 expect(service.setEquipment("hero",armor)).toMatchObject({hp:57,maxHp:150});
 service.hydrate({...fresh,hp:0});expect(service.setEquipment("hero",armor).hp).toBe(0);
});
it("restores only missing HP while retaining injuries and never revives a defeated character",()=>{
 const service=new CharacterService(),fresh=service.createPlayer("hero","Hero");
 service.hydrate({...fresh,hp:57,severelyInjured:true,injuries:["bleeding"]});
 expect(service.restoreHp("hero",25)).toBe(25);expect(service.getSnapshot("hero")).toMatchObject({hp:82,severelyInjured:true,injuries:["bleeding"]});
 expect(service.restoreHp("hero",50)).toBe(18);expect(service.restoreHp("hero",20)).toBe(0);
 for(const amount of [0,-1,0.5,NaN,Infinity])expect(()=>service.restoreHp("hero",amount)).toThrow("INVALID_HEAL_AMOUNT");
 service.hydrate({...fresh,hp:0});expect(()=>service.restoreHp("hero",20)).toThrow("COMBATANT_DOWN");
});
