import { describe, expect, it } from "vitest";
import type { CharacterSkinId, CharacterSnapshot } from "@web-mmorpg/shared";
import { BattleService } from "../src/battle/BattleService";

function hero(playerId: string, appearance?: Record<string, unknown>): CharacterSnapshot {
  return {
    playerId, nickname: playerId, level: 1,
    hp: 100, maxHp: 100, maxAp: 5, initiative: 10,
    severelyInjured: false, injuries: [],
    ...(appearance ? { appearance } : {})
  };
}

describe("battle character skin metadata", () => {
  it.each<{ appearance?: Record<string, unknown>; expected: CharacterSkinId }>([
    { appearance: { gender: "male", skinId: "male-traveler" }, expected: "male-traveler" },
    { appearance: { gender: "male", skinId: "male-scout" }, expected: "male-scout" },
    { appearance: { gender: "male", skinId: "male-guard" }, expected: "male-guard" },
    { appearance: { gender: "female", skinId: "female-traveler" }, expected: "female-traveler" },
    { appearance: { gender: "female", skinId: "female-scout" }, expected: "female-scout" },
    { appearance: { gender: "female", skinId: "female-guard" }, expected: "female-guard" },
    { expected: "male-traveler" },
    { appearance: {}, expected: "male-traveler" },
    { appearance: { gender: "male", skinId: "unknown" }, expected: "male-traveler" },
    { appearance: { gender: "female", skinId: { id: "female-guard" } }, expected: "female-traveler" },
    { appearance: { gender: "female" }, expected: "female-traveler" }
  ])("publishes the resolved $expected skin at admission", ({ appearance, expected }) => {
    const snapshot = new BattleService().startBattle(hero("a", appearance), "wolf-pack-01");
    const player = snapshot.combatants.find(unit => unit.ownerPlayerId === "a");

    expect(player).toMatchObject({ skinId: expected });
    expect(player).not.toHaveProperty("appearance");
    expect(snapshot.combatants.filter(unit => unit.side === "enemy").every(unit => !("skinId" in unit))).toBe(true);
  });

  it("keeps each party member's admitted skin through snapshot reads, turn changes and another member leaving", () => {
    const service = new BattleService();
    const characters = [
      hero("a", { gender: "female", skinId: "female-scout", privateNote: "never public" }),
      hero("b", { gender: "male", skinId: "male-guard" }),
      hero("c", { gender: "female", skinId: "invalid" })
    ];
    const initial = service.startPartyBattle(characters, "wolf-pack-01");
    const expected = [
      { ownerPlayerId: "a", skinId: "female-scout" },
      { ownerPlayerId: "b", skinId: "male-guard" },
      { ownerPlayerId: "c", skinId: "female-traveler" }
    ];
    expect(initial.combatants.filter(unit => unit.side === "player")).toMatchObject(expected);
    for (const character of characters) character.appearance!.skinId = "male-traveler";
    Object.assign(initial.combatants.find(unit => unit.ownerPlayerId === "a")!, { skinId: "male-traveler" });

    expect(service.getSnapshot("b")?.combatants.filter(unit => unit.side === "player")).toMatchObject(expected);
    const changed = service.applyCommand("a", { type: "endTurn", combatantId: "hero:a" });
    expect(changed.result.ok).toBe(true);
    expect(changed.snapshot?.combatants.filter(unit => unit.side === "player")).toMatchObject(expected);
    expect(service.getSnapshot("c")?.combatants).toEqual(changed.snapshot?.combatants);
    const detached = service.detachPlayer("a");
    expect(detached.applied?.snapshot?.combatants.filter(unit => unit.side === "player")).toMatchObject(expected.slice(1));
    expect(JSON.stringify(service.getSnapshot("c"))).not.toContain("privateNote");
  });
});
