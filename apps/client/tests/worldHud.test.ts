/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorldHud } from "../src/ui/WorldHud";

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("WorldHud session controls", () => {
  it("derives ADMIN button visibility from the current SessionView role", () => {
    const hud = new WorldHud({
      onInventory: vi.fn(),
      onOpenBagStorage: vi.fn(),
      onContainerSlotChange: vi.fn(),
      onMoveItem: vi.fn(),
      onCharacter: vi.fn(),
      onStatistics: vi.fn(),
      onProfessions: vi.fn(),
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
      onOpenBagStorage: vi.fn(),
      onContainerSlotChange: vi.fn(),
      onMoveItem: vi.fn(),
      onCharacter: vi.fn(),
      onStatistics: vi.fn(),
      onProfessions: vi.fn(),
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
