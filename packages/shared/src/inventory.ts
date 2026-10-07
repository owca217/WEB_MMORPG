import type { ItemInstanceId } from "./ids";

export type ItemCategory =
  | "material"
  | "medical"
  | "armor"
  | "weapon"
  | "accessory"
  | "bag";

export interface BagDefinition {
  name: string;
  capacity: number;
  description: string;
}

export const BAG_DEFINITIONS = {
  "simple-bag": {
    name: "Zwykły worek",
    capacity: 8,
    description: "Prosty worek mieszczący osiem przedmiotów."
  },
  "traditional-backpack": {
    name: "Tradycyjny plecak",
    capacity: 20,
    description: "Pojemny plecak mieszczący dwadzieścia przedmiotów."
  },
  "travel-backpack": {
    name: "Plecak podróżny",
    capacity: 40,
    description: "Plecak podróżny mieszczący czterdzieści przedmiotów."
  },
  "expedition-backpack": {
    name: "Plecak ekspedycyjny",
    capacity: 60,
    description: "Duży plecak na sześćdziesiąt przedmiotów."
  }
} as const satisfies Record<string, BagDefinition>;

export type BagItemId = keyof typeof BAG_DEFINITIONS;

export const BAG_EQUIPMENT_SLOTS = ["bag-1", "bag-2", "bag-3", "bag-4"] as const;
export type BagEquipmentSlot = (typeof BAG_EQUIPMENT_SLOTS)[number];

export const STARTER_CONTAINER_ITEM_ID: BagItemId = "simple-bag";
export const STARTER_CONTAINER_NAME = BAG_DEFINITIONS[STARTER_CONTAINER_ITEM_ID].name;
export const STARTER_CONTAINER_CAPACITY = BAG_DEFINITIONS[STARTER_CONTAINER_ITEM_ID].capacity;

export interface InventoryItem {
  instanceId: ItemInstanceId;
  itemId: string;
  name: string;
  quantity: number;
  category: ItemCategory;
  description: string;
  containerCapacity?: number;
  containerInstanceId?: ItemInstanceId;
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
