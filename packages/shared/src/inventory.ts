import type { ItemInstanceId } from "./ids";
import type { ItemRarity } from "./items";
import type { ItemQuality } from "./itemQuality";
import type { EquipmentItemProperties, EquipmentSlot, EquipmentSlots } from "./equipment";

export type ItemCategory = string;

export const CONTAINER_SLOT_COUNT = 4;
export const CONTAINER_ITEM_CATEGORY = "container";
export const BATTLE_ITEM_AP_COST = 2;
export const PERMANENT_BACKPACK_SLOT_INDEX = 0;
export const PERMANENT_BACKPACK_CAPACITY = 16;
export const PERMANENT_BACKPACK_ITEM_ID = "permanent-backpack";
export const PERMANENT_BACKPACK_NAME = "Plecak podróżnika";
export const PERMANENT_BACKPACK_ICON_PATH = "assets/items/permanent-backpack.png";

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
  quality?: ItemQuality;
  durability?: number;
  maxDurability?: number;
  upgradeLevel: number;
  boundToPlayerId?: string;
  containerInstanceId?: ItemInstanceId;
  containerCapacity?: number;
  permanentContainer?: boolean;
  consumableEffects?: ConsumableEffects;
  equipment?: EquipmentItemProperties;
  equippedSlot?: EquipmentSlot;
}

export interface InventorySnapshot {
  items: InventoryItem[];
  containerSlots?: ContainerSlots;
  equipmentSlots?: EquipmentSlots;
}

/** Owned overflow is durable and remains accessible until a container has room. */
export function getPendingInventoryItems(snapshot: InventorySnapshot): InventoryItem[] {
  const assigned = new Set(snapshot.containerSlots?.filter(id => id !== null));
  return snapshot.items.filter(item => !item.containerInstanceId && !item.equippedSlot
    && !item.permanentContainer && !assigned.has(item.instanceId));
}

export type InventoryUpdateResult =
  | { ok: true; inventory: InventorySnapshot }
  | { ok: false; code: string; message: string };

export type SetContainerSlotResult = InventoryUpdateResult;
