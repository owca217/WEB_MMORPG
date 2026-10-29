import { mitigatedBattleDamage, movementApCost, rangedAttackApCost, STAFF_HEAL_AP_COST, type BattleCommand, type HexCoord, type PlayerId } from "@web-mmorpg/shared";
import type { BattleState } from "./BattleEngine";
import type { CombatantState } from "./injuries";
import { hexDistance, hexKey, hexNeighbors } from "./hex";
import { hasLineOfSight } from "./lineOfSight";

interface AttackOption {
  command: Extract<BattleCommand,{type:"meleeAttack"|"rangedAttack"}>;
  target: number;
  damage: number;
  cost: number;
}
interface AttackPlan { kills:number; damage:number; firstKillCost:number; spent:number; first?:BattleCommand }
interface PositionPlan extends AttackPlan { moveCost:number; command:BattleCommand }

function better(a:AttackPlan,b:AttackPlan):boolean {
  return a.kills>b.kills || a.kills===b.kills &&
    (a.damage>b.damage || a.damage===b.damage &&
      (a.firstKillCost<b.firstKillCost || a.firstKillCost===b.firstKillCost && a.spent<b.spent));
}

function attackOptions(actor:CombatantState,position:HexCoord,enemies:CombatantState[],blockers:ReadonlySet<string>):AttackOption[] {
  return enemies.flatMap((enemy,target)=>{
    const distance=hexDistance(position,enemy.position);
    const result:AttackOption[]=[];
    if(distance===1)result.push({command:{type:"meleeAttack",combatantId:actor.id,targetId:enemy.id},target,
      damage:mitigatedBattleDamage(actor.combatStats?.meleeDamage??20,enemy.combatStats?.armor??0,enemy.combatStats?.blockPercent??0),cost:2});
    if(distance>0 && distance<=6 && hasLineOfSight(position,enemy.position,blockers))result.push({
      command:{type:"rangedAttack",combatantId:actor.id,targetId:enemy.id},target,
      damage:mitigatedBattleDamage(actor.combatStats?.rangedDamage??15,enemy.combatStats?.armor??0,enemy.combatStats?.blockPercent??0),cost:rangedAttackApCost(actor)});
    return result;
  });
}

/** Small current-turn search: max8 AP, max3 enemies in authored encounters. */
function planAttacks(options:AttackOption[],hp:number[],ap:number):AttackPlan {
  const memo=new Map<string,AttackPlan>();
  const visit=(remaining:number[],budget:number):AttackPlan=>{
    const key=`${budget}:${remaining.join(",")}`;
    const cached=memo.get(key);if(cached)return cached;
    let best:AttackPlan={kills:0,damage:0,firstKillCost:Infinity,spent:0};
    for(const option of options) {
      if(option.cost>budget || remaining[option.target]!<=0)continue;
      const damage=Math.min(remaining[option.target]!,option.damage);
      const next=[...remaining];next[option.target]=Math.max(0,next[option.target]!-option.damage);
      const tail=visit(next,budget-option.cost);
      const killed=next[option.target]===0;
      const candidate:AttackPlan={kills:tail.kills+(killed?1:0),damage:tail.damage+damage,
        firstKillCost:killed?option.cost:option.cost+tail.firstKillCost,spent:tail.spent+option.cost,first:option.command};
      if(better(candidate,best))best=candidate;
    }
    memo.set(key,best);return best;
  };
  return visit(hp,ap);
}

function pathsFromActor(state:BattleState,actor:CombatantState):Array<{position:HexCoord;path:HexCoord[]}> {
  const allowed=new Set(state.arena.cells.map(hexKey));
  const blocked=new Set(state.arena.blockedCells.map(hexKey));
  for(const unit of Object.values(state.combatants))if(unit.id!==actor.id && unit.hp>0)blocked.add(hexKey(unit.position));
  const visited=new Set([hexKey(actor.position)]);
  const paths=[{position:actor.position,path:[] as HexCoord[]}];
  for(let cursor=0;cursor<paths.length;cursor++) {
    const current=paths[cursor]!;
    for(const position of hexNeighbors(current.position)) {
      const key=hexKey(position);
      if(!allowed.has(key) || blocked.has(key) || visited.has(key))continue;
      visited.add(key);paths.push({position,path:[...current.path,position]});
    }
  }
  return paths;
}

/** Chooses an action only; the BattleEngine remains authoritative when it is applied. */
export function chooseAutoBattleCommand(state:BattleState,playerId:PlayerId):BattleCommand {
  const actor=state.combatants[state.activeCombatantId];
  if(!actor || actor.ownerPlayerId!==playerId || actor.hp<=0 || state.finished)throw new Error("AUTO_ACTOR_NOT_READY");
  const end:BattleCommand={type:"endTurn",combatantId:actor.id};
  if(actor.ap<=0)return end;
  const enemies=Object.values(state.combatants).filter(unit=>unit.side!==actor.side && unit.hp>0)
    .sort((a,b)=>a.hp-b.hp || a.id.localeCompare(b.id));
  if(!enemies.length)return end;
  const healingPower=actor.combatStats?.healingPower??0;
  if(actor.hp<=actor.maxHp*0.35 && actor.hp<actor.maxHp && Number.isFinite(healingPower) && healingPower>=1 && !actor.healingUsedThisTurn && actor.ap>=STAFF_HEAL_AP_COST) {
    return {type:"healSelf",combatantId:actor.id};
  }
  const blockers=new Set(state.arena.blockedCells.map(hexKey));
  const budget=Math.min(8,actor.ap);
  let best:PositionPlan|undefined;
  let pursuit:{cost:number;path:HexCoord[]}|undefined;
  for(const {position,path} of pathsFromActor(state,actor)) {
    const moveCost=movementApCost(actor,path.length);
    const options=attackOptions(actor,position,enemies,blockers);
    // Pursuit is useful when this turn cannot deal damage. Prefer a cheap complete kill,
    // rather than spending spare AP wandering between equally distant opponents.
    for(const option of options) {
      const cost=moveCost+Math.ceil(enemies[option.target]!.hp/option.damage)*option.cost;
      if(!pursuit || cost<pursuit.cost || cost===pursuit.cost && path.length<pursuit.path.length)pursuit={cost,path};
    }
    if(moveCost>budget)continue;
    const attacks=planAttacks(options,enemies.map(enemy=>enemy.hp),budget-moveCost);
    if(!attacks.first)continue;
    const candidate:PositionPlan={...attacks,firstKillCost:attacks.firstKillCost+moveCost,spent:attacks.spent+moveCost,moveCost,
      command:path.length?{type:"move",combatantId:actor.id,target:{...position}}:attacks.first};
    if(!best || better(candidate,best) || candidate.kills===best.kills && candidate.damage===best.damage && candidate.firstKillCost===best.firstKillCost && candidate.spent===best.spent && moveCost<best.moveCost)best=candidate;
  }
  if(best)return best.command;
  const steps=Math.min(pursuit?.path.length??0,Math.floor(actor.ap/movementApCost(actor,1)));
  return steps>0 ? {type:"move",combatantId:actor.id,target:{...pursuit!.path[steps-1]!}} : end;
}
