import { expect, it } from "vitest";
import { getWeaponCombatStatistics, getWeaponProficiency, isWeaponLoadout, normalizeWeaponTraining } from "../src/weapons";

it("normalizes legacy, malformed and out-of-range training without sharing mutable state",()=>{
  const input={experience:{sword:12.9,axe:-2,hammer:Infinity,dagger:"30",spear:30000,bow:NaN,crossbow:40},loadout:{melee:"axe",ranged:"crossbow"}};
  const normalized=normalizeWeaponTraining(input);
  expect(normalized).toEqual({experience:{sword:12,axe:0,hammer:0,dagger:0,spear:25250,bow:0,crossbow:40},loadout:{melee:"axe",ranged:"crossbow"}});
  normalized.experience.sword=99;normalized.loadout.melee="sword";
  expect(input.experience.sword).toBe(12.9);expect(input.loadout.melee).toBe("axe");
  expect(normalizeWeaponTraining(null)).toEqual({experience:{sword:0,axe:0,hammer:0,dagger:0,spear:0,bow:0,crossbow:0},loadout:{melee:"sword",ranged:"bow"}});
  expect(normalizeWeaponTraining({experience:[],loadout:{melee:"bow",ranged:"axe"}}).loadout).toEqual({melee:"sword",ranged:"bow"});
});

it.each([
  [0,{level:0,current:0,required:5,percentage:0,damageBonusPercent:0}],
  [4,{level:0,current:4,required:5,percentage:80,damageBonusPercent:0}],
  [5,{level:1,current:0,required:10,percentage:0,damageBonusPercent:0.25}],
  [14,{level:1,current:9,required:10,percentage:90,damageBonusPercent:0.25}],
  [15,{level:2,current:0,required:15,percentage:0,damageBonusPercent:0.5}],
  [25250,{level:100,current:0,required:0,percentage:100,damageBonusPercent:25}]
])("derives bounded proficiency and progress for %s XP",(xp,want)=>{
  expect(getWeaponProficiency(xp as number)).toMatchObject(want);
});

it("validates modes and applies only selected family bonuses without changing base attributes",()=>{
  expect(isWeaponLoadout({melee:"spear",ranged:"crossbow"})).toBe(true);
  expect(isWeaponLoadout({melee:"bow",ranged:"sword"})).toBe(false);
  expect(isWeaponLoadout({melee:"wand",ranged:"bow"})).toBe(false);
  expect(isWeaponLoadout(null)).toBe(false);
  const base={meleeDamage:20,rangedDamage:16,armor:8,strength:10};
  const training=normalizeWeaponTraining({experience:{sword:25250,bow:25250,axe:0},loadout:{melee:"axe",ranged:"bow"}});
  expect(getWeaponCombatStatistics(base,training)).toEqual({meleeDamage:20,rangedDamage:20,armor:8,strength:10});
  training.loadout.melee="sword";
  expect(getWeaponCombatStatistics(base,training)).toEqual({meleeDamage:25,rangedDamage:20,armor:8,strength:10});
  expect(base).toEqual({meleeDamage:20,rangedDamage:16,armor:8,strength:10});
});
