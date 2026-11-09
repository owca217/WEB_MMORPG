import type { ItemCreatorMetadata, ItemDraftInput } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { BASIC_EQUIPMENT_ITEMS } from "../src/items/basicEquipment";
import { validateItemDraft } from "../src/items/itemValidation";
import {
  ENGINE_SPECIAL_FIELDS, ENGINE_STATS, SYSTEM_CATEGORIES, SYSTEM_SUBCATEGORIES
} from "../src/items/statRegistry";

const metadata: ItemCreatorMetadata = {
  categories: SYSTEM_CATEGORIES.map((category) => ({ ...category, system: true,
    allowedStatCodes: [...category.allowedStatCodes],
    allowedSpecialFieldCodes: [...category.allowedSpecialFieldCodes] })),
  subcategories: SYSTEM_SUBCATEGORIES.map((subcategory) => ({ ...subcategory, system: true,
    allowedStatCodes: [...subcategory.allowedStatCodes],
    allowedSpecialFieldCodes: [...(subcategory.allowedSpecialFieldCodes
      ?? SYSTEM_CATEGORIES.find((category) => category.id === subcategory.categoryId)!.allowedSpecialFieldCodes)] })),
  stats: Object.values(ENGINE_STATS).map((stat) => ({ ...stat, modifierTypes: [...stat.modifierTypes] })),
  specialFields: Object.values(ENGINE_SPECIAL_FIELDS), triggers: [], effects: []
};

function armorDraft(subcategoryId: string, armorFamily: string): ItemDraftInput {
  return {
    itemId: "test-armor", name: "Testowy pancerz", categoryId: "armor", subcategoryId,
    description: "", rarity: "COMMON", itemLevel: 1, minimumLevel: 0, sellValue: 0,
    sellable: true, tradable: true, droppable: true, stackable: false, maxStack: 1,
    weight: 1, soulbound: "NONE", unique: false, tags: [], stats: [],
    requirements: [], effects: [], specialData: { armorSlot: subcategoryId, armorFamily }
  };
}

describe("armor specialization catalog", () => {
  it("lets the creator classify all six worn armor slots with the three supported families", () => {
    for (const slot of ["helmet", "chest", "gloves", "pants", "boots", "cloak"]) {
      for (const family of ["cloth", "leather", "plate"]) {
        expect(validateItemDraft(armorDraft(slot, family), metadata), `${family}:${slot}`)
          .toEqual({ ok: true });
      }
    }
    expect(validateItemDraft(armorDraft("chest", "invented"), metadata)).toMatchObject({
      ok: false, code: "SPECIAL_FIELD_VALUE_NOT_ALLOWED:armorFamily"
    });
    expect(validateItemDraft(armorDraft("shield", "plate"), metadata)).toMatchObject({
      ok: false, code: "SPECIAL_FIELD_NOT_ALLOWED:armorFamily"
    });
  });

  it("offers complete merchant sets whose family and supported armor, health and attribute stats survive creator validation", () => {
    for (const family of ["cloth", "leather", "plate"] as const) {
      for (const slot of ["helmet", "chest", "gloves", "pants", "boots", "cloak"]) {
        const item = BASIC_EQUIPMENT_ITEMS.find((entry) => entry.itemId === `${family}-${slot}`);
        expect(item, `${family}:${slot}`).toBeDefined();
        expect(item).toMatchObject({ categoryId: "armor", subcategoryId: slot, armorFamily: family });
        expect(item!.unitPrice).toBeGreaterThan(0);
        expect(item!.stats.some((stat) => stat.statCode === "ARMOR" && stat.value > 0)).toBe(true);
        const draft = { ...armorDraft(slot, family), stats: item!.stats };
        expect(validateItemDraft(draft, metadata), item!.itemId).toEqual({ ok: true });
        if (family !== "cloth") {
          expect(item!.stats.some((stat) => stat.statCode === "MAX_HP" && stat.value > 0)).toBe(true);
          expect(item!.stats.some((stat) => ["VITALITY", "DEXTERITY", "STRENGTH"].includes(stat.statCode)
            && stat.value > 0)).toBe(true);
        }
      }
    }
    expect(new Set(BASIC_EQUIPMENT_ITEMS.map((item) => item.itemId)).size).toBe(BASIC_EQUIPMENT_ITEMS.length);
    expect(BASIC_EQUIPMENT_ITEMS.find((item) => item.itemId === "training-shield"))
      .not.toHaveProperty("armorFamily");
  });
});
