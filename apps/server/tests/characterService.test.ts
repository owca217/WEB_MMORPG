import { describe, expect, it } from "vitest";
import { CharacterService } from "../src/character/CharacterService";

describe("CharacterService", () => {
  it("preserves selected appearance through combat updates without leaking mutable data", () => {
    const characters = new CharacterService();
    const appearance = { gender: "female", skinId: "female-guard", detail: { color: "blue" } };
    const hydrated = characters.hydrate({ ...characters.createPlayer("p1", "Owczy"), appearance });
    appearance.detail.color = "red";
    (hydrated.appearance!.detail as { color: string }).color = "green";
    const afterBattle = characters.applyBattleResult("p1", { hp: 50, severelyInjured: false, injuries: [] });
    expect(afterBattle.appearance).toEqual({ gender: "female", skinId: "female-guard", detail: { color: "blue" } });
    (afterBattle.appearance!.detail as { color: string }).color = "yellow";
    expect(characters.getSnapshot("p1")?.appearance).toEqual({ gender: "female", skinId: "female-guard", detail: { color: "blue" } });
  });

  it("creates stable base stats with only unarmed melee enabled", () => {
    const characters = new CharacterService();

    expect(characters.createPlayer("p1", "Owczy")).toMatchObject({
      playerId: "p1",
      nickname: "Owczy",
      level: 1,
      experience: 0,
      statistics: { strength: 10, dexterity: 10, vitality: 10, meleeDamage: 20, rangedDamage: 0, armor: 0, meleeEnabled: true, rangedEnabled: false },
      hp: 100,
      maxHp: 100,
      maxAp: 5,
      initiative: 10,
      severelyInjured: false,
      injuries: []
    });
  });

  it("awards cumulative XP and automatically grows statistics without fully healing", () => {
    const characters = new CharacterService();
    characters.hydrate({
      ...characters.createPlayer("p1", "Owczy"),
      appearance: { gender: "female", skinId: "female-guard" },
      hp: 40,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });

    expect(characters.awardExperience("p1", 99)).toMatchObject({ level: 1, experience: 99, hp: 40 });
    const leveled = characters.awardExperience("p1", 201);
    expect(leveled).toMatchObject({
      level: 3, experience: 300, hp: 100, maxHp: 160, maxAp: 5, initiative: 11,
      statistics: { strength: 14, dexterity: 12, vitality: 16, maxHp: 160, maxAp: 5, initiative: 11, meleeDamage: 24, rangedDamage: 0, armor: 4, meleeEnabled: true, rangedEnabled: false },
      appearance: { gender: "female", skinId: "female-guard" },
      severelyInjured: true, injuries: ["legTrauma"]
    });
    leveled.statistics!.strength = 999;
    expect(characters.getSnapshot("p1")?.statistics?.strength).toBe(14);
  });

  it("normalizes legacy levels and XP into derived statistics while retaining current HP", () => {
    const characters = new CharacterService();
    const legacy = characters.hydrate({
      playerId: "legacy", nickname: "Legacy", level: 4,
      hp: 180, maxHp: 200, maxAp: 7, initiative: 30,
      severelyInjured: false, injuries: []
    });
    expect(legacy).toMatchObject({ level: 4, experience: 600, hp: 180, maxHp: 190, maxAp: 5, initiative: 11 });
    const normalized = characters.hydrate({ ...legacy, experience: 0, hp: 999, statistics: { ...legacy.statistics!, strength: 999 } });
    expect(normalized).toMatchObject({ level: 4, experience: 600, hp: 190, statistics: { strength: 16 } });
    expect(characters.hydrate({ ...legacy, experience: 1000 })).toMatchObject({ level: 5, experience: 1000, hp: 180, maxHp: 220 });
  });

  it("caps earned XP and rejects invalid rewards without mutating the character", () => {
    const characters = new CharacterService();
    characters.createPlayer("p1", "Owczy");
    for (const amount of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => characters.awardExperience("p1", amount)).toThrow("INVALID_EXPERIENCE_AMOUNT");
    }
    expect(characters.getSnapshot("p1")).toMatchObject({ level: 1, experience: 0, hp: 100 });
    expect(characters.awardExperience("p1", 999999)).toMatchObject({ level: 100, experience: 495000, hp: 3070, maxHp: 3070, maxAp: 8 });
    expect(characters.awardExperience("p1", 100)).toMatchObject({ level: 100, experience: 495000 });
    expect(characters.hydrate({ ...characters.getSnapshot("p1")!, level: 1, experience: 999999 })).toMatchObject({ level: 100, experience: 495000 });
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
