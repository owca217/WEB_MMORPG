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
  it.each([
    { type: "meleeAttack" as const, armor: 100, damage: 28 },
    { type: "rangedAttack" as const, armor: 100, damage: 16 },
    { type: "meleeAttack" as const, armor: -100, damage: 55 },
    { type: "rangedAttack" as const, armor: 100_000, damage: 1 }
  ])("uses actor damage and target armor for $type with armor $armor", ({ type, armor, damage }) => {
    const fighters = combatants();
    fighters[0]!.combatStats = { meleeDamage: 55, rangedDamage: 31, armor: 0 };
    fighters[1]!.combatStats = { meleeDamage: 8, rangedDamage: 0, armor };
    fighters[1]!.position = { q: 1, r: 0 };
    fighters[1]!.hp = 100;
    fighters[1]!.maxHp = 100;
    const state = createBattleState({ id: "scaled", seed: 42, arena, combatants: fighters });

    const result = applyBattleCommand(state, "player-1", {
      type, combatantId: "hero-1", targetId: "enemy-1"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.combatants["enemy-1"]!.hp).toBe(100 - damage);
      expect(state.combatants["enemy-1"]!.hp).toBe(100);
    }
  });

  it.each([
    { type: "meleeAttack" as const, damage: 20 },
    { type: "rangedAttack" as const, damage: 15 }
  ])("keeps legacy $type damage for combatants without statistics", ({ type, damage }) => {
    const state = makeState();
    state.combatants["enemy-1"]!.position = { q: 1, r: 0 };
    const result = applyBattleCommand(state, "player-1", {
      type, combatantId: "hero-1", targetId: "enemy-1"
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.combatants["enemy-1"]!.hp).toBe(40 - damage);
  });

  it("isolates combat statistics and injuries from input and later command states", () => {
    const fighters = combatants();
    fighters[0]!.combatStats = { meleeDamage: 55, rangedDamage: 31, armor: 12 };
    fighters[0]!.level = 5;
    fighters[0]!.injuries = ["brokenArm"];
    const state = createBattleState({ id: "scaled", seed: 42, arena, combatants: fighters });
    fighters[0]!.combatStats.meleeDamage = 999;
    fighters[0]!.injuries.push("legTrauma");
    fighters[0]!.position.q = 99;

    expect(state.combatants["hero-1"]!.combatStats!.meleeDamage).toBe(55);
    expect(state.combatants["hero-1"]!.injuries).toEqual(["brokenArm"]);
    expect(state.combatants["hero-1"]!.position.q).toBe(0);
    const result = applyBattleCommand(state, "player-1", { type: "endTurn", combatantId: "hero-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      result.state.combatants["hero-1"]!.combatStats!.armor = 999;
      expect(state.combatants["hero-1"]!.combatStats!.armor).toBe(12);
      expect(result.state.combatants["hero-1"]!.level).toBe(5);
    }
  });

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
