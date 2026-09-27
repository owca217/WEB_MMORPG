export const FIRST_LEVEL_EXPERIENCE_REQUIREMENT = 200;
export const EXPERIENCE_GROWTH_FACTOR = 3;

/**
 * Returns the EXP required to advance from `level` to the next level.
 * Level 1 -> 2 starts at 200 EXP; every following threshold triples.
 */
export function experienceRequiredForLevelUp(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError("Character level must be a positive safe integer.");
  }

  const requirement = FIRST_LEVEL_EXPERIENCE_REQUIREMENT *
    EXPERIENCE_GROWTH_FACTOR ** (level - 1);
  if (!Number.isSafeInteger(requirement)) {
    throw new RangeError("Character level produces an unsafe EXP requirement.");
  }
  return requirement;
}
