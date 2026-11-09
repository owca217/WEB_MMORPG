import { describe, expect, it } from "vitest";
import { CharacterService } from "../src/character/CharacterService";
import { INJURY_DEFINITIONS } from "@web-mmorpg/shared";

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
      statistics: { strength: 0, dexterity: 0, vitality: 0, meleeDamage: 5, rangedDamage: 0, armor: 0, meleeEnabled: true, rangedEnabled: false },
      hp: 100,
      maxHp: 100,
      maxAp: 5,
      initiative: 10,
      severelyInjured: false,
      injuries: []
    });
  });

  it("retains historical progression when rewards are applied and never heals or grows stats", () => {
    const characters = new CharacterService();
    characters.hydrate({ ...characters.createPlayer("p1", "Owczy"), level: 100, experience: 495000, hp: 40,
      appearance: { gender: "female", skinId: "female-guard" }, severelyInjured: true, injuries: ["legTrauma"] });
    expect(characters.awardExperience("p1", 300)).toMatchObject({ level: 100, experience: 495000, hp: 40, maxHp: 100, maxAp: 5, initiative: 10,
      statistics: { strength: 0, dexterity: 0, vitality: 0, meleeDamage: 5, armor: 0 },
      appearance: { gender: "female", skinId: "female-guard" }, severelyInjured: true, injuries: ["legTrauma"] });
  });

  it("retains historical levels and XP while deriving fixed stats and clamping current HP", () => {
    const characters = new CharacterService();
    const legacy = characters.hydrate({ playerId: "legacy", nickname: "Legacy", level: 4, experience: 600,
      hp: 180, maxHp: 200, maxAp: 7, initiative: 30, severelyInjured: false, injuries: [] });
    expect(legacy).toMatchObject({ level: 4, experience: 600, hp: 100, maxHp: 100, maxAp: 5, initiative: 10 });
    expect(characters.hydrate({ ...legacy, experience: 0, hp: 999, statistics: { ...legacy.statistics!, strength: 999 } }))
      .toMatchObject({ level: 4, experience: 0, hp: 100, statistics: { strength: 0 } });
  });

  it("rejects invalid reward amounts without mutating historical progression", () => {
    const characters = new CharacterService(); characters.createPlayer("p1", "Owczy");
    for (const amount of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => characters.awardExperience("p1", amount)).toThrow("INVALID_EXPERIENCE_AMOUNT");
    expect(characters.awardExperience("p1", 999999)).toMatchObject({ level: 1, experience: 0, hp: 100, maxHp: 100, maxAp: 5 });
  });

  it("ordinary full-HP restoration preserves severe injuries", () => {
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

  it.each([0, 100])("healer fully restores a character at %i HP and removes every injury and severe state", (hp) => {
    const characters = new CharacterService();
    characters.createPlayer("p1", "Owczy");
    characters.applyBattleResult("p1", {
      hp,
      severelyInjured: true,
      injuries: INJURY_DEFINITIONS.map(injury => injury.id)
    });

    const healed = characters.recoverAtHealer("p1");

    expect(healed).toMatchObject({ hp: 100, maxHp: 100, severelyInjured: false, injuries: [] });
    expect(characters.getSnapshot("p1")).toMatchObject({ hp: 100, severelyInjured: false, injuries: [], experience: 0 });
  });

  it("partial HP restoration used by staff and consumables does not remove injuries", () => {
    const characters = new CharacterService();
    characters.createPlayer("p1", "Owczy");
    characters.applyBattleResult("p1", { hp: 40, severelyInjured: true, injuries: ["bleeding", "legTrauma"] });

    expect(characters.restoreHp("p1", 30)).toBe(30);
    expect(characters.getSnapshot("p1")).toMatchObject({ hp: 70, severelyInjured: true, injuries: ["bleeding", "legTrauma"] });
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
