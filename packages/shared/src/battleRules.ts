import type { BattleSnapshot, CombatantSnapshot, HexCoord } from "./battle";
import { hasLineOfSight, hexDistance, hexKey, hexNeighbors } from "./battleTopology";
import { STAFF_HEAL_AP_COST } from "./weapons";
import { hasInjury } from "./injuries";

export interface BattleAttackPreview {
  targetId: string;
  type: "meleeAttack" | "rangedAttack";
  apCost: number;
  hitChance: number;
  averageDamage: number;
  available: boolean;
  reason?: string;
}

type InjuryActor = Pick<CombatantSnapshot, "injuries"> & Partial<Pick<CombatantSnapshot, "temporaryInjuries" | "attackedThisTurn" | "backInjuryMovementUsedThisTurn" | "meleeAttackUsedThisTurn" | "movedHexesThisTurn">>;

export function movementApCost(combatant: InjuryActor, steps: number): number {
  if (steps <= 0) return 0;
  const surcharge = hasInjury(combatant, "backInjury") && combatant.attackedThisTurn && !combatant.backInjuryMovementUsedThisTurn ? 1 : 0;
  return steps * (hasInjury(combatant, "legTrauma") ? 2 : 1) + surcharge;
}

export function rangedAttackApCost(combatant: InjuryActor): number {
  return hasInjury(combatant, "brokenArm") ? 4 : 3;
}

export function meleeAttackApCost(combatant: InjuryActor): number {
  return hasInjury(combatant, "dislocatedShoulder") && !combatant.meleeAttackUsedThisTurn ? 3 : 2;
}

export function rangedAttackRange(combatant: InjuryActor): number {
  return hasInjury(combatant, "eyeInjury") ? 5 : 6;
}

export function remainingMovementHexes(combatant: InjuryActor): number {
  return hasInjury(combatant, "tendonStrain") ? Math.max(0, 3 - (combatant.movedHexesThisTurn ?? 0)) : Infinity;
}

export function affordableMovementHexes(combatant: InjuryActor & { ap: number }): number {
  const surcharge = movementApCost(combatant, 1) - (hasInjury(combatant, "legTrauma") ? 2 : 1);
  return Math.min(remainingMovementHexes(combatant), Math.max(0, Math.floor((combatant.ap - surcharge) / (hasInjury(combatant, "legTrauma") ? 2 : 1))));
}

export function receivedBattleHealing(combatant: InjuryActor, amount: number): number {
  return Math.max(0, Math.floor(amount * (hasInjury(combatant, "abdominalWound") ? 0.75 : 1)));
}

export function injuryAdjustedAttackDamage(attacker: InjuryActor, target: InjuryActor, damage: number): number {
  return damage * (hasInjury(attacker, "handInjury") ? 0.85 : 1) * (hasInjury(target, "burn") ? 1.1 : 1);
}

export function mitigatedBattleDamage(damage: number, armor: number, blockPercent = 0): number {
  const afterArmor = Math.max(1, Math.round(damage * 100 / (100 + Math.max(0, armor))));
  const block = Number.isFinite(blockPercent) ? Math.max(0, Math.min(100, blockPercent)) : 0;
  return Math.max(1, Math.round(afterArmor * (1 - block / 100)));
}

export function effectiveBattleArmor(combatant: Pick<CombatantSnapshot, "combatStats" | "weaponSkillBuffs">): number {
  return Math.max(0, (combatant.combatStats?.armor ?? 0) + (combatant.weaponSkillBuffs ?? []).filter(buff => buff.remainingTurns > 0).reduce((sum, buff) => sum + buff.armorBonus, 0));
}

export function effectiveBattleBlock(combatant: Pick<CombatantSnapshot, "combatStats" | "weaponSkillBuffs">): number {
  return Math.max(0, Math.min(100, (combatant.combatStats?.blockPercent ?? 0) + (combatant.weaponSkillBuffs ?? []).filter(buff => buff.remainingTurns > 0).reduce((sum, buff) => sum + buff.blockBonus, 0)));
}

export function isBattleAttackEnabled(actor:Pick<CombatantSnapshot,"combatStats">,type:"meleeAttack"|"rangedAttack"):boolean {
  return type==="meleeAttack"
    ? actor.combatStats?.meleeEnabled!==false && (actor.combatStats?.meleeDamage??20)>0
    : actor.combatStats?.rangedEnabled!==false && (actor.combatStats?.rangedDamage??15)>0;
}

export function getBattleHealingPreview(snapshot: BattleSnapshot, actorId: string, targetId = actorId): { amount: number; apCost: number; available: boolean; reason?: string } {
  const actor = snapshot.combatants.find(unit => unit.id === actorId);
  const target = snapshot.combatants.find(unit => unit.id === targetId);
  const power = actor?.combatStats?.healingPower ?? 0;
  const amount = target ? Math.max(0, Math.min(target.maxHp - target.hp, receivedBattleHealing(target, power))) : 0;
  const reason = snapshot.finished ? "Walka zakończona."
    : !actor || actor.hp <= 0 ? "Postać jest nieprzytomna."
      : snapshot.activeCombatantId !== actorId ? "Poczekaj na swoją turę."
        : !Number.isFinite(power) || power <= 0 ? "Załóż kostur leczący przed walką."
          : actor.healingUsedThisTurn ? "Kostur został już użyty w tej turze."
            : !target || target.hp <= 0 || (target.id !== actorId && (!actor.side || target.side !== actor.side)) ? "Wybierz żywego sojusznika."
              : targetId !== actorId && hexDistance(actor.position, target.position) > 6 ? "Sojusznik jest poza zasięgiem (6 pól)."
                : targetId !== actorId && !hasLineOfSight(actor.position, target.position, new Set(snapshot.blockedCells.map(hexKey))) ? "Przeszkoda zasłania sojusznika."
                  : amount <= 0 ? "Cel ma pełne HP."
                    : actor.ap < STAFF_HEAL_AP_COST ? `Potrzeba ${STAFF_HEAL_AP_COST} AP.` : undefined;
  return { amount: Number.isFinite(amount) ? amount : 0, apCost: STAFF_HEAL_AP_COST, available: !reason, ...(reason ? { reason } : {}) };
}

export function areBattleEnemies(actor: CombatantSnapshot, target: CombatantSnapshot): boolean {
  if (actor.id === target.id || target.hp <= 0) return false;
  return actor.side && target.side ? actor.side !== target.side : actor.ownerPlayerId !== target.ownerPlayerId;
}

export function getBattleAttackPreview(snapshot: BattleSnapshot, actorId: string, targetId: string): BattleAttackPreview | null {
  const actor = snapshot.combatants.find(unit => unit.id === actorId);
  const target = snapshot.combatants.find(unit => unit.id === targetId);
  if (!actor || !target || !areBattleEnemies(actor, target)) return null;
  const distance = hexDistance(actor.position, target.position);
  const melee = distance === 1 && isBattleAttackEnabled(actor,"meleeAttack");
  const type = melee ? "meleeAttack" : "rangedAttack";
  const apCost = melee ? meleeAttackApCost(actor) : rangedAttackApCost(actor);
  const range = rangedAttackRange(actor);
  const inRange = distance > 0 && distance <= range;
  const lineOfSight = melee || hasLineOfSight(actor.position, target.position, new Set(snapshot.blockedCells.map(hexKey)));
  const damage = melee ? actor.combatStats?.meleeDamage ?? 20 : actor.combatStats?.rangedDamage ?? 15;
  const enabled=isBattleAttackEnabled(actor,type);
  const possible = enabled && inRange && lineOfSight;
  const reason = snapshot.finished ? "Walka zakończona."
    : actor.hp <= 0 ? "Postać jest nieprzytomna."
      : snapshot.activeCombatantId !== actorId ? "Poczekaj na swoją turę."
        : !enabled ? "Założona broń nie pozwala na atak z tej odległości."
          : !inRange ? `Cel poza zasięgiem (${range} pól).`
          : !lineOfSight ? "Przeszkoda zasłania cel."
            : actor.ap < apCost ? `Potrzeba ${apCost} AP.` : undefined;
  return {
    targetId, type, apCost, hitChance: possible ? 100 : 0,
    averageDamage: possible ? mitigatedBattleDamage(injuryAdjustedAttackDamage(actor, target, damage), effectiveBattleArmor(target), effectiveBattleBlock(target)) : 0,
    available: !reason, ...(reason ? { reason } : {})
  };
}

/** One breadth-first traversal yields the same shortest-path costs used by the server. */
export function getReachableBattleCells(snapshot: BattleSnapshot, actorId: string): HexCoord[] {
  const actor = snapshot.combatants.find(unit => unit.id === actorId);
  if (!actor || actor.hp <= 0 || snapshot.finished || snapshot.activeCombatantId !== actorId) return [];
  const maxSteps = affordableMovementHexes(actor);
  const allowed = new Set(snapshot.cells.map(hexKey));
  const blocked = new Set(snapshot.blockedCells.map(hexKey));
  for (const unit of snapshot.combatants) if (unit.id !== actorId && unit.hp > 0) blocked.add(hexKey(unit.position));
  const visited = new Set([hexKey(actor.position)]);
  const queue = [{ coord: actor.position, steps: 0 }];
  const reachable: HexCoord[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    if (current.steps >= maxSteps) continue;
    for (const next of hexNeighbors(current.coord)) {
      const key = hexKey(next);
      if (visited.has(key) || blocked.has(key) || !allowed.has(key)) continue;
      visited.add(key);
      reachable.push(next);
      queue.push({ coord: next, steps: current.steps + 1 });
    }
  }
  return reachable;
}
