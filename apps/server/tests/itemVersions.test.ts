import type { ItemDraftInput } from "@web-mmorpg/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminAuditRepository } from "../src/audit/AdminAuditRepository";
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
    description: "Pierwsza wersja.",
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

describeDatabase("item publication and version history", () => {
  const pool = createPool(databaseUrl);
  const metadata = new ItemMetadataRepository(pool);
  const service = new ItemCatalogService(pool, metadata);
  const audit = new AdminAuditRepository(pool);

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
    await pool.query("DELETE FROM item_subcategories WHERE system = FALSE");
    await pool.query("DELETE FROM item_categories WHERE system = FALSE");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("publishes v1, keeps a v2 draft isolated, then switches active definition on publish", async () => {
    await service.createDraft(sword(), actor);
    const v1 = await service.publish("iron-sword", 1, actor);

    expect(v1).toMatchObject({ versionNo: 1, state: "PUBLISHED", name: "Żelazny Miecz" });
    let details = await service.getItem("iron-sword");
    expect(details.item).toMatchObject({
      status: "PUBLISHED",
      activeVersionNo: 1,
      name: "Żelazny Miecz"
    });
    expect(details.draft).toBeUndefined();

    const draftV2 = await service.updateDraft(
      "iron-sword",
      sword({ name: "Żelazny Miecz v2", description: "Nowy balans." }),
      v1.revision,
      actor
    );
    expect(draftV2).toMatchObject({ versionNo: 2, revision: 1, state: "DRAFT" });

    details = await service.getItem("iron-sword");
    expect(details.item.name).toBe("Żelazny Miecz");
    expect(details.draft?.name).toBe("Żelazny Miecz v2");

    const publishedV2 = await service.publish("iron-sword", 1, actor);
    expect(publishedV2).toMatchObject({ versionNo: 2, state: "PUBLISHED" });
    details = await service.getItem("iron-sword");
    expect(details.item).toMatchObject({ activeVersionNo: 2, name: "Żelazny Miecz v2" });
    expect((await service.getVersion("iron-sword", 1)).name).toBe("Żelazny Miecz");
  });

  it("restores an old definition as a new published revision", async () => {
    await service.createDraft(sword(), actor);
    const v1 = await service.publish("iron-sword", 1, actor);
    await service.updateDraft(
      "iron-sword",
      sword({ name: "Nerf v2", description: "Druga wersja." }),
      v1.revision,
      actor
    );
    await service.publish("iron-sword", 1, actor);

    const restored = await service.restoreVersion("iron-sword", 1, actor);
    expect(restored).toMatchObject({
      versionNo: 3,
      state: "PUBLISHED",
      name: "Żelazny Miecz"
    });
    expect((await service.getItem("iron-sword")).item.activeVersionNo).toBe(3);
    expect((await service.getVersion("iron-sword", 2)).name).toBe("Nerf v2");

    const history = await service.listVersions("iron-sword");
    expect(history.map((entry) => entry.versionNo)).toEqual([3, 2, 1]);
  });

  it("duplicates into a new draft and archives without deleting references or history", async () => {
    await service.createDraft(sword(), actor);
    await service.publish("iron-sword", 1, actor);

    const copy = await service.duplicate("iron-sword", "iron-sword-copy", actor);
    expect(copy).toMatchObject({
      itemId: "iron-sword-copy",
      versionNo: 1,
      revision: 1,
      state: "DRAFT",
      name: "Żelazny Miecz"
    });

    await service.archive("iron-sword", actor);
    const source = await service.getItem("iron-sword");
    expect(source.item.status).toBe("ARCHIVED");
    expect((await service.getVersion("iron-sword", 1)).name).toBe("Żelazny Miecz");
    expect((await service.getItem("iron-sword-copy")).item.status).toBe("DRAFT");
  });

  it("records auditable mutations for items and custom categories", async () => {
    await service.createDraft(sword(), actor);
    await service.updateDraft(
      "iron-sword",
      sword({ description: "Zmieniony szkic." }),
      1,
      actor
    );
    await service.publish("iron-sword", 2, actor);
    await service.restoreVersion("iron-sword", 1, actor);
    await service.duplicate("iron-sword", "audit-copy", actor);
    await service.archive("iron-sword", actor);

    const itemLog = await audit.listForObject("item", "iron-sword");
    expect(itemLog.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "CREATE_DRAFT",
        "UPDATE_DRAFT",
        "PUBLISH",
        "RESTORE",
        "ARCHIVE"
      ])
    );
    expect(itemLog.every((entry) => entry.actorPlayerId === actor)).toBe(true);
    expect(itemLog.some((entry) => Object.keys(entry.summary).length > 0)).toBe(true);

    const copyLog = await audit.listForObject("item", "audit-copy");
    expect(copyLog.some((entry) => entry.action === "DUPLICATE")).toBe(true);

    await metadata.createCategory(
      {
        id: "audit-category",
        name: "Kategoria audytowa",
        allowedStatCodes: ["PHYSICAL_DAMAGE"]
      },
      actor
    );
    const categoryLog = await audit.listForObject("item_category", "audit-category");
    expect(categoryLog).toHaveLength(1);
    expect(categoryLog[0]).toMatchObject({
      actorPlayerId: actor,
      action: "CREATE_CATEGORY",
      objectType: "item_category",
      objectId: "audit-category"
    });
  });
});
