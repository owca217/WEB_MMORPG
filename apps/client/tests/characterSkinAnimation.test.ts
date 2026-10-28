import { describe, expect, it } from "vitest";
import {
  getCharacterAnimationFrames,
  resolveCharacterMotion
} from "../src/characters/characterSkinAnimation";

describe("character skin animation", () => {
  it.each([
    { dx: 4, dy: 1, direction: "east", frames: [8, 9, 10, 11] },
    { dx: -4, dy: 1, direction: "west", frames: [4, 5, 6, 7] },
    { dx: 1, dy: 4, direction: "south", frames: [0, 1, 2, 3] },
    { dx: 1, dy: -4, direction: "north", frames: [12, 13, 14, 15] }
  ] as const)("walks $direction using that direction's atlas row", ({ dx, dy, direction, frames }) => {
    const motion = resolveCharacterMotion(dx, dy, "south");

    expect(motion).toEqual({ direction, moving: true });
    expect(getCharacterAnimationFrames(motion.direction)).toEqual(frames);
  });

  it("keeps the previous facing direction when interpolation settles", () => {
    expect(resolveCharacterMotion(0.03, -0.04, "west")).toEqual({ direction: "west", moving: false });
    expect(resolveCharacterMotion(0, 0, "north")).toEqual({ direction: "north", moving: false });
  });

  it("uses vertical facing for equal diagonal movement", () => {
    expect(resolveCharacterMotion(3, -3, "east")).toEqual({ direction: "north", moving: true });
  });
});
