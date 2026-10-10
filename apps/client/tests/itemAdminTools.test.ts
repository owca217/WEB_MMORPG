/* @vitest-environment jsdom */

import type {
  ItemCreatorMetadata,
  ItemVersion,
  ItemVersionSummary
} from "@web-mmorpg/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApi, AdminAuditEntry } from "../src/net/AdminApi";
import { CategoryManagerView } from "../src/ui/admin/CategoryManagerView";
import { ItemHistoryView } from "../src/ui/admin/ItemHistoryView";

const metadata: ItemCreatorMetadata = {
  categories: [
    {
      id: "weapon",
      name: "Broń",
      system: true,
      allowedStatCodes: ["PHYSICAL_DAMAGE", "WEIGHT"],
      allowedSpecialFieldCodes: ["weaponFamily", "durability"]
    },
    {
      id: "custom-relic",
      name: "Relikty",
      system: false,
      allowedStatCodes: ["WEIGHT"],
      allowedSpecialFieldCodes: []
    }
  ],
  subcategories: [
    {
      id: "sword",
      categoryId: "weapon",
      name: "Miecze",
      system: true,
      allowedStatCodes: ["PHYSICAL_DAMAGE", "WEIGHT"],
      allowedSpecialFieldCodes: ["weaponFamily", "durability"]
    }
  ],
  stats: [
    {
      code: "PHYSICAL_DAMAGE",
      label: "Obrażenia fizyczne",
      modifierTypes: ["flat"],
      minimum: -1000,
      maximum: 1000
    },
    {
      code: "WEIGHT",
      label: "Waga",
      modifierTypes: ["flat", "percent"],
      minimum: 0,
      maximum: 1000
    }
  ],
  triggers: [],
  effects: [],
  specialFields: [
    { code: "weaponFamily", label: "Rodzina broni", type: "select", options: [{ value: "sword", label: "Miecz" }] },
    { code: "durability", label: "Trwałość", type: "number", minimum: 0, maximum: 1000 }
  ]
};

const versions: ItemVersionSummary[] = [
  {
    versionNo: 4,
    revision: 8,
    state: "PUBLISHED",
    createdBy: "admin-b",
    createdAt: "2026-10-09T03:00:00.000Z"
  },
  {
    versionNo: 3,
    revision: 6,
    state: "PUBLISHED",
    createdBy: "admin-a",
    createdAt: "2026-10-09T02:00:00.000Z"
  }
];

const audit: AdminAuditEntry[] = [
  {
    id: "audit-v4",
    actorPlayerId: "admin-b",
    action: "PUBLISH_ITEM",
    objectType: "item",
    objectId: "iron-sword",
    fromVersion: 3,
    toVersion: 4,
    summary: {
      changedFields: ["name", "rarity", "stats"]
    },
    createdAt: "2026-10-09T03:00:00.000Z"
  }
];

function restoredVersion(): ItemVersion {
  return {
    itemId: "iron-sword",
    name: "Żelazny miecz",
    categoryId: "weapon",
    subcategoryId: "sword",
    description: "Przywrócona wersja.",
    rarity: "COMMON",
    itemLevel: 4,
    minimumLevel: 1,
    sellValue: 20,
    sellable: true,
    tradable: true,
    droppable: true,
    stackable: false,
    maxStack: 1,
    weight: 3,
    soulbound: "NONE",
    unique: false,
    tags: [],
    stats: [],
    requirements: [],
    effects: [],
    specialData: {},
    versionNo: 5,
    revision: 9,
    state: "PUBLISHED",
    createdBy: "admin-current",
    createdAt: "2026-10-09T04:00:00.000Z"
  };
}

function historyApi() {
  return {
    listVersions: vi.fn(async () => versions),
    getAudit: vi.fn(async () => audit),
    restoreVersion: vi.fn(async () => restoredVersion())
  } as unknown as AdminApi;
}

function categoryApi() {
  return {
    getMetadata: vi.fn(async () => metadata),
    createCategory: vi.fn(async (input: { id: string; name: string; allowedStatCodes: string[]; allowedSpecialFieldCodes: string[] }) => ({
      ...input,
      system: false
    })),
    createSubcategory: vi.fn(async (input: { id: string; categoryId: string; name: string; allowedStatCodes: string[]; allowedSpecialFieldCodes: string[] }) => ({
      ...input,
      system: false
    })),
    updateCategoryAllowedStats: vi.fn(async (categoryId: string, allowedStatCodes: string[]) => ({
      id: categoryId,
      name: categoryId === "weapon" ? "Broń" : "Relikty",
      system: categoryId === "weapon",
      allowedStatCodes,
      allowedSpecialFieldCodes: ["weaponFamily", "durability"]
    })),
    updateCategoryAllowedSpecialFields: vi.fn(async (categoryId: string, allowedSpecialFieldCodes: string[]) => ({
      id: categoryId,
      name: categoryId === "weapon" ? "Broń" : "Relikty",
      system: categoryId === "weapon",
      allowedStatCodes: ["WEIGHT"],
      allowedSpecialFieldCodes
    })),
    updateSubcategoryAllowedSpecialFields: vi.fn(async (categoryId: string, subcategoryId: string, allowedSpecialFieldCodes: string[]) => ({
      id: subcategoryId,
      categoryId,
      name: "Miecze",
      system: true,
      allowedStatCodes: ["WEIGHT"],
      allowedSpecialFieldCodes
    }))
  } as unknown as AdminApi;
}

function click(host: HTMLElement, selector: string): void {
  const button = host.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing ${selector}`);
  button.click();
}

function setValue(host: HTMLElement, selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (!input) throw new Error(`Missing ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ItemHistoryView", () => {
  it("shows version author/time and the v3 -> v4 changed fields", async () => {
    const host = document.createElement("div");
    const api = historyApi();
    const view = new ItemHistoryView(host, api, "iron-sword");

    await view.show();

    expect(api.listVersions).toHaveBeenCalledWith("iron-sword");
    expect(api.getAudit).toHaveBeenCalledWith("item", "iron-sword");
    const text = host.textContent ?? "";
    expect(text).toContain("v4");
    expect(text).toContain("admin-b");
    expect(text).toContain("v3 → v4");
    expect(text).toContain("name");
    expect(text).toContain("rarity");
    expect(text).toContain("stats");
  });

  it("restores only after confirmation and reports the newly created active version", async () => {
    const host = document.createElement("div");
    const api = historyApi();
    const onRestored = vi.fn();
    const view = new ItemHistoryView(host, api, "iron-sword", { onRestored });
    await view.show();

    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    click(host, "[data-restore-version='3']");
    await flush();
    expect(api.restoreVersion).not.toHaveBeenCalled();

    click(host, "[data-restore-version='3']");
    await flush();
    expect(api.restoreVersion).toHaveBeenCalledWith("iron-sword", 3);
    expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ versionNo: 5 }));
    expect(host.textContent).toContain("v5");
  });
});

describe("CategoryManagerView", () => {
  it("creates a custom category using only metadata-provided engine stat codes", async () => {
    const host = document.createElement("div");
    const api = categoryApi();
    const view = new CategoryManagerView(host, api);
    await view.show();

    const statChoices = Array.from(
      host.querySelectorAll<HTMLInputElement>("[data-new-category-stat]")
    ).map((input) => input.value);
    expect(statChoices).toEqual(["PHYSICAL_DAMAGE", "WEIGHT"]);
    expect(host.querySelector("input[data-arbitrary-stat-code]")).toBeNull();

    setValue(host, "[data-new-category-id]", "alchemy");
    setValue(host, "[data-new-category-name]", "Alchemia");
    const weight = host.querySelector<HTMLInputElement>("[data-new-category-stat][value='WEIGHT']");
    if (!weight) throw new Error("Missing WEIGHT checkbox");
    weight.checked = true;
    weight.dispatchEvent(new Event("change", { bubbles: true }));
    click(host, "[data-create-category]");
    await flush();

    expect(api.createCategory).toHaveBeenCalledWith({
      id: "alchemy",
      name: "Alchemia",
      allowedStatCodes: ["WEIGHT"],
      allowedSpecialFieldCodes: []
    });
  });

  it("maps specialist fields for categories and subcategories using known engine fields", async () => {
    const host = document.createElement("div");
    const api = categoryApi();
    const view = new CategoryManagerView(host, api);
    await view.show();

    const durability = host.querySelector<HTMLInputElement>(
      "[data-category-special-field='weapon'][value='durability']"
    );
    if (!durability) throw new Error("Missing category specialist field");
    durability.checked = false;
    click(host, "[data-save-category-special-fields='weapon']");
    await flush();
    expect(api.updateCategoryAllowedSpecialFields).toHaveBeenCalledWith(
      "weapon",
      ["weaponFamily"]
    );

    const swordFamily = host.querySelector<HTMLInputElement>(
      "[data-subcategory-special-field='weapon:sword'][value='weaponFamily']"
    );
    if (!swordFamily) throw new Error("Missing subcategory specialist field");
    swordFamily.checked = false;
    click(host, "[data-save-subcategory-special-fields='sword']");
    await flush();
    expect(api.updateSubcategoryAllowedSpecialFields).toHaveBeenCalledWith(
      "weapon",
      "sword",
      ["durability"]
    );
  });

  it("edits allowed stats from known checkboxes and offers no hard-delete action for system categories", async () => {
    const host = document.createElement("div");
    const api = categoryApi();
    const view = new CategoryManagerView(host, api);
    await view.show();

    expect(host.querySelector("[data-delete-category='weapon']")).toBeNull();
    expect(host.querySelector("[data-delete-category='custom-relic']")).toBeNull();

    const physical = host.querySelector<HTMLInputElement>(
      "[data-category-stat='weapon'][value='PHYSICAL_DAMAGE']"
    );
    const weight = host.querySelector<HTMLInputElement>(
      "[data-category-stat='weapon'][value='WEIGHT']"
    );
    if (!physical || !weight) throw new Error("Missing category stat choices");
    physical.checked = false;
    weight.checked = true;
    click(host, "[data-save-category-stats='weapon']");
    await flush();

    expect(api.updateCategoryAllowedStats).toHaveBeenCalledWith("weapon", ["WEIGHT"]);
  });
});
