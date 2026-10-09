import type { BattleCommand } from "@web-mmorpg/shared";
import type { BattleState } from "./BattleEngine";
import { findPath, hexDistance, hexKey, hexNeighbors } from "./hex";

export function chooseWolfCommand(state: BattleState, wolfId: string): BattleCommand {
  const wolf = state.combatants[wolfId];
  if (!wolf) throw new Error("NPC_COMBATANT_NOT_FOUND");

  const target = Object.values(state.combatants)
    .filter((combatant) => combatant.side === "player" && combatant.hp > 0)
    .sort(
      (a, b) =>
        hexDistance(wolf.position, a.position) - hexDistance(wolf.position, b.position)
    )[0];

  if (!target || wolf.ap <= 0) {
    return { type: "endTurn", combatantId: wolf.id };
  }

  const distance = hexDistance(wolf.position, target.position);
  if (distance === 1) {
    if (wolf.ap >= 2) {
      return {
        type: "meleeAttack",
        combatantId: wolf.id,
        targetId: target.id
      };
    }

    return { type: "endTurn", combatantId: wolf.id };
  }

  const allowed = new Set(state.arena.cells.map(hexKey));
  const blocked = new Set(state.arena.blockedCells.map(hexKey));
  for (const combatant of Object.values(state.combatants)) {
    if (combatant.id !== wolf.id && combatant.hp > 0) {
      blocked.add(hexKey(combatant.position));
    }
  }

  const goals = hexNeighbors(target.position)
    .filter((cell) => allowed.has(hexKey(cell)) && !blocked.has(hexKey(cell)))
    .sort((a, b) => hexDistance(wolf.position, a) - hexDistance(wolf.position, b));

  for (const goal of goals) {
    const path = findPath(wolf.position, goal, blocked, allowed);
    if (path?.length) {
      return {
        type: "move",
        combatantId: wolf.id,
        target: path[0]!
      };
    }
  }

  return { type: "endTurn", combatantId: wolf.id };
}
