import { randomUUID } from "node:crypto";
import type {
  InventoryItem,
  InventorySnapshot,
  ItemCategory,
  PlayerId
} from "@web-mmorpg/shared";

export interface LootItemDefinition {
  itemId: string;
  name: string;
  quantity: number;
  category: ItemCategory;
  description: string;
  containerCapacity?: number;
}

export class InventoryService {
  private readonly inventories = new Map<PlayerId, InventoryItem[]>();

  addItems(playerId: PlayerId, items: LootItemDefinition[]): InventorySnapshot {
    const inventory = this.inventories.get(playerId) ?? [];

    for (const item of items) {
      if (item.category === "container") {
        for (let index = 0; index < item.quantity; index += 1) {
          inventory.push({
            instanceId: randomUUID(),
            itemId: item.itemId,
            name: item.name,
            quantity: 1,
            category: item.category,
            description: item.description,
            ...(item.containerCapacity === undefined
              ? {}
              : { containerCapacity: item.containerCapacity })
          });
        }
        continue;
      }

      const existing = inventory.find((entry) => entry.itemId === item.itemId);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        inventory.push({
          instanceId: randomUUID(),
          itemId: item.itemId,
          name: item.name,
          quantity: item.quantity,
          category: item.category,
          description: item.description,
          ...(item.containerCapacity === undefined
            ? {}
            : { containerCapacity: item.containerCapacity })
        });
      }
    }

    this.inventories.set(playerId, inventory);
    return this.getSnapshot(playerId);
  }

  hydratePlayer(
    playerId: PlayerId,
    snapshot: InventorySnapshot
  ): InventorySnapshot {
    this.inventories.set(
      playerId,
      snapshot.items.map((item) => ({ ...item }))
    );
    return this.getSnapshot(playerId);
  }

  getSnapshot(playerId: PlayerId): InventorySnapshot {
    return {
      items: (this.inventories.get(playerId) ?? []).map((item) => ({ ...item }))
    };
  }

  removePlayer(playerId: PlayerId): void {
    this.inventories.delete(playerId);
  }
}
