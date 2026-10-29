export interface CombatStatistics {
  meleeDamage: number;
  rangedDamage: number;
  armor: number;
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

export function getCharacterStatistics(level: number): CharacterStatistics {
  const progression = normalizeLevel(level) - 1;
  return {
    strength: 10 + 2 * progression,
    dexterity: 10 + progression,
    vitality: 10 + 3 * progression,
    maxHp: 100 + 30 * progression,
    maxAp: Math.min(8, 5 + Math.floor(progression / 10)),
    initiative: 10 + Math.floor(progression / 2),
    meleeDamage: 20 + 2 * progression,
    rangedDamage: 15 + progression,
    armor: 2 * progression
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
