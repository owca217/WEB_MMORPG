import { describe, expect, it } from "vitest";
import {
  BAG_DEFINITIONS,
  ITEM_DEFINITIONS,
  adminItemDefinition,
  type AdminItemCatalog
} from "./index";

describe("shared item catalog", () => {
  it("contains every item currently available to the game", () => {
    expect(ITEM_DEFINITIONS.map((item) => item.itemId)).toEqual([
      "simple-bag",
      "traditional-backpack",
      "travel-backpack",
      "expedition-backpack",
      "wolf-pelt",
      "field-bandage"
    ]);
  });

  it("keeps bag capacities aligned with the bag definitions", () => {
    for (const itemId of [
      "simple-bag",
      "traditional-backpack",
      "travel-backpack",
      "expedition-backpack"
    ] as const) {
      expect(adminItemDefinition(itemId)?.containerCapacity).toBe(
        BAG_DEFINITIONS[itemId].capacity
      );
    }
  });

  it("returns null for an unknown item id", () => {
    expect(adminItemDefinition("missing-item")).toBeNull();
  });

  it("exposes a catalog payload shape for the admin socket event", () => {
    const catalog: AdminItemCatalog = { items: ITEM_DEFINITIONS };
    expect(catalog.items).toHaveLength(6);
  });
});
