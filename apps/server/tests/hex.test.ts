import { describe, expect, it } from "vitest";
import { findPath, hexDistance, hexNeighbors } from "../src/battle/hex";

describe("hex math", () => {
  it("returns six neighbors", () => {
    expect(hexNeighbors({ q: 0, r: 0 })).toHaveLength(6);
  });

  it("calculates axial distance", () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
  });

  it("finds a path around blocked cells", () => {
    const path = findPath(
      { q: 0, r: 0 },
      { q: 2, r: 0 },
      new Set(["1,0"])
    );

    expect(path).not.toBeNull();
    expect(path?.at(-1)).toEqual({ q: 2, r: 0 });
    expect(path?.some((cell) => cell.q === 1 && cell.r === 0)).toBe(false);
  });
});
