import { describe, expect, it } from "vitest";
import {
  ITEM_RARITIES,
  ITEM_STATUSES,
  MODIFIER_TYPES,
  type ItemDraftInput
} from "../src/items";
import { USER_ROLES } from "../src/admin";

describe("item catalog contracts", () => {
  it("exposes stable rarity, status and modifier values", () => {
    expect(ITEM_RARITIES).toEqual([
      "COMMON",
      "UNCOMMON",
      "RARE",
      "EPIC",
      "LEGENDARY"
    ]);
    expect(ITEM_STATUSES).toEqual(["DRAFT", "PUBLISHED", "ARCHIVED"]);
    expect(MODIFIER_TYPES).toEqual(["flat", "percent", "multiplier"]);
    expect(USER_ROLES).toEqual(["PLAYER", "ADMIN"]);
  });

  it("supports a representative item draft", () => {
    const draft: ItemDraftInput = {
      itemId: "iron-sword",
      name: "Żelazny Miecz",
      categoryId: "weapon",
      subcategoryId: "sword",
      description: "Prosty miecz wykuty z żelaza.",
      rarity: "COMMON",
      itemLevel: 5,
      minimumLevel: 3,
      sellValue: 125,
      sellable: true,
      tradable: true,
      droppable: true,
      stackable: false,
      maxStack: 1,
      weight: 2.5,
      soulbound: "NONE",
      unique: false,
      tags: ["starter"],
      stats: [
        { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 12 }
      ],
      requirements: [],
      effects: [],
      specialData: {}
    };

    expect(draft.stats[0]?.statCode).toBe("PHYSICAL_DAMAGE");
  });
});
