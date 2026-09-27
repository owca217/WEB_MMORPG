import type { ItemInstanceId } from "./ids";

export type ItemCategory =
  | "material"
  | "medical"
  | "armor"
  | "weapon"
  | "accessory"
  | "container";

export const BAG_EQUIPMENT_SLOTS = ["bag-1", "bag-2", "bag-3", "bag-4"] as const;
export type BagEquipmentSlot = (typeof BAG_EQUIPMENT_SLOTS)[number];

export const STARTER_CONTAINER_ITEM_ID = "simple-bag";
export const STARTER_CONTAINER_NAME = "Zwykły worek";
export const STARTER_CONTAINER_CAPACITY = 8;

export interface InventoryItem {
  instanceId: ItemInstanceId;
  itemId: string;
  name: string;
  quantity: number;
  category: ItemCategory;
  description: string;
  containerCapacity?: number;
}

export interface InventorySnapshot {
  items: InventoryItem[];
}

export interface EquipmentEntry {
  slot: string;
  itemInstanceId: ItemInstanceId;
}

export interface EquipmentSnapshot {
  items: EquipmentEntry[];
}
