import { describe, expect, it } from "vitest";
import type { EquipmentSnapshot, InventoryItem } from "@web-mmorpg/shared";
import { BAG_DEFINITIONS, type BagItemId } from "@web-mmorpg/shared";
import {
  createBagItem,
  createStarterContainer,
  STARTER_CONTAINER_CAPACITY,
  STARTER_CONTAINER_ITEM_ID
} from "../src/inventory/containers";
import {
  BAG_EQUIPMENT_SLOTS,
  setContainerSlot
} from "../src/inventory/containerEquipment";

function bag(instanceId: string, itemId: BagItemId = "simple-bag"): InventoryItem {
  const definition = BAG_DEFINITIONS[itemId];
  return {
    instanceId,
    itemId,
    name: definition.name,
    quantity: 1,
    category: "bag",
    description: definition.description,
    containerCapacity: definition.capacity
  };
}

describe("bag equipment", () => {
  it("creates a unique starter bag with eight places", () => {
    const first = createBagItem("simple-bag");
    const second = createStarterContainer();

    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.itemId).toBe(STARTER_CONTAINER_ITEM_ID);
    expect(first.category).toBe("bag");
    expect(first.containerCapacity).toBe(8);
    expect(first.quantity).toBe(1);
  });

  it("equips a container into a bag slot and moves it from another bag slot", () => {
    const inventory = { items: [bag("bag-1"), bag("bag-2", "traditional-backpack")] };
    const equipment: EquipmentSnapshot = {
      items: [{ slot: BAG_EQUIPMENT_SLOTS[0], itemInstanceId: "bag-1" }]
    };

    const moved = setContainerSlot(
      equipment,
      inventory,
      BAG_EQUIPMENT_SLOTS[1],
      "bag-1"
    );

    expect(moved.items).toEqual([
      { slot: BAG_EQUIPMENT_SLOTS[1], itemInstanceId: "bag-1" }
    ]);
  });

  it("rejects missing bags and non-bag items", () => {
    const inventory = {
      items: [
        bag("bag-1"),
        {
          instanceId: "sword-1",
          itemId: "iron-sword",
          name: "Żelazny miecz",
          quantity: 1,
          category: "weapon" as const,
          description: "Miecz."
        }
      ]
    };

    expect(() => setContainerSlot({ items: [] }, inventory, "bag-1", "missing"))
      .toThrow("CONTAINER_ITEM_NOT_FOUND");
    expect(() => setContainerSlot({ items: [] }, inventory, "bag-1", "sword-1"))
      .toThrow("ITEM_IS_NOT_CONTAINER");
  });

});
