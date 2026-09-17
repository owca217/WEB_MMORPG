import type { LootItemDefinition } from "../inventory/InventoryService";

export class LootService {
  rollEncounterLoot(encounterId: string, _seed: number): LootItemDefinition[] {
    if (encounterId !== "wolf-pack-01") return [];

    return [
      { itemId: "wolf-pelt", name: "Wolf Pelt", quantity: 1 },
      { itemId: "field-bandage", name: "Field Bandage", quantity: 2 }
    ];
  }
}
