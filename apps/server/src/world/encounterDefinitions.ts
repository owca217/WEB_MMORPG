import type { EncounterSnapshot, LocationId } from "@web-mmorpg/shared";

export interface EncounterDefinition {
  id: string;
  locationId: LocationId;
  enemyKind: NonNullable<EncounterSnapshot["enemyKind"]>;
  enemyName: string;
  minimumLevel: number;
  baseHp: number;
  hpPerLevel: number;
  baseDamage: number;
  damagePerLevel: number;
  baseArmor: number;
  armorPerLevel: number;
  goldReward: number;
  respawnMs?: number;
}

export const LEGACY_WOLF_DEFINITION: EncounterDefinition = {
  id: "wolf-pack-01", locationId: "forest-settlement-01", enemyKind: "wolf", enemyName: "Wolf",
  minimumLevel: 1, baseHp: 120, hpPerLevel: 28, baseDamage: 10, damagePerLevel: 2,
  baseArmor: 0, armorPerLevel: 1.5, goldReward: 15
};

const FOREST_RESPAWN_MS = 180000;
const FOREST_BOAR: Omit<EncounterDefinition, "id"> = {
  locationId: "eastern-forest-01", enemyKind: "boar", enemyName: "Dzik", minimumLevel: 3,
  baseHp: 140, hpPerLevel: 30, baseDamage: 12, damagePerLevel: 2,
  baseArmor: 2, armorPerLevel: 1.5, goldReward: 18, respawnMs: FOREST_RESPAWN_MS
};

export const ENCOUNTER_DEFINITIONS: readonly EncounterDefinition[] = [
  LEGACY_WOLF_DEFINITION,
  { id: "forest-boars-01", ...FOREST_BOAR },
  {
    id: "forest-spiders-01", locationId: "eastern-forest-01", enemyKind: "forest-spider", enemyName: "Pająk leśny",
    minimumLevel: 4, baseHp: 95, hpPerLevel: 22, baseDamage: 9, damagePerLevel: 2,
    baseArmor: 0, armorPerLevel: 1.2, goldReward: 20, respawnMs: FOREST_RESPAWN_MS
  },
  {
    id: "forest-wolves-01", locationId: "eastern-forest-01", enemyKind: "wolf", enemyName: "Wilk leśny",
    minimumLevel: 5, baseHp: 130, hpPerLevel: 28, baseDamage: 11, damagePerLevel: 2,
    baseArmor: 0, armorPerLevel: 1.5, goldReward: 25, respawnMs: FOREST_RESPAWN_MS
  },
  { id: "forest-boars-02", ...FOREST_BOAR }
];

export function getEncounterDefinition(id: string): EncounterDefinition | undefined {
  const definition = ENCOUNTER_DEFINITIONS.find(encounter => encounter.id === id);
  return definition ? { ...definition } : undefined;
}
