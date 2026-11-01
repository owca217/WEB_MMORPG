import type { BattleSnapshot } from "./battle";
import { getWeaponSkill, type WeaponSkillId } from "./weaponSkills";
import { areBattleEnemies, effectiveBattleArmor, effectiveBattleBlock, injuryAdjustedAttackDamage, isBattleAttackEnabled, meleeAttackApCost, mitigatedBattleDamage, rangedAttackApCost, rangedAttackRange, receivedBattleHealing } from "./battleRules";
import { hasLineOfSight, hexDistance, hexKey } from "./battleTopology";

export interface WeaponSkillPreview {
  available: boolean;
  reason?: string;
  code?: string;
  apCost: number;
  cooldownRemaining: number;
  amount: number;
  targetId?: string;
}

/** A battle's eligible list is captured server-side from learned skills and equipped gear. */
export function getWeaponSkillPreview(snapshot: BattleSnapshot, actorId: string, skillId: WeaponSkillId | string, selectedTargetId?: string): WeaponSkillPreview {
  const skill = getWeaponSkill(skillId), actor = snapshot.combatants.find(unit => unit.id === actorId);
  const targetId = skill?.target === "self" ? actorId : skill?.target === "ally" ? selectedTargetId ?? actorId : selectedTargetId;
  const target = snapshot.combatants.find(unit => unit.id === targetId);
  const cooldownRemaining = Math.max(0, actor?.weaponSkillCooldowns?.[skillId as WeaponSkillId] ?? 0);
  const melee = skill?.kind === "attack" && skill.attackMode !== "rangedAttack";
  const apCost = (skill?.apCost ?? 0) + (actor && skill?.kind === "attack" ? melee ? meleeAttackApCost(actor) - 2 : rangedAttackApCost(actor) - 3 : 0);
  const result: WeaponSkillPreview = {available: false, apCost, cooldownRemaining, amount: 0, ...(targetId ? {targetId} : {})};
  const reject = (code: string, reason: string): WeaponSkillPreview => ({...result, code, reason});
  if (!skill || skill.kind === "passive") return reject("INVALID_WEAPON_SKILL", "Wybierz aktywną technikę.");
  if (snapshot.finished) return reject("BATTLE_FINISHED", "Walka zakończona.");
  if (!actor || actor.hp <= 0) return reject("COMBATANT_DOWN", "Postać jest nieprzytomna.");
  if (snapshot.activeCombatantId !== actorId) return reject("NOT_ACTIVE_TURN", "Poczekaj na swoją turę.");
  if (!actor.weaponSkills?.includes(skill.id)) return reject("WEAPON_SKILL_NOT_LEARNED", "Technika wymaga nauki i założenia odpowiedniej broni.");
  if (cooldownRemaining > 0) return reject("WEAPON_SKILL_COOLDOWN", `Odnowienie: ${cooldownRemaining} tur.`);
  if (!target || target.hp <= 0) return reject("INVALID_TARGET", "Wybierz żywy cel techniki.");
  if (skill.target === "enemy" && !areBattleEnemies(actor, target)) return reject("INVALID_TARGET", "Wybierz przeciwnika.");
  if (skill.target === "ally" && target.id !== actor.id && (!actor.side || actor.side !== target.side)) return reject("INVALID_TARGET", "Wybierz siebie lub sojusznika.");
  const distance = hexDistance(actor.position, target.position);
  const range = skill.kind === "attack" && !melee ? Math.min(skill.range ?? 6, rangedAttackRange(actor)) : skill.range ?? (skill.target === "self" ? 0 : 6);
  if (distance > range || skill.target === "enemy" && distance < 1) return reject("OUT_OF_RANGE", `Cel poza zasięgiem (${range} pól).`);
  if (distance > 1 && !hasLineOfSight(actor.position, target.position, new Set(snapshot.blockedCells.map(hexKey)))) return reject("NO_LINE_OF_SIGHT", "Przeszkoda zasłania cel.");
  if (skill.kind === "attack") {
    const mode = melee ? "meleeAttack" : "rangedAttack";
    if (!isBattleAttackEnabled(actor, mode)) return reject("WEAPON_ATTACK_UNAVAILABLE", "Założona broń nie pozwala na tę technikę.");
    const base = melee ? actor.combatStats?.meleeDamage ?? 20 : actor.combatStats?.rangedDamage ?? 15;
    result.amount = mitigatedBattleDamage(injuryAdjustedAttackDamage(actor, target, base * (skill.damageMultiplier ?? 1)), effectiveBattleArmor(target) * (1 - (skill.armorPenetration ?? 0)), effectiveBattleBlock(target));
  } else if (skill.kind === "heal") {
    if (skill.family === "staff" && (actor.combatStats?.healingPower ?? 0) <= 0) return reject("HEAL_NO_STAFF", "Załóż kostur leczący.");
    if (skill.family === "staff" && actor.healingUsedThisTurn) return reject("HEAL_ALREADY_USED", "Kostur został już użyty w tej turze.");
    const base = (skill.healPercentMaxHp ?? 0) * target.maxHp + (skill.healingMultiplier ?? 0) * (actor.combatStats?.healingPower ?? 0);
    result.amount = Math.max(0, Math.min(target.maxHp - target.hp, receivedBattleHealing(target, Math.round(base))));
    if (result.amount <= 0) return reject("NO_HEAL_EFFECT", "Cel ma pełne HP.");
  } else result.amount = (skill.armorBonus ?? 0) + (skill.blockBonus ?? 0);
  if (actor.ap < apCost) return reject("INSUFFICIENT_AP", `Potrzeba ${apCost} AP.`);
  return {...result, available: true};
}
