import { describe, expect, it } from "vitest";
import type { BattleCommand, HexCoord } from "../src/index";

describe("shared contracts", () => {
  it("represents a move command with axial coordinates", () => {
    const target: HexCoord = { q: 2, r: -1 };
    const command: BattleCommand = {
      type: "move",
      combatantId: "combatant-1",
      target
    };

    expect(command.target).toEqual({ q: 2, r: -1 });
  });
});
