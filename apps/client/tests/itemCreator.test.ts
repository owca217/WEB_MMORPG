/* @vitest-environment jsdom */

import type {
  ItemCreatorMetadata,
  ItemDetails,
  ItemDraftInput,
  ItemVersion
} from "@web-mmorpg/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApi, AdminApiRequestError } from "../src/net/AdminApi";
import { ItemCreatorView } from "../src/ui/admin/ItemCreatorView";

const metadata: ItemCreatorMetadata = {
  categories: [
    { id: "weapon", name: "Broń", system: true, allowedStatCodes: ["PHYSICAL_DAMAGE", "CRIT_DAMAGE", "WEIGHT"], allowedSpecialFieldCodes: ["weaponFamily", "durability", "maxDurability", "socketCount"] },
    { id: "material", name: "Materiały", system: true, allowedStatCodes: ["WEIGHT"], allowedSpecialFieldCodes: ["quality", "tier", "materialType", "craftingTags"] }
  ],
  subcategories: [
    { id: "sword", categoryId: "weapon", name: "Miecze", system: true, allowedStatCodes: ["PHYSICAL_DAMAGE", "CRIT_DAMAGE", "WEIGHT"], allowedSpecialFieldCodes: ["weaponFamily", "durability", "maxDurability", "socketCount"] },
    { id: "monster-part", categoryId: "material", name: "Części potworów", system: true, allowedStatCodes: ["WEIGHT"], allowedSpecialFieldCodes: ["quality", "tier", "materialType", "craftingTags"] }
  ],
  stats: [
    { code: "PHYSICAL_DAMAGE", label: "Obrażenia fizyczne", modifierTypes: ["flat", "percent"], minimum: -1000, maximum: 1000 },
    { code: "CRIT_DAMAGE", label: "Obrażenia krytyczne", modifierTypes: ["percent"], minimum: -100, maximum: 500 },
    { code: "WEIGHT", label: "Waga", modifierTypes: ["flat", "percent", "multiplier"], minimum: -1000, maximum: 1000 }
  ],
  triggers: [
    { code: "ON_HIT", label: "Przy trafieniu" },
    { code: "ON_USE", label: "Przy użyciu" }
  ],
  effects: [
    { code: "DIRECT_DAMAGE", label: "Bezpośrednie obrażenia" },
    { code: "HEAL", label: "Leczenie" }
  ],
  specialFields: [
    { code: "weaponFamily", label: "Rodzina broni", type: "select", options: [{ value: "sword", label: "Miecz" }, { value: "axe", label: "Topór" }] },
    { code: "durability", label: "Trwałość", type: "number", minimum: 0, maximum: 1000 },
    { code: "maxDurability", label: "Maksymalna trwałość", type: "number", minimum: 0, maximum: 1000 },
    { code: "socketCount", label: "Liczba gniazd", type: "number", minimum: 0, maximum: 12, integer: true },
    { code: "quality", label: "Jakość", type: "number", minimum: 0, maximum: 100, integer: true },
    { code: "tier", label: "Tier", type: "number", minimum: 1, maximum: 10, integer: true },
    { code: "materialType", label: "Typ materiału", type: "select", options: [{ value: "ore", label: "Ruda" }] },
    { code: "craftingTags", label: "Tagi craftingu", type: "text-list" }
  ]
};

function draft(overrides: Partial<ItemDraftInput> = {}): ItemDraftInput {
  return {
    itemId: "creator-sword",
    name: "Miecz kreatora",
    categoryId: "weapon",
    subcategoryId: "sword",
    description: "Opis miecza.",
    rarity: "COMMON",
    itemLevel: 5,
    minimumLevel: 1,
    sellValue: 10,
    sellable: true,
    tradable: true,
    droppable: true,
    stackable: false,
    maxStack: 1,
    weight: 2,
    soulbound: "NONE",
    unique: false,
    tags: [],
    stats: [],
    requirements: [],
    effects: [],
    specialData: {},
    ...overrides
  };
}

function version(input = draft(), revision = 1): ItemVersion {
  return {
    ...input,
    versionNo: 1,
    revision,
    state: "DRAFT",
    createdBy: "admin-player",
    createdAt: "2026-10-09T00:00:00.000Z"
  };
}

function details(input = draft()): ItemDetails {
  const item = {
    ...input,
    status: "DRAFT" as const,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z"
  };
  return { item, draft: version(input), versions: [] };
}

function createApi(options: {
  existing?: ItemDraftInput;
  createError?: unknown;
  saveError?: unknown;
} = {}) {
  const created = version(options.existing ?? draft());
  return {
    getMetadata: vi.fn(async () => metadata),
    getItem: vi.fn(async () => details(options.existing ?? draft())),
    createItem: options.createError
      ? vi.fn(async () => Promise.reject(options.createError))
      : vi.fn(async (input: ItemDraftInput) => version(input)),
    saveDraft: options.saveError
      ? vi.fn(async () => Promise.reject(options.saveError))
      : vi.fn(async (_itemId: string, input: ItemDraftInput, revision: number) => version(input, revision + 1)),
    publishItem: vi.fn(async (_itemId: string, revision: number) => ({
      ...created,
      revision,
      state: "PUBLISHED" as const
    })),
    uploadIcon: vi.fn(async () => ({
      key: "icons/creator.png",
      url: "https://assets.example.test/icons/creator.png"
    }))
  } as unknown as AdminApi;
}

function select(host: HTMLElement, selector: string, value: string): void {
  const element = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(host: HTMLElement, selector: string): void {
  const element = host.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  element.click();
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ItemCreatorView navigation and metadata constraints", () => {
  it("renders exactly nine steps and filters stat choices by category/subcategory", async () => {
    const host = document.createElement("div");
    const view = new ItemCreatorView(host, createApi());
    await view.loadMetadata();

    expect(host.querySelectorAll("[data-step-target]")).toHaveLength(9);
    expect(Array.from(host.querySelectorAll("[data-step-target]")).map((node) => node.textContent?.trim())).toEqual([
      "1. Kategoria",
      "2. Podstawy",
      "3. Zachowanie",
      "4. Statystyki",
      "5. Wymagania",
      "6. Efekty",
      "7. Dane specjalistyczne",
      "8. Tagi i integracje",
      "9. Podsumowanie"
    ]);

    select(host, "[data-field='categoryId']", "material");
    select(host, "[data-field='subcategoryId']", "monster-part");
    click(host, "[data-step-target='stats']");
    click(host, "[data-add-stat]");

    const statOptions = Array.from(
      host.querySelectorAll<HTMLOptionElement>("[data-stat-code] option")
    ).map((option) => option.value);
    expect(statOptions).toContain("WEIGHT");
    expect(statOptions).not.toContain("CRIT_DAMAGE");
    expect(statOptions).not.toContain("PHYSICAL_DAMAGE");
  });

  it("renders only typed specialist fields enabled for the selected category", async () => {
    const host = document.createElement("div");
    const view = new ItemCreatorView(host, createApi());
    await view.loadMetadata();

    click(host, "[data-step-target='specialist']");
    expect(host.querySelector("[data-special-field='weaponFamily']")).not.toBeNull();
    expect(host.querySelector("textarea[data-field='specialData']")).toBeNull();

    select(host, "[data-field='categoryId']", "material");
    click(host, "[data-step-target='specialist']");
    expect(host.querySelector("[data-special-field='quality']")).not.toBeNull();
    expect(host.querySelector("[data-special-field='weaponFamily']")).toBeNull();
  });

  it("supports modifier variants, negatives, effect proc fields and typed specialist fields", async () => {
    const host = document.createElement("div");
    const view = new ItemCreatorView(host, createApi());
    await view.loadMetadata();

    select(host, "[data-field='categoryId']", "weapon");
    select(host, "[data-field='subcategoryId']", "sword");
    click(host, "[data-step-target='stats']");
    click(host, "[data-add-stat]");
    select(host, "[data-stat-code]", "PHYSICAL_DAMAGE");
    select(host, "[data-stat-modifier]", "percent");
    select(host, "[data-stat-value]", "-12.5");

    click(host, "[data-step-target='effects']");
    click(host, "[data-add-effect]");
    select(host, "[data-effect-trigger]", "ON_HIT");
    select(host, "[data-effect-code]", "DIRECT_DAMAGE");
    select(host, "[data-effect-value]", "7");
    select(host, "[data-effect-chance]", "0.25");
    select(host, "[data-effect-duration]", "3000");
    select(host, "[data-effect-cooldown]", "5000");

    click(host, "[data-step-target='specialist']");
    select(host, "[data-special-field='weaponFamily']", "sword");
    select(host, "[data-special-field='durability']", "20");
    select(host, "[data-special-field='maxDurability']", "80");
    select(host, "[data-special-field='socketCount']", "1");
    expect(host.querySelector("[data-field='specialData']")).toBeNull();

    expect(view.getDraftSnapshot()).toMatchObject({
      stats: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "percent", value: -12.5 }],
      effects: [{
        triggerCode: "ON_HIT",
        effectCode: "DIRECT_DAMAGE",
        value: 7,
        chance: 0.25,
        durationMs: 3000,
        cooldownMs: 5000
      }],
      specialData: { weaponFamily: "sword", durability: 20, maxDurability: 80, socketCount: 1 }
    });
  });
});

describe("ItemCreatorView live tooltip preview", () => {
  it("updates name, rarity, stat and effect text before any save", async () => {
    const host = document.createElement("div");
    const api = createApi();
    const view = new ItemCreatorView(host, api);
    await view.loadMetadata();

    click(host, "[data-step-target='basics']");
    select(host, "[data-field='name']", "Ostrze burzy");
    select(host, "[data-field='rarity']", "EPIC");
    select(host, "[data-field='description']", "Miecz ładowany błyskawicami.");

    click(host, "[data-step-target='stats']");
    click(host, "[data-add-stat]");
    select(host, "[data-stat-code]", "CRIT_DAMAGE");
    select(host, "[data-stat-modifier]", "percent");
    select(host, "[data-stat-value]", "35");

    click(host, "[data-step-target='effects']");
    click(host, "[data-add-effect]");
    select(host, "[data-effect-trigger]", "ON_HIT");
    select(host, "[data-effect-code]", "DIRECT_DAMAGE");
    select(host, "[data-effect-value]", "15");

    const preview = host.querySelector("[data-tooltip-preview]")?.textContent ?? "";
    expect(preview).toContain("Ostrze burzy");
    expect(preview).toContain("EPIC");
    expect(preview).toContain("Obrażenia krytyczne");
    expect(preview).toContain("35%");
    expect(preview).toContain("Przy trafieniu");
    expect(preview).toContain("Bezpośrednie obrażenia");
    expect(api.createItem).not.toHaveBeenCalled();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });
});

describe("ItemCreatorView save resilience", () => {
  it("maps validation errors to fields and preserves the draft", async () => {
    const error = new AdminApiRequestError(400, {
      code: "ITEM_VALIDATION_FAILED",
      message: "Popraw formularz",
      fieldErrors: { name: "Nazwa jest wymagana" }
    });
    const host = document.createElement("div");
    const view = new ItemCreatorView(host, createApi({ createError: error }));
    await view.loadMetadata();
    click(host, "[data-step-target='basics']");
    select(host, "[data-field='itemId']", "invalid-draft");
    select(host, "[data-field='name']", "Nazwa do zachowania");

    await expect(view.saveDraft()).rejects.toBe(error);

    expect(view.getDraftSnapshot().name).toBe("Nazwa do zachowania");
    expect(host.querySelector("[data-field='name']")?.classList.contains("has-error")).toBe(true);
    expect(host.textContent).toContain("Nazwa jest wymagana");
  });

  it("preserves the form on infrastructure failure", async () => {
    const error = new AdminApiRequestError(500, {
      code: "INTERNAL_ERROR",
      message: "Serwer chwilowo niedostępny"
    });
    const host = document.createElement("div");
    const view = new ItemCreatorView(host, createApi({ createError: error }));
    await view.loadMetadata();
    click(host, "[data-step-target='basics']");
    select(host, "[data-field='itemId']", "offline-draft");
    select(host, "[data-field='name']", "Nie zgub mnie");

    await expect(view.saveDraft()).rejects.toBe(error);
    expect(view.getDraftSnapshot().name).toBe("Nie zgub mnie");
    expect(host.textContent).toContain("Serwer chwilowo niedostępny");
  });

  it("asks before cancelling unsaved edits", async () => {
    const host = document.createElement("div");
    const onCancel = vi.fn();
    const view = new ItemCreatorView(host, createApi(), { onCancel });
    await view.loadMetadata();
    click(host, "[data-step-target='basics']");
    select(host, "[data-field='name']", "Zmiana bez zapisu");

    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(view.cancel()).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
    expect(view.cancel()).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a reload choice on 409 conflict without discarding local form", async () => {
    const conflict = new AdminApiRequestError(409, {
      code: "ITEM_CONFLICT",
      message: "Ktoś zapisał nowszą wersję"
    });
    const existing = draft({ name: "Wersja serwera" });
    const api = createApi({ existing, saveError: conflict });
    const host = document.createElement("div");
    const view = new ItemCreatorView(host, api);
    await view.loadMetadata("creator-sword");
    click(host, "[data-step-target='basics']");
    select(host, "[data-field='name']", "Moja lokalna wersja");

    await expect(view.saveDraft()).rejects.toBe(conflict);
    expect(view.getDraftSnapshot().name).toBe("Moja lokalna wersja");
    expect(host.textContent?.toLocaleLowerCase("pl")).toContain("konflikt");
    expect(host.querySelector("[data-conflict-reload]")).not.toBeNull();

    click(host, "[data-conflict-reload]");
    await flush();
    expect(api.getItem).toHaveBeenCalledTimes(2);
  });

  it("uploads an icon and immediately uses returned key/url in the draft and preview", async () => {
    const host = document.createElement("div");
    const api = createApi();
    const view = new ItemCreatorView(host, api);
    await view.loadMetadata();
    const file = new File(["png"], "icon.png", { type: "image/png" });

    await view.uploadIcon(file);

    expect(api.uploadIcon).toHaveBeenCalledWith(file);
    expect(view.getDraftSnapshot()).toMatchObject({
      iconKey: "icons/creator.png",
      iconUrl: "https://assets.example.test/icons/creator.png"
    });
    expect(host.querySelector<HTMLImageElement>("[data-tooltip-preview] img")?.src).toBe(
      "https://assets.example.test/icons/creator.png"
    );
  });
});
