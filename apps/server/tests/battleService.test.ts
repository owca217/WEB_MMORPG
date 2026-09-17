import { describe, expect, it } from "vitest";
import { BattleService } from "../src/battle/BattleService";

describe("BattleService NPC turns", () => {
  it("runs the wolf turn automatically and returns control to the player", () => {
    const service = new BattleService();
    const playerId = "player-1";
    const initial = service.startBattle(playerId, "Hero", "encounter:wolf");

    const hero = initial.combatants.find((combatant) => combatant.ownerPlayerId === playerId);
    const wolf = initial.combatants.find((combatant) => combatant.ownerPlayerId === undefined);

    expect(hero).toBeDefined();
    expect(wolf).toBeDefined();
    if (!hero || !wolf) throw new Error("Expected hero and wolf combatants.");

    const result = service.applyCommand(playerId, {
      type: "endTurn",
      combatantId: hero.id
    });

    expect(result.result.ok).toBe(true);
    expect(result.snapshot).toBeDefined();
    if (!result.snapshot) throw new Error("Expected a battle snapshot.");

    expect(result.snapshot.activeCombatantId).toBe(hero.id);

    const wolfAfter = result.snapshot.combatants.find((combatant) => combatant.id === wolf.id);
    expect(wolfAfter).toBeDefined();
    expect(wolfAfter?.position).not.toEqual(wolf.position);
  });
});
