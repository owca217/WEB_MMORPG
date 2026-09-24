import { describe, expect, it } from "vitest";
import { WalkAnimation, directionFromMovement } from "../src/appearance/walkAnimation";

describe("eight-direction walking", () => {
  it.each([
    [0, 1, "south"], [-1, 1, "southwest"], [-1, 0, "west"],
    [-1, -1, "northwest"], [0, -1, "north"], [1, -1, "northeast"],
    [1, 0, "east"], [1, 1, "southeast"]
  ] as const)("faces movement (%s, %s)", (x, y, direction) => {
    expect(directionFromMovement(x, y, "south")).toBe(direction);
    expect(directionFromMovement(x * 0.2, y * 0.2, "south")).toBe(direction);
  });

  it("keeps cardinal directions for mostly horizontal or vertical movement", () => {
    expect(directionFromMovement(10, 1, "south")).toBe("east");
    expect(directionFromMovement(-1, -10, "south")).toBe("north");
    expect(directionFromMovement(0, 0, "west")).toBe("west");
  });

  it("plays both steps with a neutral pose between them at 8 fps", () => {
    const walk = new WalkAnimation();
    expect(walk.frameName).toBe("south-1");
    walk.update(1, 0, 0);
    expect(walk.frameName).toBe("east-0");
    const frames = Array.from({ length: 4 }, () => {
      walk.update(1, 0, 125);
      return walk.frameName;
    });
    expect(frames).toEqual(["east-1", "east-2", "east-1", "east-0"]);
  });

  it("stops on the middle frame without losing its last facing", () => {
    const walk = new WalkAnimation();
    walk.update(-1, -1, 260);
    walk.update(0, 0, 16);
    expect(walk.frameName).toBe("northwest-1");
    walk.update(0.001, -0.001, 16);
    expect(walk.frameName).toBe("northwest-1");
    walk.update(1, 1, 16);
    expect(walk.frameName).toBe("southeast-0");
  });

  it("has the same phase at different rendering frame rates", () => {
    const slow = new WalkAnimation(), fast = new WalkAnimation();
    for (let i = 0; i < 10; i++) slow.update(1, 0, 30);
    for (let i = 0; i < 30; i++) fast.update(1, 0, 10);
    expect(slow.frameName).toBe(fast.frameName);
    expect(slow.frameName).toBe("east-2");
  });
});
