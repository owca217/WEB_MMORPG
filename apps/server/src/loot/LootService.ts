import type { InventoryReward } from "../inventory/InventoryService";
import { getEncounterDefinition } from "../world/encounterDefinitions";

export class LootService {
  rollEncounterLoot(encounterId: string, _seed: number): InventoryReward[] {
    const definition = getEncounterDefinition(encounterId);
    if (!definition) return [];
    if (definition.enemyId) return [];

    return [
      ...(definition.enemyKind === "wolf" ? [{ itemId: "wolf-pelt", quantity: 1 }] : []),
      { itemId: "field-bandage", quantity: 2 }
    ];
  }
}
