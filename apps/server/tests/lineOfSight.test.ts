import { describe, expect, it } from "vitest";
import { hasLineOfSight } from "../src/battle/lineOfSight";

describe("line of sight", () => {
  it("is blocked by an obstacle between shooter and target", () => {
    const blockers = new Set(["1,0"]);
    expect(
      hasLineOfSight({ q: 0, r: 0 }, { q: 2, r: 0 }, blockers)
    ).toBe(false);
  });

  it("is clear when no blocking hex intersects the ray", () => {
    expect(
      hasLineOfSight({ q: 0, r: 0 }, { q: 2, r: 0 }, new Set())
    ).toBe(true);
  });
});
