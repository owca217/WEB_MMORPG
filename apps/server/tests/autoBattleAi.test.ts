import { getCharacterStatistics, type CharacterSnapshot, type HexCoord } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { chooseAutoBattleCommand } from "../src/battle/AutoBattleAi";
import { applyBattleCommand, createBattleState, type BattleState } from "../src/battle/BattleEngine";
import { BattleService } from "../src/battle/BattleService";

function state(enemies: Array<{id:string;hp:number;position:HexCoord}>, options: {ap?:number;melee?:number;ranged?:number;blocked?:HexCoord[];injuries?:"legTrauma"[]|"brokenArm"[]} = {}): BattleState {
  const cells:HexCoord[]=[];
  for(let q=0;q<=6;q++)for(let r=0;r<=2;r++)cells.push({q,r});
  const result=createBattleState({id:"auto-test",seed:1,arena:{cells,blockedCells:options.blocked??[],coverCells:[],playerStartCells:[{q:0,r:0}],enemyStartCells:enemies.map(e=>e.position)},combatants:[{
    id:"hero",ownerPlayerId:"player",side:"player",name:"Hero",hp:100,maxHp:100,maxAp:options.ap??5,initiative:10,position:{q:0,r:0},severelyInjured:false,injuries:options.injuries??[],combatStats:{meleeDamage:options.melee??20,rangedDamage:options.ranged??15,armor:0}
  },...enemies.map(enemy=>({...enemy,side:"enemy" as const,name:enemy.id,maxHp:enemy.hp,maxAp:4,initiative:5,severelyInjured:false,injuries:[]}))]});
  return result;
}

describe("automatic player battle tactics",()=>{
  it("shoots an equipped bow at adjacent enemies and never substitutes a disabled melee attack",()=>{
    const initial=state([{id:"wolf",hp:10,position:{q:1,r:0}}]);
    initial.combatants.hero!.combatStats={meleeDamage:999,rangedDamage:15,armor:0,meleeEnabled:false,rangedEnabled:true};
    const command=chooseAutoBattleCommand(initial,"player");
    expect(command).toEqual({type:"rangedAttack",combatantId:"hero",targetId:"wolf"});
    expect(applyBattleCommand(initial,"player",command).ok).toBe(true);
  });
  it("finishes a wounded adjacent enemy before spreading damage and avoids paying ranged AP for overkill",()=>{
    const initial=state([{id:"strong",hp:100,position:{q:0,r:1}},{id:"weak",hp:15,position:{q:1,r:0}}]);
    const unchanged=structuredClone(initial);
    expect(chooseAutoBattleCommand(initial,"player")).toEqual({type:"meleeAttack",combatantId:"hero",targetId:"weak"});
    expect(initial).toEqual(unchanged);
  });
  it("moves to enable two melee attacks rather than taking a slower ranged shot",()=>{
    const initial=state([{id:"wolf",hp:40,position:{q:2,r:0}}],{melee:30});
    const move=chooseAutoBattleCommand(initial,"player");
    expect(move).toEqual({type:"move",combatantId:"hero",target:{q:1,r:0}});
    const moved=applyBattleCommand(initial,"player",move);
    if(!moved.ok)throw new Error(moved.code);
    const attack=chooseAutoBattleCommand(moved.state,"player");
    expect(attack).toEqual({type:"meleeAttack",combatantId:"hero",targetId:"wolf"});
    const hit=applyBattleCommand(moved.state,"player",attack);
    if(!hit.ok)throw new Error(hit.code);
    expect(chooseAutoBattleCommand(hit.state,"player")).toEqual(attack);
  });
  it("uses damage after armor to secure the earliest kill instead of touching a lower-HP armored enemy first",()=>{
    const initial=state([{id:"armored",hp:15,position:{q:0,r:1}},{id:"unarmored",hp:20,position:{q:1,r:0}}]);
    initial.combatants.armored!.combatStats={meleeDamage:10,rangedDamage:0,armor:200};
    expect(chooseAutoBattleCommand(initial,"player")).toEqual({type:"meleeAttack",combatantId:"hero",targetId:"unarmored"});
  });
  it("respects injury costs and takes a legal path around blocked sight instead of firing through it",()=>{
    const initial=state([{id:"wolf",hp:100,position:{q:3,r:0}}],{ap:3,blocked:[{q:1,r:0}],injuries:["brokenArm"]});
    const command=chooseAutoBattleCommand(initial,"player");
    expect(command.type).toBe("move");
    expect(applyBattleCommand(initial,"player",command).ok).toBe(true);
    if(command.type==="move")expect(command.target).not.toEqual({q:1,r:0});
    initial.combatants.hero!.injuries=["legTrauma"];
    initial.combatants.hero!.ap=1;
    expect(chooseAutoBattleCommand(initial,"player")).toEqual({type:"endTurn",combatantId:"hero"});
  });
  it("ends an unreachable turn without generating an illegal action",()=>{
    const initial=state([{id:"wolf",hp:100,position:{q:2,r:0}}],{blocked:[{q:1,r:0}]});
    initial.arena.cells=[{q:0,r:0},{q:1,r:0},{q:2,r:0}];
    expect(chooseAutoBattleCommand(initial,"player")).toEqual({type:"endTurn",combatantId:"hero"});
  });
});

function character(level:number):CharacterSnapshot {
  const statistics=getCharacterStatistics(level);
  return {playerId:"player",nickname:"Hero",level,statistics,hp:statistics.maxHp,maxHp:statistics.maxHp,maxAp:statistics.maxAp,initiative:statistics.initiative,severelyInjured:false,injuries:[]};
}
describe("BattleService automatic mode",()=>{
  it("requires a battle, protects auto from manual commands and returns control when disabled",async()=>{
    const service=new BattleService();
    expect(()=>service.setAuto("player",true)).toThrow("BATTLE_NOT_FOUND");
    service.startBattle(character(1),"wolf-pack-01");
    expect(service.setAuto("player",true).autoBattle).toBe(true);
    expect(service.isAuto("player")).toBe(true);
    expect(service.applyCommand("player",{type:"endTurn",combatantId:"hero:player"}).result).toMatchObject({ok:false,code:"AUTO_BATTLE_ACTIVE"});
    await expect(service.useConsumable("player","hero:player",async()=>({items:[]}))).rejects.toThrow("AUTO_BATTLE_ACTIVE");
    expect(service.setAuto("player",false).autoBattle).not.toBe(true);
    expect(service.isAuto("player")).toBe(false);
    expect(service.applyCommand("player",{type:"endTurn",combatantId:"hero:player"}).result.ok).toBe(true);
  });
  it.each([1,10,40])("plays a level %s encounter to a legal bounded result without free actions",level=>{
    const service=new BattleService();service.startBattle(character(level),"wolf-pack-01");service.setAuto("player",true);
    let result;
    for(let guard=0;guard<1000;guard++){
      result=service.applyAutoCommand("player");
      expect(result.result.ok).toBe(true);
      if(result.finished)break;
    }
    expect(result?.finished).toBe(true);
    expect(result?.victory).toBe(true);
    expect(service.isAuto("player")).toBe(false);
    service.removeBattleForPlayer("player");expect(service.isAuto("player")).toBe(false);
  });
});
