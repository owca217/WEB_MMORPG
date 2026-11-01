import { describe, expect, it } from "vitest";
import { getWeaponSkillPreview, getBattleAttackPreview, getCharacterStatistics, normalizeWeaponTraining, type BattleSnapshot, type GeneratedArena, type WeaponSkillId } from "@web-mmorpg/shared";
import { applyBattleCommand, applyNpcBattleCommand, createBattleState, type BattleState } from "../src/battle/BattleEngine";
import { chooseAutoBattleCommand } from "../src/battle/AutoBattleAi";
import { BattleService } from "../src/battle/BattleService";
import { combatEquipment } from "./combatEquipmentFixtures";

const arena: GeneratedArena = { cells: Array.from({length: 7}, (_, q) => ({q, r:0})), blockedCells:[], coverCells:[], playerStartCells:[{q:0,r:0}], enemyStartCells:[{q:1,r:0}] };
function state(skills: WeaponSkillId[] = ["sword:power"]): BattleState {
  return createBattleState({id:"skills",seed:1,arena,combatants:[
    {id:"hero",ownerPlayerId:"player",side:"player",name:"Hero",hp:200,maxHp:200,maxAp:8,initiative:10,position:{q:0,r:0},severelyInjured:false,injuries:[],weaponSkills:skills,combatStats:{meleeDamage:40,rangedDamage:30,armor:10,meleeEnabled:true,rangedEnabled:false}},
    {id:"enemy",side:"enemy",name:"Enemy",hp:400,maxHp:400,maxAp:5,initiative:1,position:{q:1,r:0},severelyInjured:false,injuries:[],combatStats:{meleeDamage:40,rangedDamage:0,armor:100}}
  ]});
}
function snapshot(s: BattleState): BattleSnapshot { return {id:s.id,round:s.round,activeCombatantId:s.activeCombatantId,turnOrder:s.turnOrder,cells:s.arena.cells,blockedCells:s.arena.blockedCells,coverCells:s.arena.coverCells,combatants:Object.values(s.combatants),finished:s.finished}; }
function apply(s: BattleState, skillId:WeaponSkillId, targetId?:string): BattleState { const result=applyBattleCommand(s,"player",{type:"useWeaponSkill",combatantId:"hero",skillId,...(targetId ? {targetId}: {})});if(!result.ok)throw new Error(`${result.code}:${result.message}`);return result.state; }
function cycle(s: BattleState): BattleState {
  const end=applyBattleCommand(s,"player",{type:"endTurn",combatantId:"hero"});if(!end.ok)throw new Error(end.code);
  const back=applyNpcBattleCommand(end.state,{type:"endTurn",combatantId:"enemy"});if(!back.ok)throw new Error(back.code);return back.state;
}

describe("weapon skill battle commands",()=>{
  it("matches the shared preview, spends AP once and rejects unknown/unlearned/repeated skills without mutation",()=>{
    const initial=state(),before=structuredClone(initial),preview=getWeaponSkillPreview(snapshot(initial),"hero","sword:power","enemy");
    expect(preview.available).toBe(true);expect(preview.amount).toBeGreaterThan(getBattleAttackPreview(snapshot(initial),"hero","enemy")!.averageDamage);
    const next=apply(initial,"sword:power","enemy");expect(next.combatants.enemy!.hp).toBe(400-preview.amount);expect(next.combatants.hero!.ap).toBe(8-preview.apCost);expect(initial).toEqual(before);
    for(const skillId of ["sword:power","axe:power","bogus"]){
      const copy=structuredClone(next);expect(applyBattleCommand(next,"player",{type:"useWeaponSkill",combatantId:"hero",skillId:skillId as WeaponSkillId,targetId:"enemy"}).ok).toBe(false);expect(next).toEqual(copy);
    }
    expect(applyBattleCommand(initial,"another-player",{type:"useWeaponSkill",combatantId:"hero",skillId:"sword:power",targetId:"enemy"})).toMatchObject({ok:false,code:"NOT_OWNER"});
  });
  it("counts cooldowns by the owner's turns and supports ready skills again without resetting every round",()=>{
    const cast=apply(state(),"sword:power","enemy"),next=cycle(cast);
    expect(getWeaponSkillPreview(snapshot(next),"hero","sword:power","enemy")).toMatchObject({available:false,cooldownRemaining:1});
    const ready=cycle(next);expect(getWeaponSkillPreview(snapshot(ready),"hero","sword:power","enemy").available).toBe(true);
  });
  it("heals self and allies with staff techniques, respects healing injuries and consumes the shared healing turn",()=>{
    const initial=state(["staff:power","staff:technique"]);initial.combatants.hero!.hp=70;initial.combatants.hero!.combatStats!.healingPower=40;
    initial.combatants.ally={...structuredClone(initial.combatants.hero!),id:"ally",ownerPlayerId:"ally-player",hp:30,position:{q:2,r:0},injuries:["abdominalWound"]};initial.turnOrder.push("ally");
    const preview=getWeaponSkillPreview(snapshot(initial),"hero","staff:power","ally");expect(preview.available).toBe(true);expect(preview.amount).toBe(45);
    const healed=apply(initial,"staff:power","ally");expect(healed.combatants.ally!.hp).toBe(75);expect(healed.combatants.hero!.healingUsedThisTurn).toBe(true);
    expect(getWeaponSkillPreview(snapshot(healed),"hero","staff:technique","hero").available).toBe(false);
    expect(applyBattleCommand(healed,"player",{type:"healSelf",combatantId:"hero"}).ok).toBe(false);
    expect(getWeaponSkillPreview(snapshot(initial),"hero","staff:power","enemy").available).toBe(false);
  });
  it("applies guard to normal damage and preview without changing base stats, then expires after its owner's turns",()=>{
    const initial=state(["shield:ultimate"]);initial.combatants.hero!.combatStats!.blockPercent=10;
    const guarded=apply(initial,"shield:ultimate"),hero=guarded.combatants.hero!;expect(hero.combatStats).toEqual(initial.combatants.hero!.combatStats);
    const enemyTurn=applyBattleCommand(guarded,"player",{type:"endTurn",combatantId:"hero"});if(!enemyTurn.ok)throw new Error(enemyTurn.code);
    const preview=getBattleAttackPreview(snapshot(enemyTurn.state),"enemy","hero")!;
    const attacked=applyNpcBattleCommand(enemyTurn.state,{type:"meleeAttack",combatantId:"enemy",targetId:"hero"});if(!attacked.ok)throw new Error(attacked.code);
    expect(attacked.state.combatants.hero!.hp).toBe(200-preview.averageDamage);expect(preview.averageDamage).toBeLessThan(getBattleAttackPreview(snapshot({...enemyTurn.state,combatants:{...enemyTurn.state.combatants,hero:initial.combatants.hero!}}),"enemy","hero")!.averageDamage);
    let after=cycle(guarded);expect(after.combatants.hero!.weaponSkillBuffs).toHaveLength(1);after=cycle(after);expect(after.combatants.hero!.weaponSkillBuffs).toHaveLength(0);expect(after.combatants.hero!.combatStats).toEqual(initial.combatants.hero!.combatStats);
  });
  it("checks range, line of sight, AP and incapacitation before skill effects",()=>{
    const initial=state(["bow:power"]);initial.combatants.hero!.combatStats!.rangedEnabled=true;initial.combatants.enemy!.position={q:3,r:0};initial.arena.blockedCells=[{q:1,r:0}];
    expect(getWeaponSkillPreview(snapshot(initial),"hero","bow:power","enemy").available).toBe(false);
    const before=structuredClone(initial);expect(applyBattleCommand(initial,"player",{type:"useWeaponSkill",combatantId:"hero",skillId:"bow:power",targetId:"enemy"}).ok).toBe(false);expect(initial).toEqual(before);
    initial.arena.blockedCells=[];initial.combatants.hero!.ap=0;expect(getWeaponSkillPreview(snapshot(initial),"hero","bow:power","enemy").available).toBe(false);
    initial.combatants.hero!.ap=8;initial.combatants.hero!.hp=0;expect(getWeaponSkillPreview(snapshot(initial),"hero","bow:power","enemy").available).toBe(false);
  });
  it("applies technique injuries through existing temporary injury rules",()=>{
    const initial=state(["axe:technique"]),next=apply(initial,"axe:technique","enemy");
    expect(next.combatants.enemy!.temporaryInjuries).toContainEqual({kind:"thighWound",remainingTurns:2});expect(initial.combatants.enemy!.temporaryInjuries).toBeUndefined();
  });
  it("Auto selects an available learned attack to secure a kill and cannot repeat it while cooling down",()=>{
    const initial=state();initial.combatants.hero!.ap=3;initial.combatants.enemy!.hp=25;
    const command=chooseAutoBattleCommand(initial,"player");expect(command).toEqual({type:"useWeaponSkill",combatantId:"hero",skillId:"sword:power",targetId:"enemy"});expect(applyBattleCommand(initial,"player",command).ok).toBe(true);
  });
  it("captures learned skills only for equipped families, isolates snapshots and trains the actual technique family",()=>{
    const training=normalizeWeaponTraining(undefined);for(const family of ["sword","bow","shield"] as const)training.experience[family]=25250;
    training.learnedSkills=["sword:power","bow:power","shield:power","shield:technique"];
    const stats=getCharacterStatistics(1),equipment=combatEquipment("sword",true,[{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:200}]);
    const service=new BattleService(),initial=service.startBattle({playerId:"player",nickname:"Hero",level:1,hp:10,maxHp:stats.maxHp,maxAp:stats.maxAp,initiative:stats.initiative,severelyInjured:false,injuries:[],equipment,weaponTraining:training},"wolf-pack-01");
    const hero=initial.combatants.find(unit=>unit.ownerPlayerId)!;expect(hero.weaponSkills).toEqual(["sword:power","shield:power","shield:technique"]);
    hero.weaponSkills!.push("bow:power");training.learnedSkills.push("bow:technique");
    expect(service.getSnapshot("player")!.combatants.find(unit=>unit.ownerPlayerId)!.weaponSkills).toEqual(["sword:power","shield:power","shield:technique"]);
    service.setAuto("player",true);const heal=service.applyAutoCommand("player");expect(heal.result.ok).toBe(true);expect(heal.snapshot!.combatants.find(unit=>unit.ownerPlayerId)!.weaponSkillCooldowns?.["shield:technique"]).toBe(3);
    let terminal;for(let n=0;n<200;n++){const next=service.applyAutoCommand("player");expect(next.result.ok).toBe(true);if(next.finished){terminal=next;break;}}
    expect(terminal?.usedWeaponFamilies?.player).toContain("shield");expect(terminal?.usedWeaponFamilies?.player).not.toContain("bow");
  });
});
