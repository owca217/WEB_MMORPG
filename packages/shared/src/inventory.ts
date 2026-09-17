import type { ItemInstanceId } from "./ids";

export interface InventoryItem {
  instanceId: ItemInstanceId;
  itemId: string;
  name: string;
  quantity: number;
}

export interface InventorySnapshot {
  items: InventoryItem[];
}
