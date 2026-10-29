import type { BattleSnapshot, CombatantSnapshot, HexCoord } from "./battle";
import { hasLineOfSight, hexDistance, hexKey, hexNeighbors } from "./battleTopology";

export interface BattleAttackPreview {
  targetId: string;
  type: "meleeAttack" | "rangedAttack";
  apCost: number;
  hitChance: number;
  averageDamage: number;
  available: boolean;
  reason?: string;
}

export function movementApCost(combatant: Pick<CombatantSnapshot, "injuries">, steps: number): number {
  return steps * (combatant.injuries.includes("legTrauma") ? 2 : 1);
}

export function rangedAttackApCost(combatant: Pick<CombatantSnapshot, "injuries">): number {
  return combatant.injuries.includes("brokenArm") ? 4 : 3;
}

export function mitigatedBattleDamage(damage: number, armor: number): number {
  return Math.max(1, Math.round(damage * 100 / (100 + Math.max(0, armor))));
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
  const melee = distance === 1;
  const type = melee ? "meleeAttack" : "rangedAttack";
  const apCost = melee ? 2 : rangedAttackApCost(actor);
  const inRange = distance > 0 && distance <= 6;
  const lineOfSight = melee || hasLineOfSight(actor.position, target.position, new Set(snapshot.blockedCells.map(hexKey)));
  const damage = melee ? actor.combatStats?.meleeDamage ?? 20 : actor.combatStats?.rangedDamage ?? 15;
  const possible = inRange && lineOfSight;
  const reason = snapshot.finished ? "Walka zakończona."
    : actor.hp <= 0 ? "Postać jest nieprzytomna."
    : snapshot.activeCombatantId !== actorId ? "Poczekaj na swoją turę."
    : !inRange ? "Cel poza zasięgiem (6 pól)."
    : !lineOfSight ? "Przeszkoda zasłania cel."
    : actor.ap < apCost ? `Potrzeba ${apCost} AP.` : undefined;
  return { targetId, type, apCost, hitChance: possible ? 100 : 0,
    averageDamage: possible ? mitigatedBattleDamage(damage, target.combatStats?.armor ?? 0) : 0,
    available: !reason, ...(reason ? { reason } : {}) };
}

/** One breadth-first traversal yields the same shortest-path costs used by the server. */
export function getReachableBattleCells(snapshot: BattleSnapshot, actorId: string): HexCoord[] {
  const actor = snapshot.combatants.find(unit => unit.id === actorId);
  if (!actor || actor.hp <= 0 || snapshot.finished || snapshot.activeCombatantId !== actorId) return [];
  const maxSteps = Math.floor(actor.ap / movementApCost(actor, 1));
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
