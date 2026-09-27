import { describe, expect, it } from "vitest";
import { experienceRequiredForLevelUp } from "./experience";

describe("experience progression", () => {
  it("starts at 200 EXP and triples the previous level requirement", () => {
    expect(experienceRequiredForLevelUp(1)).toBe(200);
    expect(experienceRequiredForLevelUp(2)).toBe(600);
    expect(experienceRequiredForLevelUp(3)).toBe(1_800);
    expect(experienceRequiredForLevelUp(4)).toBe(5_400);
  });

  it("rejects invalid level numbers instead of producing a broken threshold", () => {
    expect(() => experienceRequiredForLevelUp(0)).toThrow(RangeError);
    expect(() => experienceRequiredForLevelUp(1.5)).toThrow(RangeError);
    expect(() => experienceRequiredForLevelUp(Number.NaN)).toThrow(RangeError);
  });
});
