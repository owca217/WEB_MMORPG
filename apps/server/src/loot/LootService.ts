import type { LootItemDefinition } from "../inventory/InventoryService";
import { adminItemDefinition } from "@web-mmorpg/shared";

export class LootService {
  rollEncounterLoot(encounterId: string, _seed: number): LootItemDefinition[] {
    if (encounterId !== "wolf-pack-01") return [];

    const wolfPelt = adminItemDefinition("wolf-pelt");
    const fieldBandage = adminItemDefinition("field-bandage");
    if (!wolfPelt || !fieldBandage) return [];

    return [
      { ...wolfPelt, quantity: 1 },
      { ...fieldBandage, quantity: 2 }
    ];
  }
}
