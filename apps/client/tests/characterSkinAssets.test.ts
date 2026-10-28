import { describe, expect, it } from "vitest";
import { getCharacterSkinFrame } from "../src/characters/characterSkinAssets";

describe("character skin atlas cropping", () => {
  it.each([
    {
      skinId: "male-traveler", row: 2, column: 1,
      expected: { x: 256, y: 785, width: 256, height: 341, offsetY: 35 }
    },
    {
      skinId: "female-scout", row: 1, column: 3,
      expected: { x: 768, y: 391, width: 256, height: 372, offsetY: 4 }
    },
    {
      skinId: "female-guard", row: 3, column: 2,
      expected: { x: 512, y: 1149, width: 256, height: 329, offsetY: 47 }
    }
  ] as const)("crops $skinId row $row without cutting into the next silhouette", ({ skinId, row, column, expected }) => {
    expect(getCharacterSkinFrame(skinId, row, column)).toEqual(expected);
  });
});
