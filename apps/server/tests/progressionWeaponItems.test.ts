import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STARTER_WEAPON_ITEMS } from "../src/items/starterWeaponItems";
import { ENGINE_STATS, SYSTEM_CATEGORIES, SYSTEM_SUBCATEGORIES } from "../src/items/statRegistry";

describe("progression weapon catalog", () => {
  it("provides all approved tiers without colliding with existing seed identities", async () => {
    expect(existsSync(new URL("../src/items/progressionWeaponItems.ts", import.meta.url))).toBe(true);
    const { PROGRESSION_WEAPON_ITEMS: items } = await import("../src/items/progressionWeaponItems");
    expect(items).toHaveLength(66);
    const levels = [1, 5, 10, 15, 20, 30];
    const qualities = ["BASIC", "NORMAL", "GOOD", "EXCELLENT", "PERFECT", "MASTERWORK"];
    const rarities = ["COMMON", "COMMON", "UNCOMMON", "UNCOMMON", "RARE", "RARE"];
    const profiles: Record<string, Record<string, number[]>> = {
      sword: { PHYSICAL_DAMAGE: [12,17,23,29,35,47], ARMOR: [2,3,4,5,6,8] },
      axe: { PHYSICAL_DAMAGE: [13,19,25,32,39,52] },
      hammer: { PHYSICAL_DAMAGE: [11,15,21,26,31,42], ARMOR: [4,6,8,10,12,16] },
      dagger: { PHYSICAL_DAMAGE: [11,15,21,26,31,42], INITIATIVE: [2,2,3,3,4,4] },
      spear: { PHYSICAL_DAMAGE: [12,17,23,29,35,47], INITIATIVE: [1,1,1,2,2,2] },
      bow: { PHYSICAL_DAMAGE: [23,35,49,63,78,106] },
      crossbow: { PHYSICAL_DAMAGE: [23,35,49,63,78,106] },
      staff: { PHYSICAL_DAMAGE: [6,9,12,15,18,24], SPELL_POWER: [12,17,23,29,35,47] },
      wand: { MAGIC_DAMAGE: [12,19,27,35,44,61] },
      "offensive-shield": { PHYSICAL_DAMAGE: [4,6,9,11,13,18], MAGIC_DAMAGE: [4,5,7,9,11,15], BLOCK_POWER: [0,0,0,0,0,0] },
      "two-handed": { PHYSICAL_DAMAGE: [25,35,47,60,72,97] }
    };
    for (const [category, profile] of Object.entries(profiles)) {
      for (const [index, level] of levels.entries()) {
        const item = items.find((entry) => entry.itemId === `progression-${category}-${level}`)!;
        expect(item).toMatchObject({ categoryId: "weapon", subcategoryId: category, minimumLevel: level,
          itemLevel: level, quality: qualities[index], rarity: rarities[index], sellValue: 5 + 2 * level,
          stackable: false, maxStack: 1, specialData: { durability: 40, maxDurability: 40, socketCount: 0 } });
        expect(item.weight).toBe(STARTER_WEAPON_ITEMS.find((seed) => seed.subcategoryId === category)!.weight);
        expect(item.icon!.assetUrl.pathname).toContain(`/assets/items/${item.itemId}.png`);
        expect(Object.fromEntries(item.stats!.map((stat) => [stat.statCode, stat.value]))).toEqual(
          Object.fromEntries(Object.entries(profile).map(([code, values]) => [code, values[index]]))
        );
        expect(item.stats!.every((stat) => stat.modifierType === "flat")).toBe(true);
        expect(item.specialData?.weaponFamily).toBe(category === "offensive-shield" ? undefined : category === "two-handed" ? "sword" : category);
      }
    }
    expect(new Set(items.map((item) => item.name)).size).toBe(66);
    expect(new Set(items.map((item) => item.description)).size).toBe(66);
    const identities = items.flatMap((item) => [item.itemUuid, item.versionUuid, item.icon!.key, ...item.stats!.map((stat) => stat.id)]);
    expect(new Set(identities).size).toBe(identities.length);
    const old = new Set(STARTER_WEAPON_ITEMS.flatMap((item) => [item.itemUuid, item.versionUuid, item.icon!.key, ...item.stats!.map((stat) => stat.id)]));
    expect(identities.some((id) => old.has(id))).toBe(false);
  });
  it("exposes every progression stat through the item creator restrictions", async () => {
    const { PROGRESSION_WEAPON_ITEMS: items } = await import("../src/items/progressionWeaponItems");
    const allowed = SYSTEM_CATEGORIES.find((entry) => entry.id === "weapon")!.allowedStatCodes;
    for (const item of items) {
      const subcategory = SYSTEM_SUBCATEGORIES.find((entry) => entry.id === item.subcategoryId)!;
      for (const stat of item.stats!) {
        expect(ENGINE_STATS[stat.statCode], stat.statCode).toBeDefined();
        expect(allowed, stat.statCode).toContain(stat.statCode);
        expect(subcategory.allowedStatCodes, `${item.itemId}: ${stat.statCode}`).toContain(stat.statCode);
      }
    }
  });
});
