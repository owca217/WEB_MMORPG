import { CONTAINER_ITEM_CATEGORY, PERMANENT_BACKPACK_CAPACITY, PERMANENT_BACKPACK_SLOT_INDEX, type InventoryItem, type InventorySnapshot } from "@web-mmorpg/shared";

export function getPermanentBackpack(inventory: InventorySnapshot): InventoryItem | undefined {
  const instanceId=inventory.containerSlots?.[PERMANENT_BACKPACK_SLOT_INDEX];
  return inventory.items.find(item=>item.instanceId===instanceId && item.permanentContainer===true
    && item.category===CONTAINER_ITEM_CATEGORY && item.quantity===1 && !item.containerInstanceId
    && item.containerCapacity===PERMANENT_BACKPACK_CAPACITY);
}
