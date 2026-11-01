import type { InjuryKind } from "./battle";

export type InjurySeverity = 0 | 1 | 2;
export type InjuryDuration = 2 | 3 | 4 | 5 | "battle";

export interface WeaponInjuryUpgrade {
  kind: InjuryKind;
  chancePercent: number;
  duration: InjuryDuration;
}

/** Temporary combat effects are deliberately separate from persistent defeat injuries. */
export interface BattleInjuryEffect {
  kind: InjuryKind;
  remainingTurns: number | null;
}

export const INJURY_DEFINITIONS = [
  { id: "brokenArm", label: "Złamana ręka", severity: 2, description: "Atak dystansowy kosztuje o 1 PA więcej." },
  { id: "legTrauma", label: "Uraz nogi", severity: 2, description: "Ruch kosztuje 2 PA za pole." },
  { id: "bleeding", label: "Krwawienie", severity: 1, description: "Utrata 5 HP na koniec własnej tury." },
  { id: "concussion", label: "Wstrząśnienie", severity: 0, description: "Inicjatywa zmniejszona o 2." },
  { id: "chestWound", label: "Rana klatki piersiowej", severity: 2, description: "O 1 PA mniej na początku własnej tury." },
  { id: "burn", label: "Oparzenie", severity: 1, description: "Otrzymywane obrażenia ataków zwiększone o 10%." },
  { id: "poison", label: "Zatrucie", severity: 1, description: "Utrata 2% bazowego maksymalnego HP na koniec własnej tury." },
  { id: "dislocatedShoulder", label: "Zwichnięty bark", severity: 2, description: "Pierwszy atak wręcz w turze kosztuje o 1 PA więcej." },
  { id: "handInjury", label: "Uszkodzona dłoń", severity: 1, description: "Obrażenia ataków bronią zmniejszone o 15%." },
  { id: "eyeInjury", label: "Uszkodzone oko", severity: 0, description: "Zasięg ataków dystansowych zmniejszony do 5 pól." },
  { id: "tendonStrain", label: "Naderwane ścięgno", severity: 2, description: "Maksymalnie 3 pola ruchu we własnej turze." },
  { id: "thighWound", label: "Rana uda", severity: 1, description: "Ruch odbiera 2 HP za pole, maksymalnie 6 HP na turę." },
  { id: "abdominalWound", label: "Rana brzucha", severity: 1, description: "Otrzymywane leczenie zmniejszone o 25%." },
  { id: "backInjury", label: "Uraz pleców", severity: 1, description: "Pierwszy ruch po ataku kosztuje o 1 PA więcej." },
  { id: "deepWound", label: "Głęboka rana", severity: 1, description: "Maksymalne HP zmniejszone o 10% na czas urazu." }
] as const satisfies readonly { id: InjuryKind; label: string; severity: InjurySeverity; description: string }[];

export const INJURY_LABELS = Object.fromEntries(INJURY_DEFINITIONS.map(injury => [injury.id, injury.label])) as Record<InjuryKind, string>;

export function isInjuryKind(value: unknown): value is InjuryKind {
  return typeof value === "string" && INJURY_DEFINITIONS.some(injury => injury.id === value);
}

export function getInjuryDefinition(kind: InjuryKind) {
  const definition = INJURY_DEFINITIONS.find(injury => injury.id === kind);
  if (!definition) throw new Error("INVALID_INJURY_KIND");
  return definition;
}

export interface InjuryCarrier {
  injuries?: readonly InjuryKind[];
  temporaryInjuries?: readonly BattleInjuryEffect[];
}

export function getActiveInjuryKinds(combatant: InjuryCarrier): InjuryKind[] {
  return [...new Set([
    ...(combatant.injuries ?? []).filter(isInjuryKind),
    ...(combatant.temporaryInjuries ?? []).filter(effect => isInjuryKind(effect.kind) &&
      (effect.remainingTurns === null || Number.isSafeInteger(effect.remainingTurns) && effect.remainingTurns > 0))
      .map(effect => effect.kind)
  ])];
}

export function hasInjury(combatant: InjuryCarrier, kind: InjuryKind): boolean {
  return getActiveInjuryKinds(combatant).includes(kind);
}

export function formatInjuryDuration(duration: InjuryDuration): string {
  return duration === "battle" ? "do końca walki" : `${duration} ${duration === 5 ? "tur" : "tury"}`;
}

export function formatWeaponInjuryUpgrade(upgrade: WeaponInjuryUpgrade): string {
  return `${getInjuryDefinition(upgrade.kind).label} — ${upgrade.chancePercent}% szansy, ${formatInjuryDuration(upgrade.duration)}`;
}
