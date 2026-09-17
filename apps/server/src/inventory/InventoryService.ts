import { randomUUID } from "node:crypto";
import type {
  InventoryItem,
  InventorySnapshot,
  PlayerId
} from "@web-mmorpg/shared";

export interface LootItemDefinition {
  itemId: string;
  name: string;
  quantity: number;
}

export class InventoryService {
  private readonly inventories = new Map<PlayerId, InventoryItem[]>();

  addItems(playerId: PlayerId, items: LootItemDefinition[]): InventorySnapshot {
    const inventory = this.inventories.get(playerId) ?? [];

    for (const item of items) {
      const existing = inventory.find((entry) => entry.itemId === item.itemId);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        inventory.push({
          instanceId: randomUUID(),
          itemId: item.itemId,
          name: item.name,
          quantity: item.quantity
        });
      }
    }

    this.inventories.set(playerId, inventory);
    return this.getSnapshot(playerId);
  }

  getSnapshot(playerId: PlayerId): InventorySnapshot {
    return {
      items: (this.inventories.get(playerId) ?? []).map((item) => ({ ...item }))
    };
  }
}
