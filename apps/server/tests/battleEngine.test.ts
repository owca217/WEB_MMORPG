import { describe, expect, it } from "vitest";
import type { GeneratedArena } from "@web-mmorpg/shared";
import {
  applyBattleCommand,
  createBattleState,
  type CreateCombatantInput
} from "../src/battle/BattleEngine";

const arena: GeneratedArena = {
  cells: [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: 3, r: 0 },
    { q: 0, r: 1 },
    { q: 1, r: 1 },
    { q: 2, r: 1 }
  ],
  blockedCells: [],
  coverCells: [],
  playerStartCells: [{ q: 0, r: 0 }],
  enemyStartCells: [{ q: 3, r: 0 }]
};

function combatants(): CreateCombatantInput[] {
  return [
    {
      id: "hero-1",
      ownerPlayerId: "player-1",
      side: "player",
      name: "Hero",
      hp: 100,
      maxHp: 100,
      maxAp: 5,
      initiative: 10,
      position: { q: 0, r: 0 },
      severelyInjured: false,
      injuries: []
    },
    {
      id: "enemy-1",
      side: "enemy",
      name: "Wolf",
      hp: 40,
      maxHp: 40,
      maxAp: 5,
      initiative: 5,
      position: { q: 3, r: 0 },
      severelyInjured: false,
      injuries: []
    }
  ];
}

function makeState(overrides?: Partial<GeneratedArena>) {
  return createBattleState({
    id: "battle-1",
    seed: 42,
    arena: { ...arena, ...overrides },
    combatants: combatants()
  });
}

describe("battle engine", () => {
  it("orders combatants by initiative and refreshes the active AP", () => {
    const state = makeState();

    expect(state.activeCombatantId).toBe("hero-1");
    expect(state.combatants["hero-1"]?.ap).toBe(5);
  });

  it("rejects a move from a player that does not own the active combatant", () => {
    const result = applyBattleCommand(makeState(), "player-2", {
      type: "move",
      combatantId: "hero-1",
      target: { q: 1, r: 0 }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_OWNER");
  });

  it("spends one AP per traversed hex", () => {
    const result = applyBattleCommand(makeState(), "player-1", {
      type: "move",
      combatantId: "hero-1",
      target: { q: 2, r: 0 }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.combatants["hero-1"]?.ap).toBe(3);
      expect(result.state.combatants["hero-1"]?.position).toEqual({ q: 2, r: 0 });
    }
  });

  it("rejects melee attacks outside distance one", () => {
    const result = applyBattleCommand(makeState(), "player-1", {
      type: "meleeAttack",
      combatantId: "hero-1",
      targetId: "enemy-1"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OUT_OF_RANGE");
  });

  it("rejects ranged attacks through full blockers", () => {
    const state = makeState({ blockedCells: [{ q: 1, r: 0 }] });
    const result = applyBattleCommand(state, "player-1", {
      type: "rangedAttack",
      combatantId: "hero-1",
      targetId: "enemy-1"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_LINE_OF_SIGHT");
  });

  it("rejects actions that exceed available AP", () => {
    const state = makeState();
    state.combatants["hero-1"]!.ap = 1;

    const result = applyBattleCommand(state, "player-1", {
      type: "rangedAttack",
      combatantId: "hero-1",
      targetId: "enemy-1"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INSUFFICIENT_AP");
  });

  it("advances the turn and refreshes the next combatant AP", () => {
    const state = makeState();
    state.combatants["enemy-1"]!.ap = 0;

    const result = applyBattleCommand(state, "player-1", {
      type: "endTurn",
      combatantId: "hero-1"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.activeCombatantId).toBe("enemy-1");
      expect(result.state.combatants["enemy-1"]?.ap).toBe(5);
    }
  });
});
