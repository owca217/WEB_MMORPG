import { DEFAULT_APPEARANCE } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { CharacterService } from "../src/character/CharacterService";

describe("CharacterService", () => {
  it("hydrates an existing persisted character snapshot", () => {
    const characters = new CharacterService();
    const hydrated = characters.hydratePlayer({
      playerId: "persisted-1",
      nickname: "Owczy",
      appearance: DEFAULT_APPEARANCE,
      level: 3,
      hp: 42,
      maxHp: 120,
      maxAp: 6,
      initiative: 14,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });

    expect(hydrated).toMatchObject({
      playerId: "persisted-1",
      level: 3,
      hp: 42,
      injuries: ["legTrauma"]
    });
  });


  it("creates stable MVP 2 base stats", () => {
    const characters = new CharacterService();

    expect(characters.createPlayer("p1", "Owczy")).toMatchObject({
      playerId: "p1",
      nickname: "Owczy",
      level: 1,
      hp: 100,
      maxHp: 100,
      maxAp: 5,
      initiative: 10,
      severelyInjured: false,
      injuries: []
    });
  });

  it("healer restores HP without erasing severe injuries", () => {
    const characters = new CharacterService();
    characters.createPlayer("p1", "Owczy");
    characters.applyBattleResult("p1", {
      hp: 0,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });

    characters.healHp("p1");

    expect(characters.getSnapshot("p1")).toMatchObject({
      hp: 100,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });
  });

  it("recovers a defeated character to 25 percent HP while preserving injuries", () => {
    const characters = new CharacterService();
    characters.createPlayer("p1", "Owczy");
    characters.applyBattleResult("p1", {
      hp: 0,
      severelyInjured: true,
      injuries: ["concussion"]
    });

    expect(characters.recoverAfterDefeat("p1")).toMatchObject({
      hp: 25,
      severelyInjured: true,
      injuries: ["concussion"]
    });
  });
});
