/* @vitest-environment jsdom */

import { ITEM_QUALITY_DEFINITIONS, type InventoryItem } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { containerIcon } from "../src/ui/ContainerIcon";
import { equipmentIcon } from "../src/ui/EquipmentIcon";

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return { instanceId: "item", itemId: "item", itemDefinitionId: "item", name: "Przedmiot",
    category: "container", description: "", quantity: 1, rarity: "LEGENDARY", upgradeLevel: 0, ...overrides };
}

describe("item quality frames", () => {
  it.each(ITEM_QUALITY_DEFINITIONS)("frames real $label items with its own color and Polish accessible quality", definition => {
    for (const icon of [containerIcon(item({quality:definition.id})), equipmentIcon(item({quality:definition.id}))]) {
      expect(icon.classList.contains("item-quality-frame")).toBe(true);
      expect(icon.dataset.itemQuality).toBe(definition.id);
      expect(icon.style.getPropertyValue("--item-quality-color")).toBe(definition.color);
      expect(icon.title).toBe(`Jakość: ${definition.label}`);
      expect(icon.getAttribute("aria-label")).toBe(`Jakość: ${definition.label}`);
      expect(icon.getAttribute("aria-hidden")).not.toBe("true");
    }
  });

  it("defaults older items to Normalna and keeps empty slots without a quality frame", () => {
    expect(containerIcon(item()).dataset.itemQuality).toBe("NORMAL");
    expect(containerIcon().classList.contains("item-quality-frame")).toBe(false);
    expect(equipmentIcon().classList.contains("item-quality-frame")).toBe(false);
  });

  it("retains the same quality frame after an image fails", () => {
    for (const icon of [containerIcon(item({quality:"MASTERWORK",iconUrl:"/missing.png"})), equipmentIcon(item({quality:"MASTERWORK",iconUrl:"/missing.png"}))]) {
      icon.querySelector("img")!.dispatchEvent(new Event("error"));
      expect(icon.querySelector("img")).toBeNull();
      expect(icon.dataset.itemQuality).toBe("MASTERWORK");
      expect(icon.title).toBe("Jakość: Arcydzieło");
      expect(icon.style.getPropertyValue("--item-quality-color")).toBe("#e74c3c");
    }
  });
});
