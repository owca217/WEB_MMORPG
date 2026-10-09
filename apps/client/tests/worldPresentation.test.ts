import { describe, expect, it } from "vitest";
import { FOREST_SETTLEMENT_LAYOUT } from "../src/world/ForestSettlementLayout";

function contains(
  rect: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number }
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

describe("forest settlement presentation layout", () => {
  it("places spawn in settlement and wolves in forest outskirts", () => {
    expect(contains(FOREST_SETTLEMENT_LAYOUT.settlement, FOREST_SETTLEMENT_LAYOUT.spawn)).toBe(true);
    expect(contains(FOREST_SETTLEMENT_LAYOUT.forest, FOREST_SETTLEMENT_LAYOUT.wolfEncounter)).toBe(true);
  });

  it("keeps the authored layout inside the 1600x900 world", () => {
    expect(FOREST_SETTLEMENT_LAYOUT.width).toBe(1600);
    expect(FOREST_SETTLEMENT_LAYOUT.height).toBe(900);
    expect(FOREST_SETTLEMENT_LAYOUT.gate.x + FOREST_SETTLEMENT_LAYOUT.gate.width).toBeLessThanOrEqual(1600);
    expect(FOREST_SETTLEMENT_LAYOUT.forest.y + FOREST_SETTLEMENT_LAYOUT.forest.height).toBeLessThanOrEqual(900);
  });
});
