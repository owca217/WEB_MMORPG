import { randomUUID } from "node:crypto";
import type { InventoryItem } from "@web-mmorpg/shared";
import {
  BAG_DEFINITIONS,
  type BagItemId,
  STARTER_CONTAINER_CAPACITY,
  STARTER_CONTAINER_ITEM_ID,
  STARTER_CONTAINER_NAME
} from "@web-mmorpg/shared";

export {
  STARTER_CONTAINER_CAPACITY,
  STARTER_CONTAINER_ITEM_ID,
  STARTER_CONTAINER_NAME
};

export function createBagItem(itemId: BagItemId): InventoryItem {
  const definition = BAG_DEFINITIONS[itemId];
  return {
    instanceId: randomUUID(),
    itemId,
    name: definition.name,
    quantity: 1,
    category: "bag",
    description: definition.description,
    containerCapacity: definition.capacity
  };
}

export function createStarterContainer(): InventoryItem {
  return createBagItem(STARTER_CONTAINER_ITEM_ID);
}
