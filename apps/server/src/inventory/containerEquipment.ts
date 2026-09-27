import {
  BAG_EQUIPMENT_SLOTS,
  type BagEquipmentSlot,
  type EquipmentSnapshot,
  type InventorySnapshot
} from "@web-mmorpg/shared";

export { BAG_EQUIPMENT_SLOTS };
export type { BagEquipmentSlot };

export function setContainerSlot(
  equipment: EquipmentSnapshot,
  inventory: InventorySnapshot,
  slot: string,
  itemInstanceId: string | null
): EquipmentSnapshot {
  if (!isBagEquipmentSlot(slot)) throw new Error("INVALID_CONTAINER_SLOT");

  const bagEntries = equipment.items.filter((entry) =>
    isBagEquipmentSlot(entry.slot)
  );
  const otherEntries = equipment.items.filter((entry) =>
    !isBagEquipmentSlot(entry.slot)
  );

  if (itemInstanceId === null) {
    return {
      items: [
        ...otherEntries,
        ...bagEntries.filter((entry) => entry.slot !== slot)
      ]
    };
  }

  const item = inventory.items.find((candidate) =>
    candidate.instanceId === itemInstanceId
  );
  if (!item) throw new Error("CONTAINER_ITEM_NOT_FOUND");
  if (item.category !== "container") throw new Error("ITEM_IS_NOT_CONTAINER");

  return {
    items: [
      ...otherEntries,
      ...bagEntries.filter((entry) =>
        entry.slot !== slot && entry.itemInstanceId !== itemInstanceId
      ),
      { slot, itemInstanceId }
    ]
  };
}

export function isBagEquipmentSlot(value: string): value is BagEquipmentSlot {
  return (BAG_EQUIPMENT_SLOTS as readonly string[]).includes(value);
}
