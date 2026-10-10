import { describe, expect, it } from "vitest";
import { BAG_DEFINITIONS } from "../src/inventory";

describe("bag definitions", () => {
  it("lists the four bags with their intended capacities", () => {
    expect(
      Object.entries(BAG_DEFINITIONS).map(([itemId, bag]) => [
        itemId,
        bag.name,
        bag.capacity
      ])
    ).toEqual([
      ["simple-bag", "Zwykły worek", 8],
      ["traditional-backpack", "Tradycyjny plecak", 20],
      ["travel-backpack", "Plecak podróżny", 40],
      ["expedition-backpack", "Plecak ekspedycyjny", 60]
    ]);
  });
});
