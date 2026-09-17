import type { ItemInstanceId } from "./ids";

export type ItemCategory = "material" | "medical";

export interface InventoryItem {
  instanceId: ItemInstanceId;
  itemId: string;
  name: string;
  quantity: number;
  category: ItemCategory;
  description: string;
}

export interface InventorySnapshot {
  items: InventoryItem[];
}
