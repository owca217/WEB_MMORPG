import type { ItemInstanceId } from "./ids";
import type { ItemRarity } from "./items";

export type ItemCategory = string;

export interface InventoryItem {
  instanceId: ItemInstanceId;
  itemId: string;
  itemDefinitionId: string;
  name: string;
  quantity: number;
  category: ItemCategory;
  description: string;
  iconUrl?: string;
  rarity: ItemRarity;
  durability?: number;
  maxDurability?: number;
  upgradeLevel: number;
  boundToPlayerId?: string;
}

export interface InventorySnapshot {
  items: InventoryItem[];
}
