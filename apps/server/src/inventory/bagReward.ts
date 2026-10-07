import {
  BAG_EQUIPMENT_SLOTS,
  type EquipmentSnapshot,
  type InventoryItem,
  type InventorySnapshot
} from "@web-mmorpg/shared";

export function placeBagReward(
  inventory: InventorySnapshot,
  equipment: EquipmentSnapshot,
  reward: InventoryItem
): { inventory: InventorySnapshot; equipment: EquipmentSnapshot } {
  const nextInventory = { items: [...inventory.items, reward] };
  const anyBagEquipped = equipment.items.some((entry) =>
    BAG_EQUIPMENT_SLOTS.some((slot) => slot === entry.slot)
  );

  return {
    inventory: nextInventory,
    equipment: anyBagEquipped
      ? equipment
      : {
          items: [
            ...equipment.items,
            { slot: BAG_EQUIPMENT_SLOTS[0], itemInstanceId: reward.instanceId }
          ]
        }
  };
}
