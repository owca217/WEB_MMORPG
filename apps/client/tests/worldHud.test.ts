/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorldHud } from "../src/ui/WorldHud";
import type { InventoryItem } from "@web-mmorpg/shared";

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("WorldHud session controls", () => {
  it("keeps four container slots directly in the HUD and opens the clicked slot", () => {
    const onContainerSlot = vi.fn();
    const hud = new WorldHud({ onContainerSlot, onCharacter: vi.fn(), onAdmin: vi.fn() });
    const slots = document.querySelectorAll<HTMLButtonElement>(".world-hud [data-container-slot]");

    expect(slots).toHaveLength(4);
    expect(document.querySelector(".world-hud [data-inventory]")).toBeNull();
    expect([...document.querySelectorAll(".world-hud button")].some((button) => button.textContent === "Ekwipunek")).toBe(false);
    expect([...slots].map((slot) => slot.getAttribute("aria-label"))).toEqual([
      "Pojemnik 1: pusty. Wybierz pojemnik", "Pojemnik 2: pusty. Wybierz pojemnik",
      "Pojemnik 3: pusty. Wybierz pojemnik", "Pojemnik 4: pusty. Wybierz pojemnik"
    ]);
    slots[2]!.click();
    expect(onContainerSlot).toHaveBeenCalledWith(2);
    hud.destroy();
  });

  it("renders equipped containers from the inventory snapshot with safe names and an icon fallback", () => {
    const hud = new WorldHud({ onCharacter: vi.fn(), onAdmin: vi.fn() });
    const container: InventoryItem = {
      instanceId: "bag", itemId: "bag-definition", itemDefinitionId: "bag-definition",
      category: "container", name: "<img src=x onerror=alert(1)>", description: "", quantity: 1,
      rarity: "COMMON", upgradeLevel: 0, iconUrl: "/missing-bag.png"
    };
    hud.updateInventory({ items: [container], containerSlots: [null, "bag", null, null] });

    const equipped = document.querySelector<HTMLButtonElement>('[data-container-slot="1"]')!;
    expect(equipped.textContent).toContain(container.name);
    expect(equipped.querySelectorAll("img")).toHaveLength(1);
    const icon = equipped.querySelector("img")!;
    icon.dispatchEvent(new Event("error"));
    expect(equipped.querySelector("img")).toBeNull();
    expect(equipped.querySelector("[data-container-icon]")?.textContent).toBe("▣");

    hud.updateInventory({ items: [container], containerSlots: [null, null, null, null] });
    expect(equipped.textContent).toContain("Pusty");
    hud.destroy();
  });

  it("derives ADMIN button visibility from the current SessionView role", () => {
    const hud = new WorldHud({
      onInventory: vi.fn(),
      onCharacter: vi.fn(),
      onAdmin: vi.fn(),
      onLogout: vi.fn()
    });
    const admin = document.querySelector<HTMLButtonElement>("[data-admin]");
    if (!admin) throw new Error("Admin button missing");

    hud.updateSession("PLAYER");
    expect(admin.hidden).toBe(true);
    hud.updateSession("ADMIN");
    expect(admin.hidden).toBe(false);
    hud.destroy();
  });

  it("exposes a logout action in the world HUD", () => {
    const onLogout = vi.fn();
    const hud = new WorldHud({
      onInventory: vi.fn(),
      onCharacter: vi.fn(),
      onAdmin: vi.fn(),
      onLogout
    });

    const logout = document.querySelector<HTMLButtonElement>("[data-logout]");
    expect(logout).not.toBeNull();
    logout?.click();
    expect(onLogout).toHaveBeenCalledTimes(1);
    hud.destroy();
  });
});
