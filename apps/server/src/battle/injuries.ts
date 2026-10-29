import type { CombatStatistics, HexCoord, InjuryKind, PlayerId } from "@web-mmorpg/shared";
export { movementApCost, rangedAttackApCost } from "@web-mmorpg/shared";

export interface CombatantState {
  id: string;
  ownerPlayerId?: PlayerId;
  side: "player" | "enemy";
  name: string;
  level?: number;
  combatStats?: CombatStatistics;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  initiative: number;
  position: HexCoord;
  severelyInjured: boolean;
  injuries: InjuryKind[];
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
  return combatant.initiative - (combatant.injuries.includes("concussion") ? 2 : 0);
}

export function applyEndTurnInjuries(combatant: CombatantState, seed: number): CombatantState {
  if (!combatant.injuries.includes("bleeding") || combatant.hp <= 0) return combatant;
  return applyDamageWithInjuries(combatant, 5, seed);
}
