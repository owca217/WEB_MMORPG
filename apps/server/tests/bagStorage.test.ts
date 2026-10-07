import { describe, expect, it } from "vitest";
import type { InventoryItem, InventorySnapshot } from "@web-mmorpg/shared";
import { moveItemToContainer } from "../src/inventory/bagStorage";

function bag(instanceId: string, capacity = 2): InventoryItem {
  return {
    instanceId,
    itemId: "simple-bag",
    name: "Zwykły worek",
    quantity: 1,
    category: "bag",
    description: "Worek.",
    containerCapacity: capacity
  };
}

function material(instanceId: string, quantity = 1, containerInstanceId?: string): InventoryItem {
  return {
    instanceId,
    itemId: `material-${instanceId}`,
    name: "Materiał",
    quantity,
    category: "material",
    description: "Materiał.",
    ...(containerInstanceId === undefined ? {} : { containerInstanceId })
  };
}

describe("bag storage transfers", () => {
  it("moves a general inventory item into a bag without mutating the source snapshot", () => {
    const original: InventorySnapshot = {
      items: [bag("bag-1"), material("pelt-1")]
    };

    const moved = moveItemToContainer(original, "pelt-1", "bag-1");

    expect(moved.items.find((item) => item.instanceId === "pelt-1"))
      .toMatchObject({ containerInstanceId: "bag-1" });
    expect(original.items.find((item) => item.instanceId === "pelt-1"))
      .not.toHaveProperty("containerInstanceId");
  });

  it("moves a stored item back into general inventory", () => {
    const original: InventorySnapshot = {
      items: [bag("bag-1"), material("pelt-1", 1, "bag-1")]
    };

    const moved = moveItemToContainer(original, "pelt-1", null);

    expect(moved.items.find((item) => item.instanceId === "pelt-1"))
      .not.toHaveProperty("containerInstanceId");
    expect(original.items.find((item) => item.instanceId === "pelt-1"))
      .toMatchObject({ containerInstanceId: "bag-1" });
  });

  it("rejects a full bag without changing the source item", () => {
    const original: InventorySnapshot = {
      items: [bag("bag-1", 1), material("already-stored", 1, "bag-1"), material("pelt-1")]
    };

    expect(() => moveItemToContainer(original, "pelt-1", "bag-1"))
      .toThrow("BAG_IS_FULL");
    expect(original.items.find((item) => item.instanceId === "pelt-1"))
      .not.toHaveProperty("containerInstanceId");
  });

  it("rejects an unknown source item", () => {
    expect(() => moveItemToContainer({ items: [bag("bag-1")] }, "missing", "bag-1"))
      .toThrow("SOURCE_ITEM_NOT_FOUND");
  });

  it("rejects unknown and non-bag destinations", () => {
    const snapshot: InventorySnapshot = {
      items: [bag("bag-1"), material("pelt-1"), {
        instanceId: "sword-1",
        itemId: "iron-sword",
        name: "Żelazny miecz",
        quantity: 1,
        category: "weapon",
        description: "Miecz."
      }]
    };

    expect(() => moveItemToContainer(snapshot, "pelt-1", "missing-bag"))
      .toThrow("DESTINATION_BAG_NOT_FOUND");
    expect(() => moveItemToContainer(snapshot, "pelt-1", "sword-1"))
      .toThrow("DESTINATION_IS_NOT_BAG");
  });

  it("rejects storing a bag inside another bag", () => {
    expect(() => moveItemToContainer(
      { items: [bag("outer-bag"), bag("inner-bag")] },
      "inner-bag",
      "outer-bag"
    )).toThrow("BAGS_CANNOT_BE_NESTED");
  });

  it("treats a request to stay in the same bag as a no-op even when it is full", () => {
    const snapshot: InventorySnapshot = {
      items: [bag("bag-1", 1), material("pelt-1", 1, "bag-1")]
    };

    expect(moveItemToContainer(snapshot, "pelt-1", "bag-1")).toEqual(snapshot);
  });

  it("counts a stack as one occupied slot regardless of its quantity", () => {
    const snapshot: InventorySnapshot = {
      items: [bag("bag-1", 2), material("stack", 20, "bag-1"), material("other")]
    };

    const moved = moveItemToContainer(snapshot, "other", "bag-1");
    expect(moved.items.filter((item) => item.containerInstanceId === "bag-1"))
      .toHaveLength(2);
    expect(moved.items.find((item) => item.instanceId === "stack")?.quantity).toBe(20);
  });
});
