/* @vitest-environment jsdom */

import type {
  ItemCatalogPage,
  ItemCreatorMetadata,
  ItemDefinition
} from "@web-mmorpg/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApi, AdminApiRequestError } from "../src/net/AdminApi";
import { WorldHud } from "../src/ui/WorldHud";
import { ItemCatalogView } from "../src/ui/admin/ItemCatalogView";

const metadata: ItemCreatorMetadata = {
  categories: [
    {
      id: "weapon",
      name: "Broń",
      system: true,
      allowedStatCodes: ["PHYSICAL_DAMAGE", "CRIT_DAMAGE"],
      allowedSpecialFieldCodes: []
    }
  ],
  subcategories: [
    {
      id: "sword",
      categoryId: "weapon",
      name: "Miecze",
      system: true,
      allowedStatCodes: ["PHYSICAL_DAMAGE", "CRIT_DAMAGE"],
      allowedSpecialFieldCodes: []
    }
  ],
  stats: [
    {
      code: "PHYSICAL_DAMAGE",
      label: "Obrażenia fizyczne",
      modifierTypes: ["flat"]
    }
  ],
  triggers: [],
  effects: [],
  specialFields: []
};

function catalogItem(overrides: Partial<ItemDefinition> = {}): ItemDefinition {
  return {
    itemId: "iron-sword",
    name: "Żelazny miecz",
    categoryId: "weapon",
    subcategoryId: "sword",
    description: "Podstawowy miecz testowy.",
    rarity: "COMMON",
    itemLevel: 8,
    minimumLevel: 3,
    sellValue: 100,
    sellable: true,
    tradable: true,
    droppable: true,
    stackable: false,
    maxStack: 1,
    weight: 2.5,
    soulbound: "NONE",
    unique: false,
    tags: ["starter"],
    stats: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 12 }],
    requirements: [],
    effects: [],
    specialData: {},
    status: "DRAFT",
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
    ...overrides
  };
}

function page(items = [catalogItem()]): ItemCatalogPage {
  return { items, total: items.length, page: 1, pageSize: 20 };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("WorldHud ADMIN entry", () => {
  it("hides ADMIN for PLAYER and shows/clicks it only for ADMIN", () => {
    const onAdmin = vi.fn();
    const hud = new WorldHud({
      onInventory: vi.fn(),
      onCharacter: vi.fn(),
      onAdmin
    });
    const button = document.querySelector<HTMLButtonElement>("[data-admin]");
    expect(button).not.toBeNull();

    hud.updateSession("PLAYER");
    expect(button?.hidden).toBe(true);

    hud.updateSession("ADMIN");
    expect(button?.hidden).toBe(false);
    button?.click();
    expect(onAdmin).toHaveBeenCalledTimes(1);

    hud.updateSession("PLAYER");
    expect(button?.hidden).toBe(true);
    hud.destroy();
  });
});

describe("AdminApi", () => {
  it("sends the in-memory bearer token on every request", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer session-token");
      return new Response(JSON.stringify(metadata), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const api = new AdminApi(
      "https://game.example.test/",
      () => "session-token",
      fetcher as typeof fetch
    );

    await expect(api.getMetadata()).resolves.toEqual(metadata);
    expect(fetcher).toHaveBeenCalledWith(
      "https://game.example.test/api/admin/item-metadata",
      expect.objectContaining({ method: "GET" })
    );
  });

  it.each([400, 401, 403, 404, 409, 500])(
    "normalizes HTTP %s into AdminApiRequestError",
    async (status) => {
      const fetcher = vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: `E_${status}`,
            message: `failure-${status}`,
            fieldErrors: { name: "invalid" }
          }),
          { status, headers: { "Content-Type": "application/json" } }
        )
      );
      const api = new AdminApi("https://game.example.test", () => "token", fetcher as typeof fetch);

      try {
        await api.listItems();
        throw new Error("Expected request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(AdminApiRequestError);
        const apiError = error as AdminApiRequestError;
        expect(apiError.status).toBe(status);
        expect(apiError.code).toBe(`E_${status}`);
        expect(apiError.fieldErrors).toEqual({ name: "invalid" });
      }
    }
  );

  it("does not call fetch when there is no session token", async () => {
    const fetcher = vi.fn();
    const api = new AdminApi("https://game.example.test", () => null, fetcher as typeof fetch);

    await expect(api.getMetadata()).rejects.toMatchObject({
      status: 401,
      code: "ADMIN_SESSION_REQUIRED"
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("ItemCatalogView", () => {
  function createApi(items = [catalogItem()]) {
    return {
      getMetadata: vi.fn(async () => metadata),
      listItems: vi.fn(async () => page(items)),
      grantItem: vi.fn(async () => ({ characterId: "hero", inventory: { items: [], containerSlots: [null, null, null, null] } })),
      getItem: vi.fn(),
      duplicateItem: vi.fn(async () => ({ ...catalogItem(), itemId: "iron-sword-copy" })),
      archiveItem: vi.fn(async () => undefined),
      listVersions: vi.fn(async () => [])
    } as unknown as AdminApi;
  }

  it("renders loading, catalog rows and all required actions", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = createApi();
    const handlers = {
      onPreview: vi.fn(),
      onEdit: vi.fn(),
      onHistory: vi.fn()
    };
    const view = new ItemCatalogView(host, api, handlers);

    const showing = view.show();
    expect(host.textContent).toContain("Ładowanie");
    await showing;

    expect(host.textContent).toContain("Żelazny miecz");
    expect(host.querySelector("[data-action='preview']")).not.toBeNull();
    expect(host.querySelector("[data-action='edit']")).not.toBeNull();
    expect(host.querySelector("[data-action='duplicate']")).not.toBeNull();
    expect(host.querySelector("[data-action='archive']")).not.toBeNull();
    expect(host.querySelector("[data-action='history']")).not.toBeNull();
  });

  it("shows the item icon and keeps the name readable if the icon cannot load", async () => {
    const host = document.createElement("div");
    const view = new ItemCatalogView(host, createApi([
      catalogItem({ iconUrl: "https://game.example.test/api/item-icons/sword.png" })
    ]), { onPreview: vi.fn(), onEdit: vi.fn(), onHistory: vi.fn() });
    await view.show();

    const image = host.querySelector<HTMLImageElement>("article img");
    expect(image?.src).toBe("https://game.example.test/api/item-icons/sword.png");
    image?.dispatchEvent(new Event("error"));
    expect(host.querySelector("article img")).toBeNull();
    expect(host.querySelector("article")?.textContent).toContain("Żelazny miecz");
  });

  it("submits search and every catalog filter through AdminApi", async () => {
    const host = document.createElement("div");
    const api = createApi();
    const view = new ItemCatalogView(host, api, {
      onPreview: vi.fn(),
      onEdit: vi.fn(),
      onHistory: vi.fn()
    });
    await view.show();

    (host.querySelector("[data-filter='search']") as HTMLInputElement).value = "miecz";
    (host.querySelector("[data-filter='itemId']") as HTMLInputElement).value = "iron-sword";
    (host.querySelector("[data-filter='categoryId']") as HTMLSelectElement).value = "weapon";
    (host.querySelector("[data-filter='subcategoryId']") as HTMLSelectElement).value = "sword";
    (host.querySelector("[data-filter='rarity']") as HTMLSelectElement).value = "RARE";
    (host.querySelector("[data-filter='minimumLevel']") as HTMLInputElement).value = "5";
    (host.querySelector("[data-filter='maximumLevel']") as HTMLInputElement).value = "20";
    (host.querySelector("[data-filter='status']") as HTMLSelectElement).value = "PUBLISHED";
    host.querySelector<HTMLFormElement>("[data-filters]")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    await flush();

    expect((api.listItems as ReturnType<typeof vi.fn>)).toHaveBeenLastCalledWith({
      search: "miecz",
      itemId: "iron-sword",
      categoryId: "weapon",
      subcategoryId: "sword",
      rarity: "RARE",
      minimumLevel: 5,
      maximumLevel: 20,
      status: "PUBLISHED",
      page: 1,
      pageSize: 20
    });
  });

  it("runs preview/edit/history and confirmed duplicate/archive actions", async () => {
    const host = document.createElement("div");
    const api = createApi();
    const handlers = {
      onPreview: vi.fn(),
      onEdit: vi.fn(),
      onHistory: vi.fn()
    };
    const view = new ItemCatalogView(host, api, handlers);
    await view.show();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("iron-sword-copy");

    host.querySelector<HTMLButtonElement>("[data-action='preview']")?.click();
    host.querySelector<HTMLButtonElement>("[data-action='edit']")?.click();
    host.querySelector<HTMLButtonElement>("[data-action='history']")?.click();
    host.querySelector<HTMLButtonElement>("[data-action='duplicate']")?.click();
    await flush();
    host.querySelector<HTMLButtonElement>("[data-action='archive']")?.click();
    await flush();

    expect(handlers.onPreview).toHaveBeenCalledWith("iron-sword");
    expect(handlers.onEdit).toHaveBeenCalledWith("iron-sword");
    expect(handlers.onHistory).toHaveBeenCalledWith("iron-sword");
    expect(api.duplicateItem).toHaveBeenCalledWith("iron-sword", "iron-sword-copy");
    expect(api.archiveItem).toHaveBeenCalledWith("iron-sword");
  });

  it("renders explicit empty and error states", async () => {
    const emptyHost = document.createElement("div");
    const emptyView = new ItemCatalogView(emptyHost, createApi([]), {
      onPreview: vi.fn(),
      onEdit: vi.fn(),
      onHistory: vi.fn()
    });
    await emptyView.show();
    expect(emptyHost.textContent).toContain("Brak przedmiotów");

    const errorHost = document.createElement("div");
    const errorApi = createApi();
    (errorApi.listItems as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AdminApiRequestError(500, {
        code: "INTERNAL_ERROR",
        message: "Serwer niedostępny"
      })
    );
    const errorView = new ItemCatalogView(errorHost, errorApi, {
      onPreview: vi.fn(),
      onEdit: vi.fn(),
      onHistory: vi.fn()
    });
    await errorView.show();
    expect(errorHost.textContent).toContain("Serwer niedostępny");
  });

  it("enables granting only published ordinary items with a current character", async () => {
    const host = document.createElement("div");
    const view = new ItemCatalogView(host, createApi([
      catalogItem({ status: "PUBLISHED" }),
      catalogItem({ itemId: "draft" }),
      catalogItem({ itemId: "archived", status: "ARCHIVED" }),
      catalogItem({ itemId: "permanent-backpack", status: "PUBLISHED" })
    ]), { onPreview: vi.fn(), onEdit: vi.fn(), onHistory: vi.fn(), getCharacterId: () => "hero", onInventoryGranted: vi.fn() });
    await view.show();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-action='grant']")];
    expect(buttons.map(button => button.disabled)).toEqual([false, true, true, true]);
    const input = host.querySelector<HTMLInputElement>("[data-grant-quantity]")!;
    expect([input.value, input.min, input.max, input.step]).toEqual(["1", "1", "100", "1"]);
  });

  it("sends one pending grant, validates quantity and delivers the inventory result", async () => {
    const host = document.createElement("div");
    const api = createApi([catalogItem({ status: "PUBLISHED" })]);
    let finish!: (result: unknown) => void;
    (api.grantItem as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onInventoryGranted = vi.fn();
    const view = new ItemCatalogView(host, api, { onPreview: vi.fn(), onEdit: vi.fn(), onHistory: vi.fn(), getCharacterId: () => "hero", onInventoryGranted });
    await view.show();
    const quantity = host.querySelector<HTMLInputElement>("[data-grant-quantity]")!;
    const button = host.querySelector<HTMLButtonElement>("[data-action='grant']")!;
    quantity.value = "101";
    button.click();
    expect(api.grantItem).not.toHaveBeenCalled();
    quantity.value = "3";
    button.click();
    button.click();
    expect(button.disabled).toBe(true);
    expect(api.grantItem).toHaveBeenCalledTimes(1);
    expect(api.grantItem).toHaveBeenCalledWith("iron-sword", { characterId: "hero", quantity: 3, requestId: expect.any(String) });
    const result = { characterId: "hero", inventory: { items: [], containerSlots: [null, null, null, null] } };
    finish(result);
    await flush();
    expect(onInventoryGranted).toHaveBeenCalledWith(result);
    expect(host.textContent).toContain("Dodano");
    expect(button.disabled).toBe(false);
  });

  it("shows network errors and reuses the request UUID on retry", async () => {
    const host = document.createElement("div");
    const api = createApi([catalogItem({ status: "PUBLISHED" })]);
    (api.grantItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const view = new ItemCatalogView(host, api, { onPreview: vi.fn(), onEdit: vi.fn(), onHistory: vi.fn(), getCharacterId: () => "hero", onInventoryGranted: vi.fn() });
    await view.show();
    const button = host.querySelector<HTMLButtonElement>("[data-action='grant']")!;
    button.click();
    await flush();
    expect(host.textContent).toContain("Failed to fetch");
    const firstInput = (api.grantItem as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    button.click();
    await flush();
    expect((api.grantItem as ReturnType<typeof vi.fn>).mock.calls[1]?.[1]).toEqual(firstInput);
  });

  it.each(["destroy", "character switch"])("ignores a grant result after %s", async mode => {
    const host = document.createElement("div");
    const api = createApi([catalogItem({ status: "PUBLISHED" })]);
    let finish!: (result: unknown) => void;
    let characterId: string | undefined = "hero";
    (api.grantItem as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onInventoryGranted = vi.fn();
    const view = new ItemCatalogView(host, api, { onPreview: vi.fn(), onEdit: vi.fn(), onHistory: vi.fn(), getCharacterId: () => characterId, onInventoryGranted });
    await view.show();
    host.querySelector<HTMLButtonElement>("[data-action='grant']")!.click();
    if (mode === "destroy") { view.destroy(); host.textContent = "Replacement"; }
    else characterId = "another-hero";
    const contentBefore = host.textContent;
    finish({ characterId: "hero", inventory: { items: [], containerSlots: [null, null, null, null] } });
    await flush();
    expect(onInventoryGranted).not.toHaveBeenCalled();
    expect(host.textContent).toBe(contentBefore);
  });
});
