import { describe, expect, it } from "vitest";
import { isAppearanceSelection } from "@web-mmorpg/shared";
import { CHARACTER_PRESETS, EYE_LABELS, spriteHeadIndex } from "../src/appearance/characterSprites";
import { drawEyes } from "../src/appearance/drawCharacterSprite";

describe("sprite creator", () => {
  it("supplies four server-valid presets with distinct hair and separate base clothing", () => {
    expect(CHARACTER_PRESETS).toHaveLength(4);
    for (const preset of CHARACTER_PRESETS) {
      expect(isAppearanceSelection(preset.appearance)).toBe(true);
      expect(preset.appearance.startingOutfit).toBe("outfit-base");
    }
    expect(new Set(CHARACTER_PRESETS.map(p => spriteHeadIndex(p.appearance.hair))).size).toBe(4);
  });
  it("draws closed, sad and angry eyes differently instead of falling back to normal eyes", () => {
    const shapes = Object.keys(EYE_LABELS).map(style => {
      const rectangles: number[][] = [];
      const context = { fillStyle: "", fillRect: (...rect: number[]) => rectangles.push(rect) };
      drawEyes(context as unknown as CanvasRenderingContext2D, style);
      return JSON.stringify(rectangles);
    });
    expect(new Set(shapes).size).toBe(Object.keys(EYE_LABELS).length);
  });
});
