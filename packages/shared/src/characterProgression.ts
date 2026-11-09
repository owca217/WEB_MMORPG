export interface CombatStatistics {
  meleeDamage: number;
  rangedDamage: number;
  armor: number;
  meleeEnabled?: boolean;
  rangedEnabled?: boolean;
  healingPower?: number;
  blockPercent?: number;
}

export interface CharacterStatistics extends CombatStatistics {
  strength: number;
  dexterity: number;
  vitality: number;
  maxHp: number;
  maxAp: number;
  initiative: number;
}

export const MAX_CHARACTER_LEVEL = 100;

function normalizeLevel(level: number): number {
  return Number.isNaN(level) ? 1 : Math.max(1, Math.min(MAX_CHARACTER_LEVEL, Math.floor(level)));
}

/** Historical level is accepted for old save readers, but never changes the fixed baseline. */
export function getCharacterStatistics(_historicalLevel?: number): CharacterStatistics {
  return {
    strength: 0, dexterity: 0, vitality: 0,
    maxHp: 100, maxAp: 5, initiative: 10,
    meleeDamage: 5, rangedDamage: 0, armor: 0
  };
}

export function getTotalExperienceForLevel(level: number): number {
  const normalized = normalizeLevel(level);
  return 50 * (normalized - 1) * normalized;
}

function normalizeExperience(totalExperience: number): number {
  if (!Number.isFinite(totalExperience)) return 0;
  return Math.max(0, Math.min(getTotalExperienceForLevel(MAX_CHARACTER_LEVEL), Math.floor(totalExperience)));
}

export function getLevelForExperience(totalExperience: number): number {
  const experience = normalizeExperience(totalExperience);
  return normalizeLevel(Math.floor((1 + Math.sqrt(1 + (4 * experience) / 50)) / 2));
}

export function getExperienceProgress(
  level: number,
  totalExperience: number
): { current: number; required: number; percentage: number } {
  const normalizedLevel = normalizeLevel(level);
  if (normalizedLevel === MAX_CHARACTER_LEVEL) {
    return { current: 0, required: 0, percentage: 100 };
  }
  const threshold = getTotalExperienceForLevel(normalizedLevel);
  const required = getTotalExperienceForLevel(normalizedLevel + 1) - threshold;
  const current = Math.min(required, Math.max(0, normalizeExperience(totalExperience) - threshold));
  return { current, required, percentage: (current / required) * 100 };
}
