import { describe, expect, it } from "vitest";
import type { InventoryItem, InventorySnapshot } from "@web-mmorpg/shared";
import { getInventoryView } from "../src/ui/inventoryViewModel";

function item(
  instanceId: string,
  category: InventoryItem["category"],
  containerInstanceId?: string
): InventoryItem {
  return {
    instanceId,
    itemId: instanceId === "bag-1" || instanceId === "bag-2" ? "simple-bag" : instanceId,
    name: instanceId,
    quantity: 1,
    category,
    description: "Test item.",
    ...(category === "bag" ? { containerCapacity: 8 } : {}),
    ...(containerInstanceId === undefined ? {} : { containerInstanceId })
  };
}

describe("inventory view model", () => {
  it("keeps stored items out of the general inventory and lists selected bag contents", () => {
    const snapshot: InventorySnapshot = {
      items: [
        item("bag-1", "bag"),
        item("coin-1", "material"),
        item("pelt-1", "material", "bag-1")
      ]
    };

    const view = getInventoryView(snapshot, "bag-1");

    expect(view.generalItems.map((entry) => entry.instanceId)).toEqual(["bag-1", "coin-1"]);
    expect(view.selectedBag?.instanceId).toBe("bag-1");
    expect(view.bagContents.map((entry) => entry.instanceId)).toEqual(["pelt-1"]);
  });

  it("does not display a bag as an item stored inside another bag", () => {
    const snapshot: InventorySnapshot = {
      items: [
        item("bag-1", "bag"),
        item("nested-bag", "bag", "bag-1"),
        item("pelt-1", "material", "bag-1")
      ]
    };

    const view = getInventoryView(snapshot, "bag-1");

    expect(view.bagContents.map((entry) => entry.instanceId)).toEqual(["pelt-1"]);
    expect(view.generalItems.map((entry) => entry.instanceId)).toContain("nested-bag");
  });

  it("reports occupied and empty slots from the selected bag capacity", () => {
    const snapshot: InventorySnapshot = {
      items: [
        item("bag-1", "bag"),
        item("pelt-1", "material", "bag-1"),
        item("pelt-2", "material", "bag-1")
      ]
    };

    const view = getInventoryView(snapshot, "bag-1");

    expect(view).toMatchObject({ occupiedSlots: 2, capacity: 8, emptySlots: 6 });
  });

  it.each([
    [8, [4, 4], 4, 2, false, 230],
    [13, [5, 4, 4], 5, 3, false, 256],
    [20, [5, 5, 5, 5], 5, 4, false, 256],
    [25, [5, 5, 5, 5, 5], 5, 5, false, 256],
    [26, [5, 5, 4, 4, 4, 4], 5, 5, true, 256],
    [40, [5, 5, 5, 5, 5, 5, 5, 5], 5, 5, true, 256],
    [60, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 5, 5, true, 256]
  ])("balances a %i-slot bag into rows %j, showing %i columns and %i rows (scrollable: %s)", (capacity, rowSizes, columns, visibleRows, isScrollable, windowWidth) => {
    const snapshot: InventorySnapshot = {
      items: [{ ...item("bag-1", "bag"), containerCapacity: capacity }]
    };

    expect(getInventoryView(snapshot, "bag-1")).toMatchObject({
      rowSizes,
      columns,
      visibleRows,
      isScrollable,
      windowWidth
    });
  });

  it("returns an empty bag view when no valid bag is selected", () => {
    const view = getInventoryView({ items: [item("bag-1", "bag")] }, "missing-bag");
    expect(view.selectedBag).toBeNull();
    expect(view.bagContents).toEqual([]);
    expect(view).toMatchObject({ occupiedSlots: 0, capacity: 0, emptySlots: 0 });
  });
});
