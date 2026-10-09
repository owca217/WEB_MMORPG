import type { InventoryReward } from "../inventory/InventoryService";

export class LootService {
  rollEncounterLoot(encounterId: string, _seed: number): InventoryReward[] {
    if (encounterId !== "wolf-pack-01") return [];

    return [
      { itemId: "wolf-pelt", quantity: 1 },
      { itemId: "field-bandage", quantity: 2 }
    ];
  }
}
