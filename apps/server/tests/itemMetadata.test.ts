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
        allowedStatCodes: ["PHYSICAL_DAMAGE", "ACCURACY", "RELOAD_TIME"]
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

    const subcategory = await repository.createSubcategory(
      {
        id: "rifle",
        categoryId: "firearm",
        name: "Karabin",
        allowedStatCodes: ["PHYSICAL_DAMAGE", "ACCURACY"]
      },
      "admin-player"
    );

    expect(subcategory).toMatchObject({
      id: "rifle",
      categoryId: "firearm",
      name: "Karabin",
      system: false
    });
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
