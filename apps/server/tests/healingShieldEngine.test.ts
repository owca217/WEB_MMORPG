import { expect, it } from "vitest";
import { applyBattleCommand, applyNpcBattleCommand, createBattleState, type BattleState } from "../src/battle/BattleEngine";
import { chooseAutoBattleCommand } from "../src/battle/AutoBattleAi";
function state(hp=35):BattleState {
 return createBattleState({id:"heal",seed:1,arena:{cells:[{q:0,r:0},{q:1,r:0},{q:0,r:1}],blockedCells:[],coverCells:[],playerStartCells:[{q:0,r:0}],enemyStartCells:[{q:1,r:0}]},combatants:[
  {id:"hero",ownerPlayerId:"player",side:"player",name:"Hero",hp,maxHp:100,maxAp:5,initiative:10,position:{q:0,r:0},severelyInjured:true,injuries:["bleeding"],combatStats:{meleeDamage:20,rangedDamage:15,armor:100,healingPower:25,blockPercent:25}},
  {id:"enemy",side:"enemy",name:"Enemy",hp:100,maxHp:100,maxAp:5,initiative:5,position:{q:1,r:0},severelyInjured:false,injuries:[],combatStats:{meleeDamage:20,rangedDamage:0,armor:0}}
 ]});
}
function applied(result:ReturnType<typeof applyBattleCommand>):BattleState {if(!result.ok)throw new Error(result.code);return result.state;}
it("heals only missing HP for3AP once per turn, preserves injuries and resets next turn",()=>{
 let s=state(90);const original=structuredClone(s);
 s=applied(applyBattleCommand(s,"player",{type:"healSelf",combatantId:"hero"}));
 expect(s.combatants.hero).toMatchObject({hp:100,ap:2,healingUsedThisTurn:true,severelyInjured:true,injuries:["bleeding"]});
 expect(original.combatants.hero!.hp).toBe(90);
 expect(applyBattleCommand(s,"player",{type:"healSelf",combatantId:"hero"})).toMatchObject({ok:false,code:"HEAL_ALREADY_USED"});
 s=applied(applyBattleCommand(s,"player",{type:"endTurn",combatantId:"hero"}));
 s=applied(applyNpcBattleCommand(s,{type:"endTurn",combatantId:"enemy"}));
 expect(s.combatants.hero!.healingUsedThisTurn).not.toBe(true);
 s=applied(applyBattleCommand(s,"player",{type:"healSelf",combatantId:"hero"}));expect(s.combatants.hero!.hp).toBe(100);
});
it.each(["no staff","full","AP","down","foreign","turn","finished"])("rejects invalid healing: %s",reason=>{
 const s=state();let player="player";
 if(reason==="no staff")delete s.combatants.hero!.combatStats!.healingPower;
 if(reason==="full")s.combatants.hero!.hp=100;
 if(reason==="AP")s.combatants.hero!.ap=2;
 if(reason==="down")s.combatants.hero!.hp=0;
 if(reason==="foreign")player="other";
 if(reason==="turn")s.activeCombatantId="enemy";
 if(reason==="finished")s.finished=true;
 const before=structuredClone(s),result=applyBattleCommand(s,player,{type:"healSelf",combatantId:"hero"});
 expect(result.ok).toBe(false);expect(s).toEqual(before);
});
it("counts only attacks that shield actually reduced, never end-turn bleeding",()=>{
 let s=state(100);s.activeCombatantId="enemy";s.combatants.enemy!.ap=5;
 s=applied(applyNpcBattleCommand(s,{type:"meleeAttack",combatantId:"enemy",targetId:"hero"}));
 expect(s.combatants.hero).toMatchObject({hp:92,shieldBlocks:1});
 s=applied(applyNpcBattleCommand(s,{type:"endTurn",combatantId:"enemy"}));
 s=applied(applyBattleCommand(s,"player",{type:"endTurn",combatantId:"hero"}));
 expect(s.combatants.hero).toMatchObject({hp:87,shieldBlocks:1});
 s.combatants.enemy!.combatStats!.meleeDamage=1;s.combatants.enemy!.ap=5;
 s=applied(applyNpcBattleCommand(s,{type:"meleeAttack",combatantId:"enemy",targetId:"hero"}));
 expect(s.combatants.hero).toMatchObject({hp:86,shieldBlocks:1});
});
it("Auto self-heals critically wounded actors only when healing is legal",()=>{
 const s=state();expect(chooseAutoBattleCommand(s,"player")).toEqual({type:"healSelf",combatantId:"hero"});
 s.combatants.hero!.healingUsedThisTurn=true;expect(chooseAutoBattleCommand(s,"player").type).not.toBe("healSelf");
 delete s.combatants.hero!.healingUsedThisTurn;s.combatants.hero!.hp=36;expect(chooseAutoBattleCommand(s,"player").type).not.toBe("healSelf");
 s.combatants.hero!.hp=35;s.combatants.hero!.ap=2;expect(chooseAutoBattleCommand(s,"player").type).not.toBe("healSelf");
});
it("Auto evaluates attack damage after shields when choosing the fastest kill",()=>{
 const s=state(100);s.combatants.hero!.injuries=[];
 s.combatants.enemy!.hp=15;s.combatants.enemy!.combatStats!.blockPercent=75;
 s.combatants.other={...structuredClone(s.combatants.enemy!),id:"other",hp:20,position:{q:0,r:1},combatStats:{meleeDamage:1,rangedDamage:0,armor:0}};
 expect(chooseAutoBattleCommand(s,"player")).toEqual({type:"meleeAttack",combatantId:"hero",targetId:"other"});
});
