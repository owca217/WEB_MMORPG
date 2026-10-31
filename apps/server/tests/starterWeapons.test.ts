import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { createItemIconRouter } from "../src/http/createItemIconRouter";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { validateItemDraft } from "../src/items/itemValidation";
import { seedItemMetadata } from "../src/items/seedItemMetadata";

const databaseUrl = process.env.DATABASE_URL;
const databaseTarget = databaseUrl ? new URL(databaseUrl) : null;
const describeDatabase = databaseTarget && ["localhost", "127.0.0.1"].includes(databaseTarget.hostname)
  && ["/web_mmorpg_test", "/web_mmorpg_original_integration_tests"].includes(databaseTarget.pathname) ? describe : describe.skip;
const publicBaseUrl = "https://game.example.test";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const weaponTypes = [
  "sword", "axe", "hammer", "dagger", "spear", "bow", "crossbow", "staff", "wand",
  "offensive-shield", "two-handed"
];

// Use a disposable test database: this suite resets its schema before adding fixtures.
describeDatabase("starter weapon catalog", () => {
  const pool = createPool(databaseUrl);
  const metadata = new ItemMetadataRepository(pool);
  const catalog = new ItemCatalogService(pool, metadata);

  beforeAll(async () => {
    const databaseName = new URL(databaseUrl!).pathname.slice(1);
    if (!/(?:^|_)test(?:_|$)/.test(databaseName)) {
      throw new Error("Starter weapon tests require a disposable database with 'test' in its name.");
    }
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool, publicBaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("publishes one usable level-one weapon for every weapon subcategory", async () => {
    const page = await catalog.listItems({ categoryId: "weapon", pageSize: 100 });
    const starterItems = page.items.filter(item => item.itemId.startsWith("starter-"));
    const creatorMetadata = await metadata.listMetadata();

    expect(starterItems).toHaveLength(11);
    expect(page.items.some(item => item.itemId === "training-sword")).toBe(true);
    expect(starterItems.map(item => item.subcategoryId).sort()).toEqual([...weaponTypes].sort());
    for (const item of starterItems) {
      expect(item).toMatchObject({
        itemId: `starter-${item.subcategoryId}`,
        categoryId: "weapon", status: "PUBLISHED", activeVersionNo: 1,
        rarity: "COMMON", itemLevel: 1, minimumLevel: 1,
        stackable: false, maxStack: 1
      });
      expect(item.tags).toEqual(expect.arrayContaining(["starter", "weapon"]));
      expect(item.stats.some(stat => stat.value > 0)).toBe(true);
      expect(validateItemDraft(item, creatorMetadata)).toEqual({ ok: true });
      expect(item.iconKey).toMatch(/^db-icons-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/);
      expect(item.iconUrl).toBe(`${publicBaseUrl}/api/item-icons/${item.iconKey}`);
    }
    const legacy = (await catalog.getItem("field-bandage")).item;
    expect(legacy).toMatchObject({ minimumLevel: 0, sellValue: 0, stackable: true, maxStack: 20 });
  });

  it("serves every generated PNG unchanged through the public icon route", async () => {
    const app = express();
    app.use("/api/item-icons", createItemIconRouter(pool));

    for (const type of weaponTypes) {
      const item = (await catalog.getItem(`starter-${type}`)).item;
      const original = await readFile(new URL(`../assets/items/starter-${type}.png`, import.meta.url));
      const response = await request(app).get(`/api/item-icons/${item.iconKey}`).expect(200);
      expect(response.headers["content-type"]).toMatch(/^image\/png/);
      expect(response.headers["cache-control"]).toContain("immutable");
      expect(Buffer.from(response.body).equals(original)).toBe(true);
    }
  });

  it("reseeds without duplicate definitions or icons and preserves authored versions and instance state", async () => {
    const original = await catalog.getItem("starter-sword");
    const authored = await catalog.updateDraft("starter-sword", {
      ...original.item,
      name: "Miecz po autorskiej zmianie",
      description: "Własny balans i ikona administratora.",
      iconKey: "custom-sword-icon",
      iconUrl: "https://assets.example.test/custom-sword.png",
      stats: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 43 }]
    }, 1, actor);
    await catalog.publish("starter-sword", authored.revision, actor);
    const before = await catalog.getItem("starter-sword");
    const instanceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await pool.query(
      `INSERT INTO item_instances (id, player_id, item_id, quantity, durability, max_durability,
         upgrade_level, affixes, sockets, bound_to_player_id)
       SELECT $1, $2, id, 1, 17, 40, 2, '[{"code":"custom"}]'::jsonb, '["ruby"]'::jsonb, $2
       FROM items WHERE item_id = 'starter-sword'`,
      [instanceId, actor]
    );
    const instanceBefore = (await pool.query("SELECT * FROM item_instances WHERE id = $1", [instanceId])).rows[0];
    const countsBefore = (await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM items) AS items,
      (SELECT COUNT(*)::int FROM item_versions) AS versions,
      (SELECT COUNT(*)::int FROM item_icon_assets) AS icons`)).rows[0];

    await seedItemMetadata(pool, publicBaseUrl);

    expect(await catalog.getItem("starter-sword")).toEqual(before);
    expect((await pool.query("SELECT * FROM item_instances WHERE id = $1", [instanceId])).rows[0]).toEqual(instanceBefore);
    expect((await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM items) AS items,
      (SELECT COUNT(*)::int FROM item_versions) AS versions,
      (SELECT COUNT(*)::int FROM item_icon_assets) AS icons`)).rows[0]).toEqual(countsBefore);
    expect(countsBefore.icons).toBe(11);
  });
});
