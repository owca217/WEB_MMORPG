import type { EquipmentSnapshot, InventorySnapshot } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { createBagItem } from "../src/inventory/containers";
import { placeBagReward } from "../src/inventory/bagReward";

describe("quartermaster bag reward placement", () => {
  it("equips the reward in the first bag slot when all four bag slots are empty", () => {
    const bag = createBagItem("simple-bag");
    const result = placeBagReward(
      { items: [] } satisfies InventorySnapshot,
      { items: [] } satisfies EquipmentSnapshot,
      bag
    );

    expect(result.inventory.items).toContainEqual(bag);
    expect(result.equipment.items).toContainEqual({
      slot: "bag-1",
      itemInstanceId: bag.instanceId
    });
  });

  it("leaves the reward in general inventory when any bag slot is occupied", () => {
    const bag = createBagItem("simple-bag");
    const equipped = createBagItem("traditional-backpack");
    const equipment = {
      items: [{ slot: "bag-4", itemInstanceId: equipped.instanceId }]
    } satisfies EquipmentSnapshot;
    const result = placeBagReward(
      { items: [equipped] },
      equipment,
      bag
    );

    expect(result.inventory.items).toEqual([equipped, bag]);
    expect(result.equipment).toEqual(equipment);
  });
});
