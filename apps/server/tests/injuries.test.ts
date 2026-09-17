import { describe, expect, it } from "vitest";
import {
  applyDamageWithInjuries,
  type CombatantState
} from "../src/battle/injuries";

function makeCombatant(): CombatantState {
  return {
    id: "hero-1",
    ownerPlayerId: "player-1",
    side: "player",
    name: "Hero",
    hp: 100,
    maxHp: 100,
    ap: 5,
    maxAp: 5,
    initiative: 10,
    position: { q: 0, r: 0 },
    severelyInjured: false,
    injuries: []
  };
}

describe("injuries", () => {
  it("does not create a severe injury while HP remains above zero", () => {
    const result = applyDamageWithInjuries(makeCombatant(), 20, 42);

    expect(result.hp).toBe(80);
    expect(result.severelyInjured).toBe(false);
    expect(result.injuries).toEqual([]);
  });

  it("marks a combatant severely injured when reduced to zero HP", () => {
    const result = applyDamageWithInjuries(makeCombatant(), 999, 42);

    expect(result.hp).toBe(0);
    expect(result.severelyInjured).toBe(true);
    expect(result.injuries.length).toBeGreaterThan(0);
  });

  it("produces deterministic injuries for the same seed", () => {
    const a = applyDamageWithInjuries(makeCombatant(), 999, 123);
    const b = applyDamageWithInjuries(makeCombatant(), 999, 123);

    expect(a.injuries).toEqual(b.injuries);
  });
});
