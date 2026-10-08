import {
  ITEM_DEFINITIONS,
  type AdminItemCatalog
} from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import {
  adminItemCapacityLabel,
  createAdminOperationId,
  filterAdminItems,
  normalizeGrantQuantity
} from "../src/ui/adminPanelViewModel";

const catalog: AdminItemCatalog = { items: ITEM_DEFINITIONS };

describe("admin panel view model", () => {
  it("filters by Polish name, id and category", () => {
    expect(filterAdminItems(catalog, "worek", "all").map((item) => item.itemId))
      .toEqual(["simple-bag"]);
    expect(filterAdminItems(catalog, "wolf", "material").map((item) => item.itemId))
      .toEqual(["wolf-pelt"]);
    expect(filterAdminItems(catalog, "", "bag")).toHaveLength(4);
    expect(filterAdminItems(catalog, "worek", "medical")).toEqual([]);
  });

  it.each([
    ["1", { ok: true, value: 1 }],
    ["1000", { ok: true, value: 1000 }],
    [0, { ok: false, code: "ADMIN_INVALID_QUANTITY" }],
    ["0", { ok: false, code: "ADMIN_INVALID_QUANTITY" }],
    ["-2", { ok: false, code: "ADMIN_INVALID_QUANTITY" }],
    ["1.5", { ok: false, code: "ADMIN_INVALID_QUANTITY" }],
    ["1001", { ok: false, code: "ADMIN_INVALID_QUANTITY" }],
    ["abc", { ok: false, code: "ADMIN_INVALID_QUANTITY" }],
    ["", { ok: false, code: "ADMIN_INVALID_QUANTITY" }]
  ])("normalizes quantity %s", (value, expected) => {
    expect(normalizeGrantQuantity(value)).toMatchObject(expected);
  });

  it("formats bag capacity and creates unique operation ids", () => {
    expect(adminItemCapacityLabel(ITEM_DEFINITIONS[0]!)).toBe("Pojemność: 8 miejsc");
    const first = createAdminOperationId();
    const second = createAdminOperationId();
    expect(first).toMatch(/^[a-zA-Z0-9-]{8,}$/);
    expect(second).not.toBe(first);
  });
});
