import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, isAppearanceSelection } from "../src/appearance";

describe("eye expression persistence contract", () => {
  it.each(["eyes-sad", "eyes-angry", "eyes-closed"])("accepts %s through the server appearance validator", eyes => {
    const saved = JSON.parse(JSON.stringify({ ...DEFAULT_APPEARANCE, eyes }));
    expect(isAppearanceSelection(saved)).toBe(true);
    expect(saved.eyes).toBe(eyes);
  });
  it("keeps legacy appearances valid and rejects unknown expressions", () => {
    expect(isAppearanceSelection(DEFAULT_APPEARANCE)).toBe(true);
    expect(isAppearanceSelection({ ...DEFAULT_APPEARANCE, eyes: "unknown" })).toBe(false);
  });
});
