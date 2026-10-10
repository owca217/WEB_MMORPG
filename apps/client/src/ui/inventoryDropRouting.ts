import type { BagEquipmentSlot } from "@web-mmorpg/shared";

export interface InventoryDropItem {
  itemInstanceId: string;
  isBag: boolean;
  sourceSlot?: BagEquipmentSlot;
}

export type InventoryDropTarget =
  | { type: "general" }
  | { type: "bag-content"; containerInstanceId: string }
  | {
      type: "bag-slot";
      slot: BagEquipmentSlot;
      containerInstanceId: string | null;
    };

export type InventoryDropAction =
  | { type: "move-item"; itemInstanceId: string; containerInstanceId: string | null }
  | { type: "equip-bag"; slot: BagEquipmentSlot; itemInstanceId: string }
  | { type: "unequip-bag"; slot: BagEquipmentSlot };

export function resolveInventoryDropAction(
  item: InventoryDropItem,
  target: InventoryDropTarget
): InventoryDropAction | null {
  if (target.type === "general") {
    if (item.sourceSlot) return { type: "unequip-bag", slot: item.sourceSlot };
    if (item.isBag) return null;
    return {
      type: "move-item",
      itemInstanceId: item.itemInstanceId,
      containerInstanceId: null
    };
  }

  if (target.type === "bag-content") {
    if (item.isBag || item.sourceSlot) return null;
    return {
      type: "move-item",
      itemInstanceId: item.itemInstanceId,
      containerInstanceId: target.containerInstanceId
    };
  }

  if (item.isBag) {
    return {
      type: "equip-bag",
      slot: target.slot,
      itemInstanceId: item.itemInstanceId
    };
  }

  if (!target.containerInstanceId) return null;
  return {
    type: "move-item",
    itemInstanceId: item.itemInstanceId,
    containerInstanceId: target.containerInstanceId
  };
}
