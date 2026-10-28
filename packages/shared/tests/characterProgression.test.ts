import { describe, expect, it } from "vitest";
import {
  getCharacterStatistics,
  getExperienceProgress,
  getLevelForExperience,
  getTotalExperienceForLevel
} from "../src/index";

describe("automatic character progression", () => {
  it.each([
    { level: 1, expected: { strength: 10, dexterity: 10, vitality: 10, maxHp: 100, maxAp: 5, initiative: 10, meleeDamage: 20, rangedDamage: 15, armor: 0 } },
    { level: 11, expected: { strength: 30, dexterity: 20, vitality: 40, maxHp: 400, maxAp: 6, initiative: 15, meleeDamage: 40, rangedDamage: 25, armor: 20 } },
    { level: 100, expected: { strength: 208, dexterity: 109, vitality: 307, maxHp: 3070, maxAp: 8, initiative: 59, meleeDamage: 218, rangedDamage: 114, armor: 198 } }
  ])("derives automatic combat and primary statistics at level $level", ({ level, expected }) => {
    expect(getCharacterStatistics(level)).toEqual(expected);
  });

  it("normalizes level inputs and returns independent statistics", () => {
    expect(getCharacterStatistics(11.9).maxHp).toBe(400);
    expect(getCharacterStatistics(-8).maxHp).toBe(100);
    expect(getCharacterStatistics(Number.NaN).maxHp).toBe(100);
    expect(getCharacterStatistics(101).maxHp).toBe(3070);
    const statistics = getCharacterStatistics(1);
    statistics.strength = 999;
    expect(getCharacterStatistics(1).strength).toBe(10);
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
