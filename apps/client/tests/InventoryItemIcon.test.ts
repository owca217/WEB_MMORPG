/* @vitest-environment jsdom */

import type { InventoryItem } from "@web-mmorpg/shared";
import { afterEach, expect, it, vi } from "vitest";
import { inventoryItemIcon } from "../src/ui/InventoryItemIcon";

const bandage: InventoryItem = {
  instanceId: "bandage", itemId: "field-bandage", itemDefinitionId: "field-bandage", name: "Bandaż",
  quantity: 1, category: "medical", description: "", rarity: "COMMON", upgradeLevel: 0
};

afterEach(() => vi.unstubAllEnvs());

it("uses bundled consumable art and restores the existing glyph if loading fails", () => {
  vi.stubEnv("BASE_URL", "/WEB_MMORPG/");
  const icon = inventoryItemIcon(bandage);
  const image = icon.querySelector("img")!;
  expect(image.getAttribute("src")).toBe("/WEB_MMORPG/assets/items/field-bandage.png");
  image.dispatchEvent(new Event("error"));
  expect(icon.querySelector("img")).toBeNull();
  expect(icon.querySelector("svg")).not.toBeNull();
  expect(icon.getAttribute("aria-hidden")).toBe("true");
});

it("preserves uploaded art and the existing permanent-backpack override", () => {
  vi.stubEnv("BASE_URL", "/WEB_MMORPG/");
  expect(inventoryItemIcon({ ...bandage, iconUrl: "/uploaded.png" }).querySelector("img")?.getAttribute("src"))
    .toBe("/uploaded.png");
  expect(inventoryItemIcon({ ...bandage, permanentContainer: true, iconUrl: "/uploaded.png" }).querySelector("img")?.getAttribute("src"))
    .toBe("/WEB_MMORPG/assets/items/permanent-backpack.png");
});
