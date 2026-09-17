import { describe, expect, it } from "vitest";
import { moveTowardTarget, resolveKeyboardIntent } from "../src/input/WorldInput";

describe("WorldInput", () => {
  it("normalizes keyboard movement", () => {
    expect(
      resolveKeyboardIntent({ left: false, right: true, up: false, down: false })
    ).toEqual({ dx: 1, dy: 0 });
  });

  it("normalizes diagonal movement so it is not faster", () => {
    const intent = resolveKeyboardIntent({ left: false, right: true, up: true, down: false });
    expect(Math.hypot(intent.dx, intent.dy)).toBeCloseTo(1);
  });

  it("moves toward a pointer target without overshooting", () => {
    expect(moveTowardTarget({ x: 0, y: 0 }, { x: 10, y: 0 }, 20)).toEqual({ x: 10, y: 0 });
  });
});
