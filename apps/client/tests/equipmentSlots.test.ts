import type { InventoryItem } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { equipmentSlotsFor } from "../src/ui/equipmentSlots";
import { equipmentIcon } from "../src/ui/equipmentIcons";

const sword: InventoryItem = {
  instanceId: "sword-1", itemId: "iron-sword", name: "Żelazny miecz",
  description: "Miecz jednoręczny.", category: "weapon", quantity: 1
};

describe("character equipment slots", () => {
  it("shows every requested position, including two independent rings and both hands", () => {
    const slots = equipmentSlotsFor({ items: [] }, { items: [] });
    expect(slots.map(slot => slot.id)).toEqual([
      "head", "shoulders", "chest", "hands", "legs", "feet",
      "neck", "ring1", "ring2", "back", "wrists", "waist", "ears", "mainHand", "offHand"
    ]);
    expect(slots.every(slot => !slot.itemInstanceId && !slot.item)).toBe(true);
  });

  it("only displays equipped instances, without treating inventory as worn equipment", () => {
    const slots = equipmentSlotsFor({ items: [{ slot: "mainHand", itemInstanceId: "sword-1" }] }, { items: [sword] });
    expect(slots.find(slot => slot.id === "mainHand")?.item).toEqual(sword);
    expect(slots.filter(slot => slot.item)).toHaveLength(1);
    expect(equipmentSlotsFor({ items: [] }, { items: [sword] }).every(slot => !slot.item)).toBe(true);
  });

  it("keeps both rings separate and accepts persisted snake-case hand names", () => {
    const ring = { ...sword, instanceId: "ring-1", name: "Pierścień" };
    const second = { ...ring, instanceId: "ring-2" };
    const slots = equipmentSlotsFor({ items: [
      { slot: "ring_1", itemInstanceId: ring.instanceId },
      { slot: "ring_2", itemInstanceId: second.instanceId },
      { slot: "main_hand", itemInstanceId: sword.instanceId }
    ] }, { items: [sword, ring, second] });
    expect(slots.find(slot => slot.id === "ring1")?.item?.instanceId).toBe("ring-1");
    expect(slots.find(slot => slot.id === "ring2")?.item?.instanceId).toBe("ring-2");
    expect(slots.find(slot => slot.id === "mainHand")?.item).toEqual(sword);
  });

  it("retains occupied slots when item details are unavailable, and clears them on a later snapshot", () => {
    const slots = equipmentSlotsFor({ items: [{ slot: "head", itemInstanceId: "missing-helmet" }] }, { items: [] });
    expect(slots[0]?.itemInstanceId).toBe("missing-helmet");
    expect(slots[0]?.item).toBeNull();
    expect(equipmentSlotsFor({ items: [] }, { items: [] })[0]?.itemInstanceId).toBeNull();
  });

  it("does not mistake a Polish oak shield name for an English bow", () => {
    const shield = { ...sword, itemId: "oak-shield", name: "Dębowa tarcza" };
    expect(equipmentIcon("offHand", shield)).toBe(equipmentIcon("offHand", null));
    expect(equipmentIcon("mainHand", { ...sword, itemId: "longbow", name: "Długi łuk" }))
      .not.toBe(equipmentIcon("mainHand", sword));
  });
});
