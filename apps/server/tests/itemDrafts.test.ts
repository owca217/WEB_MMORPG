import type { ItemDraftInput } from "@web-mmorpg/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sword(overrides: Partial<ItemDraftInput> = {}): ItemDraftInput {
  return {
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
    specialData: {},
    ...overrides
  };
}

describeDatabase("item draft workflow", () => {
  const pool = createPool(databaseUrl);
  const metadata = new ItemMetadataRepository(pool);
  const service = new ItemCatalogService(pool, metadata);

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE item_instances, item_tags, item_effects, item_requirements,
       item_stat_modifiers, item_versions, items, admin_audit_log CASCADE`
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates and reads a validated draft", async () => {
    const created = await service.createDraft(sword(), actor);

    expect(created).toMatchObject({
      itemId: "iron-sword",
      name: "Żelazny Miecz",
      versionNo: 1,
      revision: 1,
      state: "DRAFT"
    });
    expect(created.stats).toEqual([
      { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 12 }
    ]);

    const details = await service.getItem("iron-sword");
    expect(details.draft?.revision).toBe(1);
    expect(details.item.status).toBe("DRAFT");
  });

  it("rejects duplicate stable item IDs", async () => {
    await service.createDraft(sword(), actor);
    await expect(service.createDraft(sword({ name: "Drugi" }), actor)).rejects.toThrow(
      "ITEM_ID_CONFLICT:iron-sword"
    );
  });

  it("filters the catalog by search/category/status", async () => {
    await service.createDraft(sword(), actor);
    await service.createDraft(
      sword({ itemId: "steel-sword", name: "Stalowy Miecz" }),
      actor
    );

    const page = await service.listItems({
      search: "stalowy",
      categoryId: "weapon",
      status: "DRAFT",
      page: 1,
      pageSize: 20
    });

    expect(page.total).toBe(1);
    expect(page.items[0]?.itemId).toBe("steel-sword");
  });

  it("rejects an engine-valid stat that the selected category does not allow", async () => {
    await expect(
      service.createDraft(
        sword({
          itemId: "iron-ore",
          name: "Ruda żelaza",
          categoryId: "material",
          subcategoryId: "ore",
          stackable: true,
          maxStack: 99,
          stats: [
            { statCode: "CRIT_DAMAGE", modifierType: "percent", value: 500 }
          ]
        }),
        actor
      )
    ).rejects.toThrow("STAT_NOT_ALLOWED:CRIT_DAMAGE");
  });

  it("rejects invalid ranges and min/max damage inconsistency", async () => {
    await expect(
      service.createDraft(
        sword({
          stats: [
            { statCode: "CRIT_CHANCE", modifierType: "flat", value: 2000 }
          ]
        }),
        actor
      )
    ).rejects.toThrow("STAT_VALUE_OUT_OF_RANGE:CRIT_CHANCE");

    await expect(
      service.createDraft(
        sword({
          stats: [
            { statCode: "MIN_DAMAGE", modifierType: "flat", value: 20 },
            { statCode: "MAX_DAMAGE", modifierType: "flat", value: 10 }
          ]
        }),
        actor
      )
    ).rejects.toThrow("MIN_DAMAGE_EXCEEDS_MAX_DAMAGE");
  });

  it("rejects missing required fields but permits negative modifiers where the registry does", async () => {
    await expect(service.createDraft(sword({ name: "" }), actor)).rejects.toThrow(
      "INVALID_ITEM_DRAFT"
    );

    const negative = await service.createDraft(
      sword({
        itemId: "cursed-sword",
        name: "Przeklęty miecz",
        stats: [
          { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: -5 }
        ]
      }),
      actor
    );
    expect(negative.stats[0]?.value).toBe(-5);
  });

  it("detects stale concurrent draft updates without overwriting the winner", async () => {
    await service.createDraft(sword(), actor);

    const first = await service.updateDraft(
      "iron-sword",
      sword({ name: "Miecz po pierwszej zmianie" }),
      1,
      actor
    );
    expect(first.revision).toBe(2);

    await expect(
      service.updateDraft(
        "iron-sword",
        sword({ name: "Spóźniona zmiana" }),
        1,
        actor
      )
    ).rejects.toThrow("ITEM_CONFLICT:iron-sword");

    const details = await service.getItem("iron-sword");
    expect(details.draft?.name).toBe("Miecz po pierwszej zmianie");
    expect(details.draft?.revision).toBe(2);
  });
});
