import { describe, expect, it } from "vitest";
import {
  getCharacterStatistics,
  getExperienceProgress,
  getLevelForExperience,
  getTotalExperienceForLevel
} from "../src/index";

describe("fixed character baseline and historical XP helpers", () => {
  it.each([
    { level: 1, expected: { strength: 0, dexterity: 0, vitality: 0, maxHp: 100, maxAp: 5, initiative: 10, meleeDamage: 5, rangedDamage: 0, armor: 0 } },
    { level: 11, expected: { strength: 0, dexterity: 0, vitality: 0, maxHp: 100, maxAp: 5, initiative: 10, meleeDamage: 5, rangedDamage: 0, armor: 0 } },
    { level: 100, expected: { strength: 0, dexterity: 0, vitality: 0, maxHp: 100, maxAp: 5, initiative: 10, meleeDamage: 5, rangedDamage: 0, armor: 0 } }
  ])("ignores historical level $level for primary and combat statistics", ({ level, expected }) => {
    expect(getCharacterStatistics(level)).toEqual(expected);
  });

  it("normalizes level inputs and returns independent statistics", () => {
    expect(getCharacterStatistics(11.9).maxHp).toBe(100);
    expect(getCharacterStatistics(-8).maxHp).toBe(100);
    expect(getCharacterStatistics(Number.NaN).maxHp).toBe(100);
    expect(getCharacterStatistics(101).maxHp).toBe(100);
    const statistics = getCharacterStatistics(1);
    statistics.strength = 999;
    expect(getCharacterStatistics(1).strength).toBe(0);
  });

  it("uses increasing total XP thresholds and caps progression at level 100", () => {
    expect(getTotalExperienceForLevel(1)).toBe(0);
    expect(getTotalExperienceForLevel(2)).toBe(100);
    expect(getTotalExperienceForLevel(3)).toBe(300);
    expect(getTotalExperienceForLevel(100)).toBe(495000);
    expect(getTotalExperienceForLevel(101)).toBe(495000);
    expect([0, 99, 100, 299, 300, 494999, 495000, 999999].map(getLevelForExperience))
      .toEqual([1, 1, 2, 2, 3, 99, 100, 100]);
    expect(getLevelForExperience(-100)).toBe(1);
    expect(getLevelForExperience(Number.NaN)).toBe(1);
  });

  it("reports XP earned within the current level and a complete bar at the cap", () => {
    expect(getExperienceProgress(3, 450)).toEqual({ current: 150, required: 300, percentage: 50 });
    expect(getExperienceProgress(3, 0)).toEqual({ current: 0, required: 300, percentage: 0 });
    expect(getExperienceProgress(3, 999)).toEqual({ current: 300, required: 300, percentage: 100 });
    expect(getExperienceProgress(100, 495000)).toEqual({ current: 0, required: 0, percentage: 100 });
  });
});
