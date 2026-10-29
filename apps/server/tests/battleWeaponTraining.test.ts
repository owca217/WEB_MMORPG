import { getCharacterStatistics, type CharacterSnapshot, type BattleCommand } from "@web-mmorpg/shared";
import { expect, it } from "vitest";
import { CharacterService } from "../src/character/CharacterService";
import { BattleService } from "../src/battle/BattleService";
import { hexDistance, hexKey, hexNeighbors, findPath } from "../src/battle/hex";
import { hasLineOfSight } from "../src/battle/lineOfSight";
import type { BattleSnapshot } from "@web-mmorpg/shared";

function hero():CharacterSnapshot {
 const stats=getCharacterStatistics(1);
 return {playerId:"hero",nickname:"Hero",level:1,hp:stats.maxHp,maxHp:stats.maxHp,maxAp:stats.maxAp,initiative:stats.initiative,severelyInjured:false,injuries:[],weaponTraining:{loadout:{melee:"axe",ranged:"crossbow"},experience:{sword:0,axe:25250,hammer:0,dagger:0,spear:0,bow:0,crossbow:25250}}};
}
function commandFor(s:BattleSnapshot):BattleCommand {
 const actor=s.combatants.find(c=>c.ownerPlayerId==="hero")!,target=s.combatants.find(c=>c.side==="enemy" && c.hp>0)!;
 const distance=hexDistance(actor.position,target.position),blocked=new Set(s.blockedCells.map(hexKey));
 if(distance===1 && actor.ap>=2)return {type:"meleeAttack",combatantId:actor.id,targetId:target.id};
 if(distance<=6 && actor.ap>=3 && hasLineOfSight(actor.position,target.position,blocked))return {type:"rangedAttack",combatantId:actor.id,targetId:target.id};
 if(distance>1 && actor.ap>0){
  const allowed=new Set(s.cells.map(hexKey));blocked.add(hexKey(target.position));
  const paths=hexNeighbors(target.position).filter(p=>allowed.has(hexKey(p))&&!blocked.has(hexKey(p))).map(p=>findPath(actor.position,p,blocked,allowed)).filter((p):p is NonNullable<typeof p>=>Boolean(p?.length)).sort((a,b)=>a.length-b.length);
  if(paths[0]?.[0])return {type:"move",combatantId:actor.id,target:paths[0][0]};
 }
 return {type:"endTurn",combatantId:actor.id};
}
it("applies proficiency once when statistics are absent or already derived by CharacterService",()=>{
 const base=hero(),raw=new BattleService().startBattle(base,"wolf-pack-01");
 expect(raw.combatants.find(c=>c.ownerPlayerId)?.combatStats).toMatchObject({meleeDamage:25,rangedDamage:19});
 const characters=new CharacterService(),derived=characters.hydrate(base);
 const ready=new BattleService().startBattle(derived,"wolf-pack-01");
 expect(ready.combatants.find(c=>c.ownerPlayerId)?.combatStats).toMatchObject({meleeDamage:25,rangedDamage:19});
});
it("credits only accepted player attacks to the family captured at battle start",()=>{
 const service=new BattleService(),input=hero();let snapshot=service.startBattle(input,"wolf-pack-01");
 input.weaponTraining!.loadout={melee:"sword",ranged:"bow"};
 const observed=new Set<string>();
 for(let i=0;i<150;i++){
  const command=commandFor(snapshot),applied=service.applyCommand("hero",command);
  expect(applied.result.ok).toBe(true);snapshot=applied.snapshot!;
  if(command.type==="meleeAttack" || command.type==="rangedAttack"){
   const family=command.type==="meleeAttack"?"axe":"crossbow";
   expect(applied.weaponTraining).toEqual({family,amount:1});observed.add(family);
   const invalid=service.applyCommand("hero",{type:"rangedAttack",combatantId:command.combatantId,targetId:"missing"});
   expect(invalid.result.ok).toBe(false);expect(invalid.weaponTraining).toBeUndefined();
  }else expect(applied.weaponTraining).toBeUndefined();
  if(applied.finished)break;
 }
 expect([...observed].sort()).toEqual(["axe","crossbow"]);
});
it("automatic combat awards the same accepted attack training",()=>{
 const service=new BattleService();service.startBattle(hero(),"wolf-pack-01");service.setAuto("hero",true);
 let credits=0;
 for(let i=0;i<150;i++){
  const applied=service.applyAutoCommand("hero");expect(applied.result.ok).toBe(true);
  if(applied.weaponTraining){expect(["axe","crossbow"]).toContain(applied.weaponTraining.family);expect(applied.weaponTraining.amount).toBe(1);credits++;}
  if(applied.finished)break;
 }
 expect(credits).toBeGreaterThan(0);
});
