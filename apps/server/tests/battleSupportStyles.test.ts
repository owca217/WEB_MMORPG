import { getCharacterStatistics,getWeaponCombatStatistics,normalizeWeaponTraining,type CharacterSnapshot } from "@web-mmorpg/shared";
import { expect,it } from "vitest";
import { BattleService } from "../src/battle/BattleService";
function character(hp=50):CharacterSnapshot {
 const training=normalizeWeaponTraining({loadout:{melee:"sword",ranged:"bow",support:"staff",defense:"shield"}});
 const statistics=getWeaponCombatStatistics(getCharacterStatistics(1),training);
 return {playerId:"hero",nickname:"Hero",level:1,hp,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[],statistics,weaponTraining:training};
}
it("preserves support stats and returns staff training for one real self heal",()=>{
 const service=new BattleService(),initial=service.startBattle(character(),"wolf-pack-01");
 const hero=initial.combatants.find(c=>c.ownerPlayerId)!;
 expect(hero.combatStats).toMatchObject({healingPower:20,blockPercent:10});
 const healed=service.applyCommand("hero",{type:"healSelf",combatantId:hero.id});
 expect(healed.result.ok).toBe(true);expect(healed.weaponTraining).toEqual({family:"staff",amount:1});
 expect(healed.snapshot?.combatants.find(c=>c.id===hero.id)).toMatchObject({hp:70,ap:2,healingUsedThisTurn:true});
 const repeat=service.applyCommand("hero",{type:"healSelf",combatantId:hero.id});
 expect(repeat.result.ok).toBe(false);expect(repeat.weaponTraining).toBeUndefined();
});
it("counts shield training only when an enemy attack was actually reduced, including Auto",()=>{
 const service=new BattleService();service.startBattle(character(100),"wolf-pack-01");service.setAuto("hero",true);
 let shield=0;
 for(let i=0;i<200;i++){
  const applied=service.applyAutoCommand("hero");expect(applied.result.ok).toBe(true);
  shield+=applied.shieldTraining??0;
  if(applied.finished)break;
 }
 expect(shield).toBeGreaterThan(0);
});
it("Auto heals a low-health staff user and awards staff training",()=>{
 const service=new BattleService();const s=service.startBattle(character(30),"wolf-pack-01");service.setAuto("hero",true);
 const result=service.applyAutoCommand("hero");expect(result.result.ok).toBe(true);
 expect(result.weaponTraining).toEqual({family:"staff",amount:1});
 expect(result.snapshot?.combatants.find(c=>c.ownerPlayerId)).toMatchObject({hp:50,ap:2,healingUsedThisTurn:true});
});
