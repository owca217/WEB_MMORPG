import type { CharacterSnapshot } from './character';
import type { InjuryKind } from './battle';
import { getWeaponProficiency } from './weaponProgression';
import type { WeaponFamily, WeaponTraining } from './weapons';

export type WeaponSkillId = `${WeaponFamily}:${'power' | 'technique' | 'mastery' | 'ultimate'}`;
export interface WeaponSkillDefinition {
  id: WeaponSkillId;
  family: WeaponFamily;
  name: string;
  description: string;
  branch: 'power' | 'tactics';
  requiredLevel: number;
  pointCost: number;
  prerequisite?: WeaponSkillId;
  kind: 'attack' | 'heal' | 'guard' | 'passive';
  target: 'enemy' | 'ally' | 'self';
  apCost: number;
  cooldownTurns: number;
  damageMultiplier?: number;
  armorPenetration?: number;
  healingMultiplier?: number;
  healPercentMaxHp?: number;
  blockBonus?: number;
  armorBonus?: number;
  durationTurns?: number;
  passiveBonusPercent?: number;
  attackMode?: 'meleeAttack' | 'rangedAttack';
  range?: number;
  injury?: { kind: InjuryKind; duration: number };
}
export type WeaponSkillUpdateResult = { ok: true; character: CharacterSnapshot } | { ok: false; code: string; message: string };

const families: WeaponFamily[] = ['sword', 'axe', 'hammer', 'dagger', 'spear', 'bow', 'crossbow', 'staff', 'wand', 'shield'];
type Node = 'power' | 'technique' | 'mastery' | 'ultimate';
const nodeSettings: Record<Node, { requiredLevel: number; pointCost: number; branch: 'power' | 'tactics'; previous?: Node }> = {
  power: { requiredLevel: 10, pointCost: 2, branch: 'power' },
  technique: { requiredLevel: 30, pointCost: 6, branch: 'tactics' },
  mastery: { requiredLevel: 50, pointCost: 8, branch: 'tactics', previous: 'technique' },
  ultimate: { requiredLevel: 60, pointCost: 8, branch: 'power', previous: 'power' }
};
type Effect = Pick<WeaponSkillDefinition, 'name' | 'description' | 'kind' | 'target'> & Partial<WeaponSkillDefinition>;
function skill(family: WeaponFamily, node: Node, effect: Effect): WeaponSkillDefinition {
  const setting = nodeSettings[node];
  return { apCost: 0, cooldownTurns: 0, ...effect, ...setting, id: `${family}:${node}`, family,
    ...(setting.previous ? { prerequisite: `${family}:${setting.previous}` as WeaponSkillId } : {}) };
}

const attackNames: Record<Exclude<WeaponFamily, 'staff' | 'shield'>, [string, string, string]> = {
  sword: ['Mocne cięcie', 'Cięcie przez gardę', 'Rozstrzygające cięcie'],
  axe: ['Rozłupanie', 'Podcięcie', 'Gniew drwala'],
  hammer: ['Ciężki zamach', 'Wstrząs', 'Druzgoczący cios'],
  dagger: ['Głębokie pchnięcie', 'Krwawiące cięcie', 'Zabójcza precyzja'],
  spear: ['Mocne pchnięcie', 'Zaczep włócznią', 'Przebicie'],
  bow: ['Napięta cięciwa', 'Strzał w ścięgno', 'Strzała łowcy'],
  crossbow: ['Ciężki bełt', 'Bełt przebijający', 'Strzał egzekutora'],
  wand: ['Skupiony pocisk', 'Przenikająca iskra', 'Rozstrzygający rozbłysk']
};
const tacticalInjuries: Partial<Record<WeaponFamily, { kind: InjuryKind; label: string }>> = {
  axe: { kind: 'thighWound', label: 'ranę uda' },
  hammer: { kind: 'concussion', label: 'wstrząśnienie' },
  dagger: { kind: 'bleeding', label: 'krwawienie' },
  spear: { kind: 'legTrauma', label: 'uraz nogi' },
  bow: { kind: 'tendonStrain', label: 'nadwyrężenie ścięgna' }
};

export const WEAPON_SKILLS: readonly WeaponSkillDefinition[] = families.flatMap(family => {
  if (family === 'staff') return [
    skill(family, 'power', { name: 'Silne odnowienie', description: 'Przywraca sobie lub sojusznikowi 150% zwykłego leczenia kosturem. Zasięg 6 pól.', kind: 'heal', target: 'ally', apCost: 3, cooldownTurns: 2, healingMultiplier: 1.5, range: 6 }),
    skill(family, 'technique', { name: 'Oszczędna odnowa', description: 'Przywraca sobie lub sojusznikowi 90% zwykłego leczenia za 2 AP. Zasięg 6 pól.', kind: 'heal', target: 'ally', apCost: 2, cooldownTurns: 2, healingMultiplier: 0.9, range: 6 }),
    skill(family, 'mastery', { name: 'Sztuka uzdrawiania', description: 'Pasywnie zwiększa moc leczenia założonym kosturem o 10%.', kind: 'passive', target: 'self', passiveBonusPercent: 10 }),
    skill(family, 'ultimate', { name: 'Przywrócenie sił', description: 'Przywraca sobie lub sojusznikowi 200% zwykłego leczenia kosturem. Zasięg 6 pól.', kind: 'heal', target: 'ally', apCost: 4, cooldownTurns: 3, healingMultiplier: 2, range: 6 })
  ];
  if (family === 'shield') return [
    skill(family, 'power', { name: 'Uderzenie tarczą', description: 'Zadaje 80% obrażeń wręcz i nakłada wstrząśnienie na 1 pełną turę celu.', kind: 'attack', target: 'enemy', attackMode: 'meleeAttack', range: 1, apCost: 3, cooldownTurns: 2, damageMultiplier: 0.8, injury: { kind: 'concussion', duration: 1 } }),
    skill(family, 'technique', { name: 'Drugi oddech', description: 'Przywraca 15% maksymalnego HP właściciela tarczy.', kind: 'heal', target: 'self', apCost: 3, cooldownTurns: 3, healPercentMaxHp: 0.15 }),
    skill(family, 'mastery', { name: 'Pewna osłona', description: 'Pasywnie zwiększa redukcję założonej tarczy o 5 punktów procentowych.', kind: 'passive', target: 'self', passiveBonusPercent: 5 }),
    skill(family, 'ultimate', { name: 'Bastion', description: 'Dodaje 15 pancerza i 30 punktów procentowych redukcji tarczy do początku drugiej kolejnej tury postaci.', kind: 'guard', target: 'self', apCost: 3, cooldownTurns: 3, blockBonus: 30, armorBonus: 15, durationTurns: 2 })
  ];
  const names = attackNames[family];
  const ranged = family === 'bow' || family === 'crossbow' || family === 'wand';
  const attackMode = ranged ? 'rangedAttack' as const : 'meleeAttack' as const;
  const range = ranged ? 6 : 1;
  const injury = tacticalInjuries[family];
  return [
    skill(family, 'power', { name: names[0], description: 'Zadaje 145% zwykłych obrażeń broni.', kind: 'attack', target: 'enemy', attackMode, range, apCost: 3, cooldownTurns: 2, damageMultiplier: 1.45 }),
    skill(family, 'technique', { name: names[1], description: injury ? `Zadaje zwykłe obrażenia i nakłada ${injury.label} na 2 pełne tury celu.${family === 'spear' ? ' Zasięg 2 pól.' : ''}` : `Zadaje zwykłe obrażenia, pomijając ${family === 'crossbow' ? 75 : 60}% pancerza celu.`, kind: 'attack', target: 'enemy', attackMode, range: family === 'spear' ? 2 : range, apCost: 3, cooldownTurns: 2, damageMultiplier: 1,
      ...(injury ? { injury: { kind: injury.kind, duration: 2 } } : { armorPenetration: family === 'crossbow' ? 0.75 : 0.6 }) }),
    skill(family, 'mastery', { name: 'Mistrzowska technika', description: 'Pasywnie zwiększa obrażenia założoną bronią tej rodziny o 10%.', kind: 'passive', target: 'self', passiveBonusPercent: 10 }),
    skill(family, 'ultimate', { name: names[2], description: 'Zadaje 190% zwykłych obrażeń i pomija 25% pancerza celu.', kind: 'attack', target: 'enemy', attackMode, range, apCost: 4, cooldownTurns: 3, damageMultiplier: 1.9, armorPenetration: 0.25 })
  ];
});

const byId = new Map(WEAPON_SKILLS.map(definition => [definition.id, definition]));
export function getWeaponSkill(id: unknown): WeaponSkillDefinition | undefined {
  return typeof id === 'string' ? byId.get(id as WeaponSkillId) : undefined;
}

export function normalizeLearnedWeaponSkills(experience: Record<WeaponFamily, number>, value: unknown): WeaponSkillId[] {
  const requested = new Set(Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);
  const learned: WeaponSkillId[] = [];
  for (const family of families) {
    const level = getWeaponProficiency(experience[family]).level;
    let available = Math.floor(level / 5);
    for (const definition of WEAPON_SKILLS.filter(item => item.family === family)) {
      if (!requested.has(definition.id) || definition.requiredLevel > level || definition.pointCost > available || definition.prerequisite && !learned.includes(definition.prerequisite)) continue;
      learned.push(definition.id);
      available -= definition.pointCost;
    }
  }
  return learned;
}

function normalized(value: unknown): { experience: Record<WeaponFamily, number>; loadout: WeaponTraining['loadout']; learnedSkills: WeaponSkillId[] } {
  const input = value && typeof value === 'object' ? value as Partial<WeaponTraining> : {};
  const experience = Object.fromEntries(families.map(family => [family, getWeaponProficiency(input.experience?.[family] ?? 0).experience])) as Record<WeaponFamily, number>;
  return { experience, loadout: input.loadout ?? { melee: 'sword', ranged: 'bow' }, learnedSkills: normalizeLearnedWeaponSkills(experience, input.learnedSkills) };
}

export function getLearnedWeaponSkills(training: unknown, selectedFamilies?: readonly WeaponFamily[]): WeaponSkillId[] {
  return normalized(training).learnedSkills.filter(id => !selectedFamilies || selectedFamilies.includes(getWeaponSkill(id)!.family));
}

export function getWeaponSkillProgress(training: unknown, family: WeaponFamily): { level: number; earnedPoints: number; spentPoints: number; availablePoints: number; learnedSkills: WeaponSkillId[] } {
  const data = normalized(training);
  const level = getWeaponProficiency(data.experience[family]).level;
  const learnedSkills = data.learnedSkills.filter(id => getWeaponSkill(id)!.family === family);
  const spentPoints = learnedSkills.reduce((sum, id) => sum + getWeaponSkill(id)!.pointCost, 0);
  const earnedPoints = Math.floor(level / 5);
  return { level, earnedPoints, spentPoints, availablePoints: earnedPoints - spentPoints, learnedSkills };
}

export function learnWeaponSkill(training: unknown, id: unknown): WeaponTraining {
  const definition = getWeaponSkill(id);
  if (!definition) throw new Error('INVALID_WEAPON_SKILL');
  const data = normalized(training);
  const progress = getWeaponSkillProgress(data, definition.family);
  if (data.learnedSkills.includes(definition.id)) return data;
  if (progress.level < definition.requiredLevel) throw new Error('WEAPON_LEVEL_REQUIRED');
  if (definition.prerequisite && !data.learnedSkills.includes(definition.prerequisite)) throw new Error('SKILL_PREREQUISITE_REQUIRED');
  if (progress.availablePoints < definition.pointCost) throw new Error('INSUFFICIENT_SKILL_POINTS');
  return { ...data, learnedSkills: [...data.learnedSkills, definition.id] };
}

export function resetWeaponSkillFamily(training: unknown, family: unknown): WeaponTraining {
  if (!families.includes(family as WeaponFamily)) throw new Error('INVALID_WEAPON_FAMILY');
  const data = normalized(training);
  return { ...data, learnedSkills: data.learnedSkills.filter(id => getWeaponSkill(id)!.family !== family) };
}
