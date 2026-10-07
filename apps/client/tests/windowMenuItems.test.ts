import { describe, expect, it } from "vitest";
import { WORLD_WINDOW_MENU_ITEMS } from "../src/ui/windowMenuItems";

describe("world window menu items", () => {
  it("keeps the general inventory reachable independently of empty bag slots", () => {
    expect(WORLD_WINDOW_MENU_ITEMS).toContainEqual({ key: "inventory", label: "Ekwipunek" });
  });
});
