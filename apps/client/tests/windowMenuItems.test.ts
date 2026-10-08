import { describe, expect, it } from "vitest";
import {
  WORLD_WINDOW_MENU_ITEMS,
  worldWindowMenuItems
} from "../src/ui/windowMenuItems";

describe("world window menu items", () => {
  it("keeps the general inventory reachable independently of empty bag slots", () => {
    expect(WORLD_WINDOW_MENU_ITEMS).toContainEqual({ key: "inventory", label: "Ekwipunek" });
  });

  it("puts the admin entry after logout only for administrators", () => {
    const playerItems = worldWindowMenuItems(false);
    const adminItems = worldWindowMenuItems(true);
    expect(playerItems.some((item) => item.key === "admin")).toBe(false);
    expect(adminItems.at(-2)).toEqual({ key: "logout", label: "Wyloguj" });
    expect(adminItems.at(-1)).toEqual({ key: "admin", label: "Panel admin" });
  });
});
