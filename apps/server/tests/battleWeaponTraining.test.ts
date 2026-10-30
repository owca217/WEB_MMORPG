import { getCharacterStatistics, type CharacterSnapshot, type BattleCommand } from "@web-mmorpg/shared";
import { expect, it } from "vitest";
import { combatEquipment } from "./combatEquipmentFixtures";
import { CharacterService } from "../src/character/CharacterService";
import { BattleService } from "../src/battle/BattleService";
import { hexDistance, hexKey, hexNeighbors, findPath } from "../src/battle/hex";
import { hasLineOfSight } from "../src/battle/lineOfSight";
import type { BattleSnapshot } from "@web-mmorpg/shared";

function hero():CharacterSnapshot {
 const stats=getCharacterStatistics(1);
 return {playerId:"hero",nickname:"Hero",level:1,hp:stats.maxHp,maxHp:stats.maxHp,maxAp:stats.maxAp,initiative:stats.initiative,severelyInjured:false,injuries:[],equipment:combatEquipment("axe"),weaponTraining:{loadout:{melee:"axe",ranged:"crossbow"},experience:{sword:0,axe:25250,hammer:0,dagger:0,spear:0,bow:0,crossbow:25250,staff:0,shield:0}}};
}
function commandFor(s:BattleSnapshot):BattleCommand {
 const actor=s.combatants.find(c=>c.ownerPlayerId==="hero")!,target=s.combatants.find(c=>c.side==="enemy" && c.hp>0)!;
 const distance=hexDistance(actor.position,target.position),blocked=new Set(s.blockedCells.map(hexKey));
 if(distance===1 && actor.ap>=2 && actor.combatStats?.meleeEnabled!==false)return {type:"meleeAttack",combatantId:actor.id,targetId:target.id};
 if(distance<=6 && actor.ap>=3 && actor.combatStats?.rangedEnabled!==false && hasLineOfSight(actor.position,target.position,blocked))return {type:"rangedAttack",combatantId:actor.id,targetId:target.id};
 if(distance>1 && actor.ap>0){
  const allowed=new Set(s.cells.map(hexKey));blocked.add(hexKey(target.position));
  const paths=hexNeighbors(target.position).filter(p=>allowed.has(hexKey(p))&&!blocked.has(hexKey(p))).map(p=>findPath(actor.position,p,blocked,allowed)).filter((p):p is NonNullable<typeof p>=>Boolean(p?.length)).sort((a,b)=>a.length-b.length);
  if(paths[0]?.[0])return {type:"move",combatantId:actor.id,target:paths[0][0]};
 }
 return {type:"endTurn",combatantId:actor.id};
}
it("applies proficiency once when statistics are absent or already derived by CharacterService",()=>{
 const base=hero(),raw=new BattleService().startBattle(base,"wolf-pack-01");
 expect(raw.combatants.find(c=>c.ownerPlayerId)?.combatStats).toMatchObject({meleeDamage:25,rangedDamage:0});
 const characters=new CharacterService(),derived=characters.hydrate(base);
 const ready=new BattleService().startBattle(derived,"wolf-pack-01");
 expect(ready.combatants.find(c=>c.ownerPlayerId)?.combatStats).toMatchObject({meleeDamage:25,rangedDamage:0});
});
it("records the actually equipped family only after accepted attacks and captures gear at battle start",()=>{
 const service=new BattleService(),input=hero();let snapshot=service.startBattle(input,"wolf-pack-01");input.equipment=combatEquipment("sword");
 let terminal,attacks=0;
 for(let i=0;i<200;i++){
  const command=commandFor(snapshot),applied=service.applyCommand("hero",command);expect(applied.result.ok).toBe(true);snapshot=applied.snapshot!;
  expect(applied.weaponTraining).toBeUndefined();expect(applied.trainingAwards).toBeUndefined();
  if(command.type==="meleeAttack"){attacks++;const invalid=service.applyCommand("hero",{type:"rangedAttack",combatantId:command.combatantId,targetId:"missing"});expect(invalid.result.ok).toBe(false);expect(invalid.usedWeaponFamilies).toBeUndefined();}
  if(applied.finished){terminal=applied;break;}expect(applied.usedWeaponFamilies).toBeUndefined();
 }
 expect(attacks).toBeGreaterThan(0);expect(terminal?.usedWeaponFamilies).toEqual({hero:["axe"]});
});
it("Auto records actual use and emits no immediate training points",()=>{
 const service=new BattleService();service.startBattle(hero(),"wolf-pack-01");service.setAuto("hero",true);let terminal;
 for(let i=0;i<200;i++){const applied=service.applyAutoCommand("hero");expect(applied.result.ok).toBe(true);expect(applied.weaponTraining).toBeUndefined();expect(applied.shieldTraining).toBeUndefined();if(applied.finished){terminal=applied;break;}}
 expect(terminal?.usedWeaponFamilies).toEqual({hero:["axe"]});
});
it("unarmed combat ignores persisted free styles and never trains their families",()=>{
 const service=new BattleService(),input=hero();delete input.equipment;service.startBattle(input,"wolf-pack-01");service.setAuto("hero",true);let terminal;
 for(let i=0;i<200;i++){const result=service.applyAutoCommand("hero");expect(result.result.ok).toBe(true);if(result.finished){terminal=result;break;}}
 expect(terminal?.usedWeaponFamilies).toEqual({hero:[]});
});
