import { describe, expect, it } from "vitest";
import type { BattleState } from "../src/battle/BattleEngine";
import { chooseWolfCommand } from "../src/battle/NpcBattleAi";

function makeState(wolfQ: number): BattleState {
  const cells = [0, 1, 2, 3].map((q) => ({ q, r: 0 }));

  return {
    id: "battle:test",
    seed: 1,
    round: 1,
    activeCombatantId: "wolf",
    turnOrder: ["hero", "wolf"],
    arena: {
      cells,
      blockedCells: [],
      coverCells: [],
      playerStartCells: [{ q: 0, r: 0 }],
      enemyStartCells: [{ q: wolfQ, r: 0 }]
    },
    combatants: {
      hero: {
        id: "hero",
        ownerPlayerId: "player-1",
        side: "player",
        name: "Hero",
        hp: 100,
        maxHp: 100,
        ap: 0,
        maxAp: 5,
        initiative: 10,
        position: { q: 0, r: 0 },
        severelyInjured: false,
        injuries: []
      },
      wolf: {
        id: "wolf",
        side: "enemy",
        name: "Wolf",
        hp: 60,
        maxHp: 60,
        ap: 4,
        maxAp: 4,
        initiative: 7,
        position: { q: wolfQ, r: 0 },
        severelyInjured: false,
        injuries: []
      }
    },
    finished: false
  };
}

describe("chooseWolfCommand", () => {
  it("attacks when adjacent to the living player", () => {
    expect(chooseWolfCommand(makeState(1), "wolf")).toEqual({
      type: "meleeAttack",
      combatantId: "wolf",
      targetId: "hero"
    });
  });

  it("moves one legal hex toward the player when separated", () => {
    const command = chooseWolfCommand(makeState(3), "wolf");
    expect(command).toMatchObject({ type: "move", combatantId: "wolf" });
    if (command.type !== "move") throw new Error("Expected move command.");
    expect(command.target).toEqual({ q: 2, r: 0 });
  });

  it("ends the turn when it has no AP left", () => {
    const state = makeState(1);
    state.combatants.wolf!.ap = 0;

    expect(chooseWolfCommand(state, "wolf")).toEqual({
      type: "endTurn",
      combatantId: "wolf"
    });
  });
});
