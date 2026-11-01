import { describe, expect, it } from 'vitest';
import { WEAPON_FAMILIES, WEAPON_SKILLS, getWeaponSkillProgress, getLearnedWeaponSkills, learnWeaponSkill, normalizeWeaponTraining, resetWeaponSkillFamily } from '../src';

function training(level = 100) {
  const value = normalizeWeaponTraining(undefined);
  for (const family of WEAPON_FAMILIES) value.experience[family.id] = 5 * level * (level + 1) / 2;
  return value;
}

describe('weapon skill trees', () => {
  it('provides two connected branches per family and requires a specialization at level100', () => {
    expect(new Set(WEAPON_SKILLS.map(skill => skill.id)).size).toBe(36);
    for (const family of WEAPON_FAMILIES) {
      const tree = WEAPON_SKILLS.filter(skill => skill.family === family.id);
      expect(tree).toHaveLength(4);
      expect(tree.filter(skill => skill.kind !== 'passive')).toHaveLength(3);
      expect(tree.reduce((sum, skill) => sum + skill.pointCost, 0)).toBeGreaterThan(getWeaponSkillProgress(training(), family.id).earnedPoints);
    }
  });
  it('retroactively awards separate points from existing XP without modifying it', () => {
    const old = training(50), before = structuredClone(old);
    expect(getWeaponSkillProgress(old, 'sword')).toMatchObject({ level: 50, earnedPoints: 10, spentPoints: 0, availablePoints: 10 });
    expect(old).toEqual(before);
    expect(getWeaponSkillProgress(undefined, 'sword').earnedPoints).toBe(0);
  });
  it('learns idempotently and keeps other families budgets independent', () => {
    const old = training(10), learned = learnWeaponSkill(old, 'sword:power');
    expect(getWeaponSkillProgress(learned, 'sword').availablePoints).toBe(0);
    expect(getWeaponSkillProgress(learned, 'bow').availablePoints).toBe(2);
    expect(learnWeaponSkill(learned, 'sword:power')).toEqual(learned);
    expect(learned.experience).toEqual(old.experience);
    expect(getLearnedWeaponSkills(old)).toEqual([]);
  });
  it('rejects missing level, predecessor and insufficient points without mutation', () => {
    expect(() => learnWeaponSkill(training(5), 'sword:power')).toThrow('WEAPON_LEVEL_REQUIRED');
    expect(() => learnWeaponSkill(training(), 'sword:ultimate')).toThrow('SKILL_PREREQUISITE_REQUIRED');
    let value = learnWeaponSkill(training(), 'sword:power');
    value = learnWeaponSkill(value, 'sword:technique');
    value = learnWeaponSkill(value, 'sword:mastery');
    const before = structuredClone(value);
    expect(() => learnWeaponSkill(value, 'sword:ultimate')).toThrow('INSUFFICIENT_SKILL_POINTS');
    expect(value).toEqual(before);
    expect(() => learnWeaponSkill(value, '__proto__')).toThrow('INVALID_WEAPON_SKILL');
  });
  it('preserves learned nodes through training normalization and removes invalid injected nodes', () => {
    const learned = learnWeaponSkill(training(), 'sword:power');
    expect(getLearnedWeaponSkills(normalizeWeaponTraining(learned))).toEqual(['sword:power']);
    const injected = { ...training(10), learnedSkills: ['sword:power', 'sword:ultimate', 'fake:power', 'sword:power'] };
    expect(getLearnedWeaponSkills(injected)).toEqual(['sword:power']);
  });
  it('resets one family while preserving the XP and other learned trees', () => {
    let value = learnWeaponSkill(training(), 'sword:power');
    value = learnWeaponSkill(value, 'bow:power');
    const reset = resetWeaponSkillFamily(value, 'sword');
    expect(getLearnedWeaponSkills(reset)).toEqual(['bow:power']);
    expect(reset.experience).toEqual(value.experience);
    expect(getWeaponSkillProgress(reset, 'sword').availablePoints).toBe(20);
    expect(() => resetWeaponSkillFamily(value, 'invalid')).toThrow('INVALID_WEAPON_FAMILY');
  });
});
