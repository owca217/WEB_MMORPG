import { describe, expect, it } from "vitest";
import { resolveInventoryDropAction } from "../src/ui/inventoryDropRouting";

describe("inventory drop routing", () => {
  it("moves an ordinary inventory item into the equipped bag dropped on", () => {
    expect(resolveInventoryDropAction(
      { itemInstanceId: "pelt-1", isBag: false },
      { type: "bag-slot", slot: "bag-1", containerInstanceId: "bag-1" }
    )).toEqual({
      type: "move-item",
      itemInstanceId: "pelt-1",
      containerInstanceId: "bag-1"
    });
  });

  it("moves a stored item back to general inventory", () => {
    expect(resolveInventoryDropAction(
      { itemInstanceId: "pelt-1", isBag: false },
      { type: "general" }
    )).toEqual({
      type: "move-item",
      itemInstanceId: "pelt-1",
      containerInstanceId: null
    });
  });

  it("moves items between equipped bags by dropping onto a bag slot", () => {
    expect(resolveInventoryDropAction(
      { itemInstanceId: "pelt-1", isBag: false },
      { type: "bag-slot", slot: "bag-2", containerInstanceId: "bag-2" }
    )).toEqual({
      type: "move-item",
      itemInstanceId: "pelt-1",
      containerInstanceId: "bag-2"
    });
  });

  it("moves an item into the selected bag contents area", () => {
    expect(resolveInventoryDropAction(
      { itemInstanceId: "pelt-1", isBag: false },
      { type: "bag-content", containerInstanceId: "bag-2" }
    )).toEqual({
      type: "move-item",
      itemInstanceId: "pelt-1",
      containerInstanceId: "bag-2"
    });
  });

  it("equips a bag dropped onto a bag equipment slot", () => {
    expect(resolveInventoryDropAction(
      { itemInstanceId: "bag-2", isBag: true },
      { type: "bag-slot", slot: "bag-1", containerInstanceId: "bag-1" }
    )).toEqual({
      type: "equip-bag",
      slot: "bag-1",
      itemInstanceId: "bag-2"
    });
  });

  it("unequips an equipped bag dropped on the general inventory target", () => {
    expect(resolveInventoryDropAction(
      { itemInstanceId: "bag-1", isBag: true, sourceSlot: "bag-1" },
      { type: "general" }
    )).toEqual({ type: "unequip-bag", slot: "bag-1" });
  });

  it("ignores ordinary items dropped on an empty bag slot", () => {
    expect(resolveInventoryDropAction(
      { itemInstanceId: "pelt-1", isBag: false },
      { type: "bag-slot", slot: "bag-1", containerInstanceId: null }
    )).toBeNull();
  });

  it("treats a bag dropped on a bag slot as an equipment change", () => {
    expect(resolveInventoryDropAction(
      { itemInstanceId: "bag-2", isBag: true },
      { type: "bag-slot", slot: "bag-1", containerInstanceId: "bag-1" }
    )?.type).toBe("equip-bag");

    expect(resolveInventoryDropAction(
      { itemInstanceId: "bag-2", isBag: true },
      { type: "general" }
    )).toBeNull();
  });

  it("does not place a bag equipment slot into bag contents", () => {
    expect(resolveInventoryDropAction(
      { itemInstanceId: "bag-1", isBag: true, sourceSlot: "bag-1" },
      { type: "bag-content", containerInstanceId: "bag-2" }
    )).toBeNull();
  });
});
