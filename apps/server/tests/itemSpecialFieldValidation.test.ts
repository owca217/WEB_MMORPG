import type { ItemCreatorMetadata, ItemDraftInput } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { validateItemDraft } from "../src/items/itemValidation";

const metadata = {
  categories: [{
    id: "tool", name: "Narzędzia", system: true, allowedStatCodes: [],
    allowedSpecialFieldCodes: ["durability", "maxDurability", "toolType"]
  }],
  subcategories: [], stats: [], triggers: [], effects: [],
  specialFields: [
    { code: "durability", label: "Trwałość", type: "number", minimum: 0, maximum: 1000 },
    { code: "maxDurability", label: "Maksymalna trwałość", type: "number", minimum: 0, maximum: 1000 },
    { code: "toolType", label: "Typ narzędzia", type: "select", options: [
      { value: "pickaxe", label: "Kilof" }, { value: "axe", label: "Siekiera" }
    ] },
    { code: "questId", label: "ID questa", type: "text", format: "id" }
  ]
} as unknown as ItemCreatorMetadata;

function draft(specialData: Record<string, unknown>): ItemDraftInput {
  return {
    itemId: "test-tool", name: "Testowe narzędzie", categoryId: "tool", description: "",
    rarity: "COMMON", itemLevel: 1, minimumLevel: 0, sellValue: 0,
    sellable: true, tradable: true, droppable: true, stackable: false, maxStack: 1,
    weight: 1, soulbound: "NONE", unique: false, tags: [], stats: [],
    requirements: [], effects: [], specialData
  };
}

describe("specialist item field validation", () => {
  it("accepts typed values from the selected category field pool", () => {
    expect(validateItemDraft(draft({ durability: 12, maxDurability: 24, toolType: "pickaxe" }), metadata))
      .toEqual({ ok: true });
  });
  it("rejects a known engine field that is not enabled for the category", () => {
    expect(validateItemDraft(draft({ questId: "find-the-key" }), metadata)).toMatchObject({
      ok: false, code: "SPECIAL_FIELD_NOT_ALLOWED:questId"
    });
  });
  it("rejects unknown fields, values outside their range, and invalid select options", () => {
    expect(validateItemDraft(draft({ inventedMechanic: true }), metadata)).toMatchObject({
      ok: false, code: "UNKNOWN_SPECIAL_FIELD_CODE:inventedMechanic"
    });
    expect(validateItemDraft(draft({ durability: -1 }), metadata)).toMatchObject({
      ok: false, code: "SPECIAL_FIELD_VALUE_OUT_OF_RANGE:durability"
    });
    expect(validateItemDraft(draft({ toolType: "laser-drill" }), metadata)).toMatchObject({
      ok: false, code: "SPECIAL_FIELD_VALUE_NOT_ALLOWED:toolType"
    });
  });
  it("requires maximum durability to be at least current durability", () => {
    expect(validateItemDraft(draft({ durability: 50, maxDurability: 40 }), metadata)).toMatchObject({
      ok: false, code: "SPECIAL_FIELD_RANGE_INCONSISTENT:durability:maxDurability"
    });
  });
});
