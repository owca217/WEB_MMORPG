import { allocateWeaponExperience, getCharacterStatistics, learnWeaponSkill, mitigatedBattleDamage, normalizeWeaponTraining, type CharacterSnapshot, type WeaponFamily, type WeaponSkillId } from "@web-mmorpg/shared";
import { expect, it } from "vitest";
import { BattleService } from "../src/battle/BattleService";
import type { BattleState } from "../src/battle/BattleEngine";
import { combatEquipment } from "./combatEquipmentFixtures";

function setup(family:WeaponFamily="wand",shieldChannel="MAGIC_DAMAGE",skillId?:WeaponSkillId) {
  const equipment=combatEquipment(family,true,[{statCode:family==="wand"?"MAGIC_DAMAGE":"PHYSICAL_DAMAGE",modifierType:"flat",value:12}]);
  if(family==="staff")equipment.mainHand!.equipment!.modifiers.push({statCode:"SPELL_POWER",modifierType:"flat",value:20});
  equipment.offHand!.category="weapon";
  equipment.offHand!.equipment!.modifiers=[{statCode:shieldChannel,modifierType:"flat",value:4}];
  const stats=getCharacterStatistics(1);
  const input:CharacterSnapshot={playerId:"hero",nickname:"Hero",level:1,hp:stats.maxHp,maxHp:stats.maxHp,maxAp:5,initiative:10,severelyInjured:false,injuries:[],equipment,weaponTraining:normalizeWeaponTraining({experience:{wand:25250}})};
  if(skillId)input.weaponTraining=learnWeaponSkill(normalizeWeaponTraining({experience:{[family]:25250}}),skillId);
  const service=new BattleService();service.startBattle(input,"wolf-pack-01");
  const state=(service as unknown as {battlesByPlayer:Map<string,{state:BattleState}>}).battlesByPlayer.get("hero")!.state;
  const actor=state.combatants["hero:hero"]!,enemy=Object.values(state.combatants).find(unit=>unit.side==="enemy")!;
  state.arena.blockedCells=[];state.arena.coverCells=[];actor.position={q:-3,r:0};enemy.position={q:3,r:0};
  return {service,state,actor,enemy,input};
}

it("uses existing ranged range, LOS, 3 AP and armor/block mitigation for a wand",()=>{
  const {service,state,actor,enemy}=setup();
  expect(actor.combatStats).toMatchObject({rangedDamage:20,meleeDamage:0,meleeEnabled:false,rangedEnabled:true});
  expect(actor.combatStats).not.toHaveProperty("healingPower");
  expect(service.applyCommand("hero",{type:"meleeAttack",combatantId:actor.id,targetId:enemy.id}).result).toMatchObject({ok:false,code:"WEAPON_ATTACK_UNAVAILABLE"});
  expect(service.applyCommand("hero",{type:"healSelf",combatantId:actor.id}).result.ok).toBe(false);
  const attack={type:"rangedAttack" as const,combatantId:actor.id,targetId:enemy.id};
  enemy.position={q:4,r:0};expect(service.applyCommand("hero",attack).result).toMatchObject({ok:false,code:"OUT_OF_RANGE"});
  enemy.position={q:3,r:0};state.arena.blockedCells=[{q:0,r:0}];
  expect(service.applyCommand("hero",attack).result).toMatchObject({ok:false,code:"NO_LINE_OF_SIGHT"});
  state.arena.blockedCells=[];actor.ap=2;
  expect(service.applyCommand("hero",attack).result).toMatchObject({ok:false,code:"INSUFFICIENT_AP"});
  actor.ap=5;enemy.combatStats={...enemy.combatStats!,armor:10,blockPercent:20};enemy.hp=enemy.maxHp=1000;
  const applied=service.applyCommand("hero",attack);expect(applied.result.ok).toBe(true);
  expect(applied.snapshot?.combatants.find(unit=>unit.id===actor.id)?.ap).toBe(2);
  expect(applied.snapshot?.combatants.find(unit=>unit.id===enemy.id)?.hp).toBe(1000-mitigatedBattleDamage(20,10,20));
});

it.each([false,true])("records matching offensive shield use for manual/Auto attacks (Auto=%s) within one half-XP budget",auto=>{
  const {service,enemy,input}=setup();enemy.hp=1;
  // Capture the equipment at battle start, even if the caller later removes it.
  input.equipment!.offHand=null;
  if(auto)service.setAuto("hero",true);
  const result=auto?service.applyAutoCommand("hero"):service.applyCommand("hero",{type:"rangedAttack",combatantId:"hero:hero",targetId:enemy.id});
  expect(result.result.ok).toBe(true);expect(result.finished).toBe(true);
  expect(result.usedWeaponFamilies).toEqual({hero:["wand","shield"]});
  const awards=allocateWeaponExperience(result.experienceReward!,result.usedWeaponFamilies!.hero!);
  expect(awards).toEqual({wand:10,shield:10});
});

it("does not record shield offense when the equipped shield has only the other damage channel",()=>{
  const {service,enemy}=setup("wand","PHYSICAL_DAMAGE");enemy.hp=1;
  const result=service.applyCommand("hero",{type:"rangedAttack",combatantId:"hero:hero",targetId:enemy.id});
  expect(result.usedWeaponFamilies).toEqual({hero:["wand"]});
});

it("records offensive shield use for a physical main-hand attack",()=>{
  const {service,actor,enemy}=setup("sword","PHYSICAL_DAMAGE");actor.position={q:0,r:0};enemy.position={q:1,r:0};enemy.hp=1;
  const result=service.applyCommand("hero",{type:"meleeAttack",combatantId:actor.id,targetId:enemy.id});
  expect(result.usedWeaponFamilies).toEqual({hero:["sword","shield"]});
});

it.each([["sword","PHYSICAL_DAMAGE"],["wand","MAGIC_DAMAGE"]] as const)("shares the half-XP budget with an offensive shield used by a learned %s attack",(family,channel)=>{
  const skillId:WeaponSkillId=`${family}:power`;
  const {service,actor,enemy}=setup(family,channel,skillId);
  actor.position={q:0,r:0};enemy.position={q:1,r:0};enemy.hp=1;
  const result=service.applyCommand("hero",{type:"useWeaponSkill",combatantId:actor.id,targetId:enemy.id,skillId});
  expect(result.result.ok).toBe(true);expect(result.finished).toBe(true);
  expect(result.usedWeaponFamilies).toEqual({hero:[family,"shield"]});
  expect(allocateWeaponExperience(result.experienceReward!,result.usedWeaponFamilies!.hero!)).toEqual({[family]:10,shield:10});
});

it("keeps staff healing and two-handed attacks free of offensive shield training",()=>{
  const {service,actor,enemy}=setup("staff","PHYSICAL_DAMAGE");actor.hp=50;actor.position={q:0,r:0};enemy.position={q:1,r:0};enemy.hp=1;
  const healed=service.applyCommand("hero",{type:"healSelf",combatantId:actor.id});
  expect(healed.result.ok).toBe(true);expect(healed.snapshot?.combatants.find(unit=>unit.id===actor.id)?.hp).toBe(70);
  const result=service.applyCommand("hero",{type:"meleeAttack",combatantId:actor.id,targetId:enemy.id});
  expect(result.usedWeaponFamilies).toEqual({hero:["staff"]});
});

it("never records a rejected offensive attack as a weapon or shield use",()=>{
  const {service,actor,enemy,state}=setup();enemy.position={q:4,r:0};
  expect(service.applyCommand("hero",{type:"rangedAttack",combatantId:actor.id,targetId:enemy.id}).result.ok).toBe(false);
  // Finish with an NPC attack so no accepted hero attack or shield block can add use.
  actor.hp=1;delete actor.combatStats!.blockPercent;enemy.position={q:-2,r:0};state.arena.blockedCells=[];
  const result=service.applyCommand("hero",{type:"endTurn",combatantId:actor.id});
  expect(result.finished).toBe(true);expect(result.usedWeaponFamilies).toEqual({hero:[]});
});
