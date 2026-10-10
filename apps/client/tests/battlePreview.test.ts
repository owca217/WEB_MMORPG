import type { BattleSnapshot, CombatantSnapshot, HexCoord } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { attackPreview, reachableCells } from "../src/battle/BattlePreview";

function hero(overrides: Partial<CombatantSnapshot> = {}): CombatantSnapshot {
  return {
    id: "hero",
    ownerPlayerId: "p1",
    name: "Owczy",
    hp: 100,
    maxHp: 100,
    ap: 5,
    maxAp: 5,
    initiative: 10,
    position: { q: 0, r: 0 },
    severelyInjured: false,
    injuries: [],
    ...overrides
  };
}

function wolf(overrides: Partial<CombatantSnapshot> = {}): CombatantSnapshot {
  return {
    id: "wolf",
    name: "Wilk",
    hp: 60,
    maxHp: 60,
    ap: 4,
    maxAp: 4,
    initiative: 7,
    position: { q: 2, r: 0 },
    severelyInjured: false,
    injuries: [],
    ...overrides
  };
}

function snapshot(input: {
  cells?: HexCoord[];
  blockedCells?: HexCoord[];
  combatants?: CombatantSnapshot[];
} = {}): BattleSnapshot {
  return {
    id: "battle-1",
    round: 1,
    activeCombatantId: "hero",
    turnOrder: ["hero", "wolf"],
    cells: input.cells ?? [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 0, r: 1 },
      { q: 1, r: 1 },
      { q: 1, r: -1 },
      { q: 2, r: -1 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
      { q: 5, r: 0 },
      { q: 6, r: 0 },
      { q: 7, r: 0 }
    ],
    blockedCells: input.blockedCells ?? [],
    coverCells: [],
    combatants: input.combatants ?? [hero(), wolf()],
    finished: false
  };
}

describe("BattlePreview", () => {
  it("does not mark blocked or occupied cells as reachable", () => {
    const result = reachableCells(snapshot({ blockedCells: [{ q: 1, r: 0 }] }), "hero");

    expect(result.has("1,0")).toBe(false);
    expect(result.has("2,0")).toBe(false);
    expect(result.has("0,1")).toBe(true);
  });

  it("marks melee as out of range when the target is not adjacent", () => {
    expect(attackPreview(snapshot(), "hero", "wolf", "meleeAttack")).toMatchObject({
      valid: false,
      reason: "OUT_OF_RANGE",
      apCost: 2
    });
  });

  it("limits ranged attacks to six hexes", () => {
    const state = snapshot({
      combatants: [hero(), wolf({ position: { q: 7, r: 0 } })]
    });

    expect(attackPreview(state, "hero", "wolf", "rangedAttack")).toMatchObject({
      valid: false,
      reason: "OUT_OF_RANGE",
      apCost: 3
    });
  });

  it("rejects ranged attacks through a blocking cell", () => {
    const state = snapshot({ blockedCells: [{ q: 1, r: 0 }] });

    expect(attackPreview(state, "hero", "wolf", "rangedAttack")).toMatchObject({
      valid: false,
      reason: "NO_LINE_OF_SIGHT",
      apCost: 3
    });
  });

  it("raises ranged AP cost to four with a broken arm", () => {
    const state = snapshot({
      combatants: [hero({ ap: 3, injuries: ["brokenArm"] }), wolf()]
    });

    expect(attackPreview(state, "hero", "wolf", "rangedAttack")).toMatchObject({
      valid: false,
      reason: "INSUFFICIENT_AP",
      apCost: 4
    });
  });

  it("makes leg trauma cost two AP per moved hex", () => {
    const state = snapshot({
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
        { q: 3, r: 0 }
      ],
      combatants: [
        hero({ ap: 2, injuries: ["legTrauma"] }),
        wolf({ position: { q: 3, r: 0 } })
      ]
    });
    const result = reachableCells(state, "hero");

    expect(result.has("1,0")).toBe(true);
    expect(result.has("2,0")).toBe(false);
  });
});
