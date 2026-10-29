import { expect, it } from "vitest";
import { getWeaponCombatStatistics, isWeaponLoadout, normalizeWeaponTraining } from "../src/weapons";
import { getBattleAttackPreview, getBattleHealingPreview, mitigatedBattleDamage } from "../src/battleRules";
import type { BattleSnapshot } from "../src/battle";

it("keeps legacy selection shape while adding independent support and defense proficiencies",()=>{
 const legacy=normalizeWeaponTraining({loadout:{melee:"axe",ranged:"crossbow"},experience:{axe:15}});
 expect(legacy.loadout).toEqual({melee:"axe",ranged:"crossbow"});
 expect(legacy.experience).toMatchObject({axe:15,staff:0,shield:0});
 expect(isWeaponLoadout({melee:"sword",ranged:"bow",support:"staff",defense:"shield"})).toBe(true);
 expect(isWeaponLoadout({melee:"sword",ranged:"bow",support:"none",defense:"none"})).toBe(true);
 expect(isWeaponLoadout({melee:"sword",ranged:"bow",support:"bow"})).toBe(false);
 expect(isWeaponLoadout({melee:"sword",ranged:"bow",defense:"staff"})).toBe(false);
 expect(normalizeWeaponTraining({loadout:{support:"none",defense:"none"}}).loadout).toEqual({melee:"sword",ranged:"bow"});
});
it("derives healing from base melee power and block only from selected support styles",()=>{
 const base={meleeDamage:20,rangedDamage:15,armor:0};
 const mastered=normalizeWeaponTraining({loadout:{melee:"sword",ranged:"bow",support:"staff",defense:"shield"},experience:{sword:25250,staff:25250,shield:25250}});
 expect(getWeaponCombatStatistics(base,mastered)).toEqual({meleeDamage:25,rangedDamage:15,armor:0,healingPower:25,blockPercent:25});
 expect(getWeaponCombatStatistics(base,normalizeWeaponTraining({loadout:{support:"staff",defense:"shield"}}))).toMatchObject({healingPower:20,blockPercent:10});
 expect(getWeaponCombatStatistics(base,undefined)).toEqual(base);
 expect(getWeaponCombatStatistics({...base,healingPower:99,blockPercent:99},undefined)).toEqual(base);
});
function snapshot():BattleSnapshot {
 return {id:"battle",round:1,activeCombatantId:"hero",turnOrder:["hero","enemy"],cells:[{q:0,r:0},{q:1,r:0}],blockedCells:[],coverCells:[],finished:false,combatants:[{id:"hero",ownerPlayerId:"player",side:"player",name:"Hero",hp:85,maxHp:100,ap:3,maxAp:5,initiative:10,position:{q:0,r:0},severelyInjured:false,injuries:[],combatStats:{meleeDamage:20,rangedDamage:15,armor:0,healingPower:25}},{id:"enemy",side:"enemy",name:"Enemy",hp:100,maxHp:100,ap:0,maxAp:5,initiative:5,position:{q:1,r:0},severelyInjured:false,injuries:[],combatStats:{meleeDamage:10,rangedDamage:0,armor:100,blockPercent:25}}]};
}
it("shows real clamped healing and disables it after use, without staff or outside the owner's turn",()=>{
 const s=snapshot();expect(getBattleHealingPreview(s,"hero")).toMatchObject({amount:15,apCost:3,available:true});
 s.combatants[0]!.healingUsedThisTurn=true;expect(getBattleHealingPreview(s,"hero").available).toBe(false);
 delete s.combatants[0]!.healingUsedThisTurn;s.combatants[0]!.ap=2;expect(getBattleHealingPreview(s,"hero").available).toBe(false);
 s.combatants[0]!.ap=3;s.activeCombatantId="enemy";expect(getBattleHealingPreview(s,"hero").available).toBe(false);
 s.activeCombatantId="hero";delete s.combatants[0]!.combatStats!.healingPower;expect(getBattleHealingPreview(s,"hero").available).toBe(false);
});
it("uses shield mitigation after armor in real attack previews",()=>{
 expect(mitigatedBattleDamage(20,100,25)).toBe(8);
 expect(mitigatedBattleDamage(1,0,25)).toBe(1);
 expect(getBattleAttackPreview(snapshot(),"hero","enemy")?.averageDamage).toBe(8);
});
