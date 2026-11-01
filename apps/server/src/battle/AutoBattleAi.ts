import { affordableMovementHexes, effectiveBattleArmor, effectiveBattleBlock, getWeaponSkill, getWeaponSkillPreview, injuryAdjustedAttackDamage, isBattleAttackEnabled, meleeAttackApCost, mitigatedBattleDamage, movementApCost, rangedAttackApCost, rangedAttackRange, receivedBattleHealing, remainingMovementHexes, STAFF_HEAL_AP_COST, type BattleCommand, type BattleSnapshot, type HexCoord, type PlayerId } from "@web-mmorpg/shared";
import type { BattleState } from "./BattleEngine";
import type { CombatantState } from "./injuries";
import { hexDistance, hexKey, hexNeighbors } from "./hex";
import { hasLineOfSight } from "./lineOfSight";

interface AttackOption {
  command: Extract<BattleCommand, { type: "meleeAttack" | "rangedAttack" | "useWeaponSkill" }>;
  target: number;
  damage: number;
  cost: number;
  melee: boolean;
  meleeSurcharge: number;
}
interface AttackPlan { kills: number; damage: number; firstKillCost: number; spent: number; first?: BattleCommand }
interface PositionPlan extends AttackPlan { moveCost: number; command: BattleCommand }

function better(a: AttackPlan, b: AttackPlan): boolean {
  return a.kills > b.kills || a.kills === b.kills &&
    (a.damage > b.damage || a.damage === b.damage &&
      (a.firstKillCost < b.firstKillCost || a.firstKillCost === b.firstKillCost && a.spent < b.spent));
}

function battleSnapshot(state: BattleState, actor?: CombatantState): BattleSnapshot {
  return {id:state.id,round:state.round,activeCombatantId:state.activeCombatantId,turnOrder:state.turnOrder,cells:state.arena.cells,blockedCells:state.arena.blockedCells,coverCells:state.arena.coverCells,combatants:Object.values(state.combatants).map(unit=>unit.id===actor?.id ? actor : unit),finished:state.finished};
}

function attackOptions(state: BattleState, actor: CombatantState, position: HexCoord, enemies: CombatantState[], blockers: ReadonlySet<string>): AttackOption[] {
  const meleeSurcharge = meleeAttackApCost(actor) - 2;
  const snapshot = battleSnapshot(state,{...actor,position});
  return enemies.flatMap((enemy, target) => {
    const distance = hexDistance(position, enemy.position);
    const result: AttackOption[] = [];
    if (distance === 1 && isBattleAttackEnabled(actor,"meleeAttack")) result.push({
command: { type: "meleeAttack", combatantId: actor.id, targetId: enemy.id }, target,
      damage: mitigatedBattleDamage(injuryAdjustedAttackDamage(actor, enemy, actor.combatStats?.meleeDamage ?? 20), effectiveBattleArmor(enemy), effectiveBattleBlock(enemy)), cost: meleeAttackApCost(actor), melee:true, meleeSurcharge
});
    if (distance > 0 && distance <= rangedAttackRange(actor) && isBattleAttackEnabled(actor,"rangedAttack") && hasLineOfSight(position, enemy.position, blockers)) result.push({
      command: { type: "rangedAttack", combatantId: actor.id, targetId: enemy.id }, target,
      damage: mitigatedBattleDamage(injuryAdjustedAttackDamage(actor, enemy, actor.combatStats?.rangedDamage ?? 15), effectiveBattleArmor(enemy), effectiveBattleBlock(enemy)), cost: rangedAttackApCost(actor), melee:false, meleeSurcharge:0
});
    for (const skillId of actor.weaponSkills ?? []) {
      const skill = getWeaponSkill(skillId);
      if (skill?.kind !== "attack") continue;
      const preview = getWeaponSkillPreview(snapshot,actor.id,skillId,enemy.id);
      if (preview.available) result.push({command:{type:"useWeaponSkill",combatantId:actor.id,skillId,targetId:enemy.id},target,damage:preview.amount,cost:preview.apCost,melee:skill.attackMode!=="rangedAttack",meleeSurcharge:skill.attackMode!=="rangedAttack" ? meleeSurcharge : 0});
    }
    return result;
  });
}

/** Small current-turn search: max8 AP and up to5 enemies in party encounters. */
function planAttacks(options: AttackOption[], hp: number[], ap: number, meleeUsed: boolean): AttackPlan {
  const memo = new Map<string, AttackPlan>();
  const onceIds = [...new Set(options.flatMap(option => option.command.type === "useWeaponSkill" ? [option.command.skillId] : []))];
  const visit = (remaining: number[], budget: number, usedMelee: boolean, usedSkills: number): AttackPlan => {
    const key = `${budget}:${usedMelee}:${usedSkills}:${remaining.join(",")}`;
    const cached = memo.get(key); if (cached) return cached;
    let best: AttackPlan = { kills: 0, damage: 0, firstKillCost: Infinity, spent: 0 };
    for (const option of options) {
      const melee = option.melee;
      const bit = option.command.type === "useWeaponSkill" ? 1 << onceIds.indexOf(option.command.skillId) : 0;
      if (bit && (usedSkills & bit)) continue;
      const cost = option.cost - (melee && usedMelee ? option.meleeSurcharge : 0);
      if (cost > budget || remaining[option.target]! <= 0) continue;
      const damage = Math.min(remaining[option.target]!, option.damage);
      const next = [...remaining]; next[option.target] = Math.max(0, next[option.target]! - option.damage);
      const tail = visit(next, budget - cost, usedMelee || melee, usedSkills | bit);
      const killed = next[option.target] === 0;
      const candidate: AttackPlan = {
kills: tail.kills + (killed ? 1 : 0), damage: tail.damage + damage,
        firstKillCost: killed ? cost : cost + tail.firstKillCost, spent: tail.spent + cost, first: option.command
};
      if (better(candidate, best)) best = candidate;
    }
    memo.set(key, best); return best;
  };
  return visit(hp, ap, meleeUsed, 0);
}

function pathsFromActor(state: BattleState, actor: CombatantState): Array<{ position: HexCoord; path: HexCoord[] }> {
  const allowed = new Set(state.arena.cells.map(hexKey));
  const blocked = new Set(state.arena.blockedCells.map(hexKey));
  for (const unit of Object.values(state.combatants)) if (unit.id !== actor.id && unit.hp > 0) blocked.add(hexKey(unit.position));
  const visited = new Set([hexKey(actor.position)]);
  const paths = [{ position: actor.position, path: [] as HexCoord[] }];
  for (let cursor = 0; cursor < paths.length; cursor++) {
    const current = paths[cursor]!;
    for (const position of hexNeighbors(current.position)) {
      const key = hexKey(position);
      if (!allowed.has(key) || blocked.has(key) || visited.has(key)) continue;
      visited.add(key); paths.push({ position, path: [...current.path, position] });
    }
  }
  return paths;
}

/** Chooses an action only; the BattleEngine remains authoritative when it is applied. */
export function chooseAutoBattleCommand(state: BattleState, playerId: PlayerId): BattleCommand {
  const actor = state.combatants[state.activeCombatantId];
  if (!actor || actor.ownerPlayerId !== playerId || actor.hp <= 0 || state.finished) throw new Error("AUTO_ACTOR_NOT_READY");
  const end: BattleCommand = { type: "endTurn", combatantId: actor.id };
  if (actor.ap <= 0) return end;
  const enemies = Object.values(state.combatants).filter(unit => unit.side !== actor.side && unit.hp > 0)
    .sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id));
  if (!enemies.length) return end;
  const snapshot = battleSnapshot(state);
  const allies = Object.values(state.combatants).filter(unit => unit.side === actor.side && unit.hp > 0 && unit.hp <= unit.maxHp * 0.35 && unit.hp < unit.maxHp).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp || a.id.localeCompare(b.id));
  for (const target of allies) {
    const healing = (actor.weaponSkills ?? []).flatMap(skillId => {
      const skill = getWeaponSkill(skillId);
      if (skill?.kind !== "heal" || skill.target === "self" && target.id !== actor.id) return [];
      const preview = getWeaponSkillPreview(snapshot,actor.id,skillId,target.id);
      return preview.available ? [{skillId,preview}] : [];
    }).sort((a,b)=>b.preview.amount-a.preview.amount || a.preview.apCost-b.preview.apCost)[0];
    if (healing) return {type:"useWeaponSkill",combatantId:actor.id,skillId:healing.skillId,targetId:target.id};
  }
  const healingPower = actor.combatStats?.healingPower ?? 0;
  if (Number.isFinite(healingPower) && healingPower >= 1 && !actor.healingUsedThisTurn && actor.ap >= STAFF_HEAL_AP_COST) {
    const obstacles = new Set(state.arena.blockedCells.map(hexKey));
    const target = Object.values(state.combatants).filter(unit => unit.side === actor.side && unit.hp > 0 && unit.hp <= unit.maxHp * 0.35 && unit.hp < unit.maxHp && receivedBattleHealing(unit, healingPower) > 0 &&
      (unit.id === actor.id || hexDistance(actor.position, unit.position) <= 6 && hasLineOfSight(actor.position, unit.position, obstacles)))
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id))[0];
    if (target) return target.id === actor.id ? { type: "healSelf", combatantId: actor.id } : { type: "healAlly", combatantId: actor.id, targetId: target.id };
  }
  const blockers = new Set(state.arena.blockedCells.map(hexKey));
  const budget = Math.min(8, actor.ap);
  let best: PositionPlan | undefined;
  let pursuit: { cost: number; path: HexCoord[] } | undefined;
  for (const { position, path } of pathsFromActor(state, actor)) {
    const moveCost = movementApCost(actor, path.length);
    const options = attackOptions(state, actor, position, enemies, blockers);
    // Pursuit is useful when this turn cannot deal damage. Prefer a cheap complete kill,
    // rather than spending spare AP wandering between equally distant opponents.
    for (const option of options) {
      const attacks = Math.ceil(enemies[option.target]!.hp / option.damage);
      const cost = moveCost + option.cost + Math.max(0, attacks - 1) * (option.command.type === "meleeAttack" ? 2 : option.cost);
      if (!pursuit || cost < pursuit.cost || cost === pursuit.cost && path.length < pursuit.path.length) pursuit = { cost, path };
    }
    if (moveCost > budget || path.length > remainingMovementHexes(actor)) continue;
    const attacks = planAttacks(options, enemies.map(enemy => enemy.hp), budget - moveCost, Boolean(actor.meleeAttackUsedThisTurn));
    if (!attacks.first) continue;
    const candidate: PositionPlan = {
...attacks, firstKillCost: attacks.firstKillCost + moveCost, spent: attacks.spent + moveCost, moveCost,
      command: path.length ? { type: "move", combatantId: actor.id, target: { ...position } } : attacks.first
};
    if (!best || better(candidate, best) || candidate.kills === best.kills && candidate.damage === best.damage && candidate.firstKillCost === best.firstKillCost && candidate.spent === best.spent && moveCost < best.moveCost) best = candidate;
  }
  if (best) return best.command;
  if (actor.hp <= actor.maxHp * 0.5) for (const skillId of actor.weaponSkills ?? []) {
    if (getWeaponSkill(skillId)?.kind === "guard" && getWeaponSkillPreview(snapshot,actor.id,skillId).available) return {type:"useWeaponSkill",combatantId:actor.id,skillId};
  }
  const steps = Math.min(pursuit?.path.length ?? 0, affordableMovementHexes(actor));
  return steps > 0 ? { type: "move", combatantId: actor.id, target: { ...pursuit!.path[steps - 1]! } } : end;
}
