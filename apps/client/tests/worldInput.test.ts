import { describe, expect, it } from "vitest";
import {
  moveTowardTarget,
  normalizeAnalogIntent,
  resolveKeyboardIntent
} from "../src/input/WorldInput";

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

  it("converts joystick offset into proportional analog movement", () => {
    expect(normalizeAnalogIntent({ x: 50, y: 0 }, 80)).toEqual({ dx: 0.625, dy: 0 });
  });

  it("clamps diagonal joystick input to unit magnitude", () => {
    const diagonal = normalizeAnalogIntent({ x: 100, y: 100 }, 80);
    expect(Math.hypot(diagonal.dx, diagonal.dy)).toBeLessThanOrEqual(1);
  });

  it("uses a small joystick deadzone", () => {
    expect(normalizeAnalogIntent({ x: 2, y: 2 }, 80)).toEqual({ dx: 0, dy: 0 });
  });
});
