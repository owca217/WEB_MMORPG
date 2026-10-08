import { describe, expect, it } from "vitest";
import {
  fitInventoryTitleFontSize,
  inventoryPanelTitle
} from "../src/ui/inventoryTitle";

describe("inventory panel title", () => {
  it("uses the selected bag name in the panel title", () => {
    expect(inventoryPanelTitle("Zwykły worek")).toBe("Zwykły worek");
  });

  it("keeps the general inventory title when no bag is selected", () => {
    expect(inventoryPanelTitle(null)).toBe("Ekwipunek");
  });

  it("keeps the base font size when the title fits", () => {
    expect(fitInventoryTitleFontSize(120, 160, 27)).toBe(27);
  });

  it("reduces the font size for a long title while preserving a safety margin", () => {
    const fontSize = fitInventoryTitleFontSize(300, 160, 27);

    expect(fontSize).toBeLessThan(27);
    expect(fontSize).toBeGreaterThanOrEqual(8);
    expect(300 * fontSize / 27).toBeLessThanOrEqual(160);
  });
});
