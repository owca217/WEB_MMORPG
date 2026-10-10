import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("item creator metadata", () => {
  const pool = createPool(databaseUrl);
  const repository = new ItemMetadataRepository(pool);

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("seeds all approved system categories with representative restrictions", async () => {
    const metadata = await repository.listMetadata();
    const systemCategories = metadata.categories.filter((category) => category.system);

    expect(systemCategories.map((category) => category.id).sort()).toEqual(
      [
        "ammunition",
        "armor",
        "backpack",
        "consumable",
        "container",
        "crafting-item",
        "jewelry",
        "key",
        "material",
        "quest",
        "rune-gem",
        "special",
        "tool",
        "upgrade-item",
        "weapon"
      ].sort()
    );

    const sword = metadata.subcategories.find(
      (subcategory) => subcategory.categoryId === "weapon" && subcategory.id === "sword"
    );
    const armor = metadata.categories.find((category) => category.id === "armor");
    const material = metadata.categories.find((category) => category.id === "material");

    expect(sword?.allowedStatCodes).toEqual(
      expect.arrayContaining(["PHYSICAL_DAMAGE", "ATTACK_SPEED", "CRIT_CHANCE"])
    );
    expect(armor?.allowedStatCodes).toEqual(
      expect.arrayContaining(["ARMOR", "MAX_HP", "MAGIC_RESIST"])
    );
    expect(material?.allowedStatCodes).not.toContain("CRIT_DAMAGE");
    expect(material?.allowedSpecialFieldCodes).toEqual(
      expect.arrayContaining(["quality", "tier", "materialType", "craftingTags"])
    );
    expect(material?.allowedSpecialFieldCodes).not.toContain("weaponFamily");
  });

  it("is idempotent and preserves the same creator metadata", async () => {
    const before = await repository.listMetadata();
    await seedItemMetadata(pool);
    const after = await repository.listMetadata();

    expect(after).toEqual(before);
  });

  it("lets custom categories reuse known engine stats", async () => {
    const created = await repository.createCategory(
      {
        id: "firearm",
        name: "Broń palna",
        allowedStatCodes: ["PHYSICAL_DAMAGE", "ACCURACY", "RELOAD_TIME"],
        allowedSpecialFieldCodes: ["ammoDamage", "damageType"]
      },
      "admin-player"
    );

    expect(created).toMatchObject({
      id: "firearm",
      name: "Broń palna",
      system: false
    });
    expect(created.allowedStatCodes).toEqual([
      "ACCURACY",
      "PHYSICAL_DAMAGE",
      "RELOAD_TIME"
    ]);
    expect(created.allowedSpecialFieldCodes).toEqual(["ammoDamage", "damageType"]);

    const subcategory = await repository.createSubcategory(
      {
        id: "rifle",
        categoryId: "firearm",
        name: "Karabin",
        allowedStatCodes: ["PHYSICAL_DAMAGE", "ACCURACY"],
        allowedSpecialFieldCodes: ["ammoDamage"]
      },
      "admin-player"
    );

    expect(subcategory).toMatchObject({
      id: "rifle",
      categoryId: "firearm",
      name: "Karabin",
      system: false,
      allowedSpecialFieldCodes: ["ammoDamage"]
    });
  });

  it("updates category and subcategory specialist field mappings", async () => {
    const updatedCategory = await repository.updateCategoryAllowedSpecialFields(
      "weapon",
      ["weaponFamily", "durability"],
      "admin-player"
    );
    expect(updatedCategory.allowedSpecialFieldCodes).toEqual(["durability", "weaponFamily"]);

    const updatedSubcategory = await repository.updateSubcategoryAllowedSpecialFields(
      "weapon",
      "sword",
      ["weaponFamily"],
      "admin-player"
    );
    expect(updatedSubcategory.allowedSpecialFieldCodes).toEqual(["weaponFamily"]);

    await seedItemMetadata(pool);
    const afterReseed = await repository.listMetadata();
    expect(
      afterReseed.categories.find((entry) => entry.id === "weapon")?.allowedSpecialFieldCodes
    ).toEqual(["durability", "weaponFamily"]);
    expect(
      afterReseed.subcategories.find((entry) => entry.id === "sword")?.allowedSpecialFieldCodes
    ).toEqual(["weaponFamily"]);
  });

  it("rejects mappings to unknown engine specialist fields", async () => {
    await expect(
      repository.createCategory(
        {
          id: "invalid-fields",
          name: "Niepoprawna",
          allowedStatCodes: [],
          allowedSpecialFieldCodes: ["madeUpMechanic"]
        },
        "admin-player"
      )
    ).rejects.toThrow("UNKNOWN_SPECIAL_FIELD_CODE:madeUpMechanic");
  });

  it("rejects inherited object keys as specialist fields", async () => {
    await expect(
      repository.createCategory(
        {
          id: "inherited-field",
          name: "Niepoprawna",
          allowedStatCodes: [],
          allowedSpecialFieldCodes: ["constructor"]
        },
        "admin-player"
      )
    ).rejects.toThrow("UNKNOWN_SPECIAL_FIELD_CODE:constructor");
  });

  it("rejects custom mappings to unknown engine stat codes", async () => {
    await expect(
      repository.createCategory(
        {
          id: "invalid-category",
          name: "Niepoprawna",
          allowedStatCodes: ["superLaserDamage"]
        },
        "admin-player"
      )
    ).rejects.toThrow("UNKNOWN_STAT_CODE:superLaserDamage");
  });
});
