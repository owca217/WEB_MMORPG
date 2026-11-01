export const MAX_WEAPON_EXPERIENCE = 25250;

export function normalizeWeaponExperience(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_WEAPON_EXPERIENCE, Math.floor(value))) : 0;
}

export function getWeaponProficiency(totalExperience: number): {
  level: number; experience: number; current: number; required: number; percentage: number; damageBonusPercent: number;
} {
  const experience = normalizeWeaponExperience(totalExperience);
  const level = Math.min(100, Math.floor((Math.sqrt(1 + 8 * experience / 5) - 1) / 2));
  const current = level === 100 ? 0 : experience - 5 * level * (level + 1) / 2;
  const required = level === 100 ? 0 : 5 * (level + 1);
  return { level, experience, current, required, percentage: level === 100 ? 100 : current / required * 100, damageBonusPercent: level * 0.25 };
}
