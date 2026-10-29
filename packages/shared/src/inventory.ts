import type { ItemInstanceId } from "./ids";
import type { ItemRarity } from "./items";

export type ItemCategory = string;

export const CONTAINER_SLOT_COUNT = 4;
export const CONTAINER_ITEM_CATEGORY = "container";
export const BATTLE_ITEM_AP_COST = 2;

export interface ConsumableEffects {
  healHp?: number;
  restoreAp?: number;
}

export type ContainerSlotIndex = 0 | 1 | 2 | 3;
export type ContainerSlots = [
  ItemInstanceId | null,
  ItemInstanceId | null,
  ItemInstanceId | null,
  ItemInstanceId | null
];

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
  containerInstanceId?: ItemInstanceId;
  containerCapacity?: number;
  consumableEffects?: ConsumableEffects;
}

export interface InventorySnapshot {
  items: InventoryItem[];
  containerSlots?: ContainerSlots;
}

export type InventoryUpdateResult =
  | { ok: true; inventory: InventorySnapshot }
  | { ok: false; code: string; message: string };

export type SetContainerSlotResult = InventoryUpdateResult;
