import { getCharacterStatistics, type CharacterSnapshot } from "@web-mmorpg/shared";
import { expect,it } from "vitest";
import { BattleService, type AppliedBattleCommand } from "../src/battle/BattleService";
import { combatEquipment } from "./combatEquipmentFixtures";

function character(hp=50, family:"staff"|"sword"="staff",shield=false):CharacterSnapshot {
 const statistics=getCharacterStatistics(1);
 return {playerId:"hero",nickname:"Hero",level:1,hp,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[],statistics,equipment:combatEquipment(family,shield)};
}
function finish(service:BattleService):AppliedBattleCommand {
 service.setAuto("hero",true);
 for(let i=0;i<300;i++){
  const result=service.applyAutoCommand("hero");expect(result.result.ok).toBe(true);
  expect(result.weaponTraining).toBeUndefined();expect(result.shieldTraining).toBeUndefined();
  if(result.finished)return result;
 }
 throw new Error("Auto did not finish the encounter");
}
it("restores real HP with an equipped staff and records its family only at settlement",()=>{
 const service=new BattleService(),initial=service.startBattle(character(),"wolf-pack-01");
 const hero=initial.combatants.find(c=>c.ownerPlayerId)!;
 expect(hero.combatStats).toMatchObject({healingPower:20});expect(hero.combatStats?.blockPercent).toBeUndefined();
 const healed=service.applyCommand("hero",{type:"healSelf",combatantId:hero.id});
 expect(healed.result.ok).toBe(true);expect(healed.weaponTraining).toBeUndefined();expect(healed.usedWeaponFamilies).toBeUndefined();
 expect(healed.snapshot?.combatants.find(c=>c.id===hero.id)).toMatchObject({hp:70,ap:2,healingUsedThisTurn:true});
 const repeat=service.applyCommand("hero",{type:"healSelf",combatantId:hero.id});
 expect(repeat.result.ok).toBe(false);expect(repeat.weaponTraining).toBeUndefined();
 expect(finish(service).usedWeaponFamilies).toEqual({hero:["staff"]});
});
it("records an equipped shield only after it actually reduces an enemy hit, including Auto",()=>{
 const service=new BattleService();const initial=service.startBattle(character(100,"sword",true),"wolf-pack-01");
 expect(initial.combatants.find(c=>c.ownerPlayerId)?.combatStats?.blockPercent).toBe(10);
 expect(finish(service).usedWeaponFamilies?.hero).toEqual(expect.arrayContaining(["sword","shield"]));
});
it("Auto heals a low-health staff user without awarding per-action experience",()=>{
 const service=new BattleService();service.startBattle(character(30),"wolf-pack-01");service.setAuto("hero",true);
 const result=service.applyAutoCommand("hero");expect(result.result.ok).toBe(true);
 expect(result.weaponTraining).toBeUndefined();expect(result.usedWeaponFamilies).toBeUndefined();
 expect(result.snapshot?.combatants.find(c=>c.ownerPlayerId)).toMatchObject({hp:50,ap:2,healingUsedThisTurn:true});
});
