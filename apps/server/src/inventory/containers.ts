import { randomUUID } from "node:crypto";
import type { InventoryItem } from "@web-mmorpg/shared";
import {
  STARTER_CONTAINER_CAPACITY,
  STARTER_CONTAINER_ITEM_ID,
  STARTER_CONTAINER_NAME
} from "@web-mmorpg/shared";

export {
  STARTER_CONTAINER_CAPACITY,
  STARTER_CONTAINER_ITEM_ID,
  STARTER_CONTAINER_NAME
};

export function createStarterContainer(): InventoryItem {
  return {
    instanceId: randomUUID(),
    itemId: STARTER_CONTAINER_ITEM_ID,
    name: STARTER_CONTAINER_NAME,
    quantity: 1,
    category: "container",
    description: "Prosty worek mieszczący osiem przedmiotów.",
    containerCapacity: STARTER_CONTAINER_CAPACITY
  };
}
