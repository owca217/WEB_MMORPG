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
import { InventoryService } from "../src/inventory/InventoryService";

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

  it("creates each bag as a separate non-stackable item", () => {
    const inventory = new InventoryService();

    for (const [itemId, definition] of Object.entries(BAG_DEFINITIONS)) {
      const before = inventory.getSnapshot("p1").items.length;
      const created = inventory.addItems("p1", [{
        itemId,
        name: definition.name,
        quantity: 2,
        category: "bag",
        description: definition.description,
        containerCapacity: definition.capacity
      }]);
      const added = created.items.slice(before);

      expect(added).toHaveLength(2);
      expect(added.every((item) => item.quantity === 1)).toBe(true);
      expect(new Set(added.map((item) => item.instanceId)).size).toBe(2);
      expect(added.every((item) => item.category === "bag")).toBe(true);
    }
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

  it("keeps separate bag instances instead of stacking them", () => {
    const inventory = new InventoryService();
    const definition = {
      itemId: STARTER_CONTAINER_ITEM_ID,
      name: "Zwykły worek",
      quantity: 1,
      category: "bag" as const,
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
