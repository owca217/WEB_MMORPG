import { describe, expect, it } from "vitest";
import type { EquipmentSnapshot, InventoryItem } from "@web-mmorpg/shared";
import {
  createStarterContainer,
  STARTER_CONTAINER_CAPACITY,
  STARTER_CONTAINER_ITEM_ID
} from "../src/inventory/containers";
import {
  BAG_EQUIPMENT_SLOTS,
  setContainerSlot
} from "../src/inventory/containerEquipment";
import { InventoryService } from "../src/inventory/InventoryService";

function container(instanceId: string, itemId = "simple-bag"): InventoryItem {
  return {
    instanceId,
    itemId,
    name: "Zwykły worek",
    quantity: 1,
    category: "container",
    description: "Prosty worek na przedmioty.",
    containerCapacity: STARTER_CONTAINER_CAPACITY
  };
}

describe("container equipment", () => {
  it("creates a unique starter bag with eight places", () => {
    const first = createStarterContainer();
    const second = createStarterContainer();

    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.itemId).toBe(STARTER_CONTAINER_ITEM_ID);
    expect(first.category).toBe("container");
    expect(first.containerCapacity).toBe(8);
    expect(first.quantity).toBe(1);
  });

  it("equips a container into a bag slot and moves it from another bag slot", () => {
    const inventory = { items: [container("bag-1"), container("bag-2", "large-bag")] };
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

  it("rejects missing and non-container items", () => {
    const inventory = {
      items: [
        container("bag-1"),
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

  it("keeps separate container instances instead of stacking bags", () => {
    const inventory = new InventoryService();
    const definition = {
      itemId: STARTER_CONTAINER_ITEM_ID,
      name: "Zwykły worek",
      quantity: 1,
      category: "container" as const,
      description: "Prosty worek.",
      containerCapacity: STARTER_CONTAINER_CAPACITY
    };

    inventory.addItems("p1", [definition]);
    const snapshot = inventory.addItems("p1", [definition]);

    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items.every((item) => item.containerCapacity === 8)).toBe(true);

    const multiBag = inventory.addItems("p1", [{ ...definition, quantity: 2 }]);
    expect(multiBag.items).toHaveLength(4);
    expect(multiBag.items.every((item) => item.quantity === 1)).toBe(true);
  });
});
