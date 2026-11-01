import { hasInjury, type BattleInjuryEffect, type CombatStatistics, type EnemyId, type HexCoord, type InjuryKind, type PlayerId, type WeaponInjuryUpgrade } from "@web-mmorpg/shared";
export { movementApCost, rangedAttackApCost } from "@web-mmorpg/shared";

export interface CombatantState {
  id: string;
  enemyId?: EnemyId;
  ownerPlayerId?: PlayerId;
  side: "player" | "enemy";
  name: string;
  level?: number;
  combatStats?: CombatStatistics;
  healingUsedThisTurn?: boolean;
  shieldBlocks?: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  initiative: number;
  position: HexCoord;
  severelyInjured: boolean;
  injuries: InjuryKind[];
  temporaryInjuries?: BattleInjuryEffect[];
  weaponInjuryUpgrade?: WeaponInjuryUpgrade;
  baseMaxHp?: number;
  meleeAttackUsedThisTurn?: boolean;
  attackedThisTurn?: boolean;
  backInjuryMovementUsedThisTurn?: boolean;
  movedHexesThisTurn?: number;
  thighWoundDamageThisTurn?: number;
  injuryAttemptedTargetsThisTurn?: string[];
  fullTurnInjuryKinds?: InjuryKind[];
}

const INJURIES: InjuryKind[] = [
  "brokenArm",
  "legTrauma",
  "bleeding",
  "concussion",
  "chestWound"
];

export function applyDamageWithInjuries(
  combatant: CombatantState,
  damage: number,
  seed: number
): CombatantState {
  const hp = Math.max(0, combatant.hp - Math.max(0, damage));
  if (hp > 0) return { ...combatant, hp };

  const first = INJURIES[Math.abs(seed) % INJURIES.length]!;
  const second = INJURIES[Math.abs(seed * 31 + 7) % INJURIES.length]!;
  const injuries = first === second ? [first] : [first, second];

  return {
    ...combatant,
    hp: 0,
    severelyInjured: true,
    injuries
  };
}

export function effectiveInitiative(combatant: CombatantState): number {
  return combatant.initiative - (hasInjury(combatant, "concussion") ? 2 : 0);
}

export function applyEndTurnInjuries(combatant: CombatantState, seed: number): CombatantState {
  if (combatant.hp <= 0) return combatant;
  const damage = (hasInjury(combatant, "bleeding") ? 5 : 0) + (hasInjury(combatant, "poison") ? Math.ceil((combatant.baseMaxHp ?? combatant.maxHp) * 0.02) : 0);
  return damage ? applyDamageWithInjuries(combatant, damage, seed) : combatant;
}

/** maxHp is the effective battle cap; baseMaxHp never changes when effects expire. */
export function updateInjuryHpCap(combatant: CombatantState): CombatantState {
  const baseMaxHp = combatant.baseMaxHp ?? combatant.maxHp;
  const maxHp = hasInjury(combatant, "deepWound") ? Math.max(1, Math.floor(baseMaxHp * 0.9)) : baseMaxHp;
  return { ...combatant, baseMaxHp, maxHp, hp: Math.min(combatant.hp, maxHp) };
}

export function beginCombatantTurn(combatant: CombatantState): void {
  combatant.ap = Math.max(0, combatant.maxAp - (hasInjury(combatant, "chestWound") ? 1 : 0));
  delete combatant.healingUsedThisTurn;
  delete combatant.meleeAttackUsedThisTurn;
  delete combatant.attackedThisTurn;
  delete combatant.backInjuryMovementUsedThisTurn;
  combatant.movedHexesThisTurn = 0;
  combatant.thighWoundDamageThisTurn = 0;
  combatant.injuryAttemptedTargetsThisTurn = [];
  combatant.fullTurnInjuryKinds = (combatant.temporaryInjuries ?? []).map(effect => effect.kind);
}

export function applyTemporaryInjury(combatant: CombatantState, upgrade: WeaponInjuryUpgrade): CombatantState {
  const temporaryInjuries = (combatant.temporaryInjuries ?? []).map(effect => ({ ...effect }));
  const existing = temporaryInjuries.find(effect => effect.kind === upgrade.kind);
  const remainingTurns = upgrade.duration === "battle" ? null : upgrade.duration;
  if (existing) {
    existing.remainingTurns = existing.remainingTurns === null || remainingTurns === null ? null : Math.max(existing.remainingTurns, remainingTurns);
  } else {
    if (temporaryInjuries.length >= 3) return combatant;
    temporaryInjuries.push({ kind: upgrade.kind, remainingTurns });
  }
  return updateInjuryHpCap({ ...combatant, temporaryInjuries, fullTurnInjuryKinds: (combatant.fullTurnInjuryKinds ?? []).filter(kind => kind !== upgrade.kind) });
}

export function expireTurnInjuries(combatant: CombatantState): CombatantState {
  const fullTurns = new Set(combatant.fullTurnInjuryKinds ?? []);
  const temporaryInjuries = (combatant.temporaryInjuries ?? []).map(effect => ({ ...effect, remainingTurns: effect.remainingTurns === null ? null : effect.remainingTurns - (fullTurns.has(effect.kind) ? 1 : 0) })).filter(effect => effect.remainingTurns === null || effect.remainingTurns > 0);
  return updateInjuryHpCap({ ...combatant, temporaryInjuries });
}
