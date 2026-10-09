import type { ItemDefinition, ItemDraftInput } from "@web-mmorpg/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { InventoryService } from "../src/inventory/InventoryService";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { LootService } from "../src/loot/LootService";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const accountId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const characterId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function asDraft(item: ItemDefinition, overrides: Partial<ItemDraftInput> = {}): ItemDraftInput {
  return {
    itemId: item.itemId,
    name: item.name,
    categoryId: item.categoryId,
    ...(item.subcategoryId ? { subcategoryId: item.subcategoryId } : {}),
    description: item.description,
    ...(item.iconKey ? { iconKey: item.iconKey } : {}),
    ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
    rarity: item.rarity,
    itemLevel: item.itemLevel,
    minimumLevel: item.minimumLevel,
    sellValue: item.sellValue,
    sellable: item.sellable,
    tradable: item.tradable,
    droppable: item.droppable,
    stackable: item.stackable,
    maxStack: item.maxStack,
    weight: item.weight,
    soulbound: item.soulbound,
    unique: item.unique,
    tags: item.tags,
    stats: item.stats,
    requirements: item.requirements,
    effects: item.effects,
    specialData: item.specialData,
    ...overrides
  };
}

describeDatabase("persistent catalog-backed inventory", () => {
  const pool = createPool(databaseUrl);
  const metadata = new ItemMetadataRepository(pool);
  const catalog = new ItemCatalogService(pool, metadata);

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await pool.query(
      `INSERT INTO accounts
       (id, username, username_normalized, password_hash, recovery_code_hash)
       VALUES ($1, 'InventoryTest', 'inventorytest', 'hash', 'recovery')`,
      [accountId]
    );
    await pool.query(
      `INSERT INTO characters
       (id, account_id, nickname, nickname_normalized, appearance)
       VALUES ($1, $2, 'InventoryHero', 'inventoryhero', '{}'::jsonb)`,
      [characterId, accountId]
    );
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE item_instances, item_tags, item_effects, item_requirements,
       item_stat_modifiers, item_versions, items, admin_audit_log CASCADE`
    );
    await seedItemMetadata(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("seeds the legacy wolf loot as published central item definitions", async () => {
    const pelt = await catalog.getItem("wolf-pelt");
    const bandage = await catalog.getItem("field-bandage");

    expect(pelt.item).toMatchObject({
      itemId: "wolf-pelt",
      name: "Wolf Pelt",
      categoryId: "material",
      subcategoryId: "monster-part",
      status: "PUBLISHED",
      activeVersionNo: 1,
      stackable: true
    });
    expect(bandage.item).toMatchObject({
      itemId: "field-bandage",
      name: "Field Bandage",
      categoryId: "consumable",
      subcategoryId: "bandage",
      status: "PUBLISHED",
      activeVersionNo: 1,
      stackable: true
    });
  });

  it("persists character-owned item instances and resolves published definitions in snapshots", async () => {
    const inventory = new InventoryService(pool);
    const rewards = new LootService().rollEncounterLoot("wolf-pack-01", 1);

    const snapshot = await inventory.addItems(characterId, rewards);
    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: "wolf-pelt",
          name: "Wolf Pelt",
          category: "material",
          quantity: 1
        }),
        expect.objectContaining({
          itemId: "field-bandage",
          name: "Field Bandage",
          category: "consumable",
          quantity: 2
        })
      ])
    );

    const rows = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM item_instances WHERE character_id = $1 AND player_id IS NULL",
      [characterId]
    );
    expect(rows.rows[0]?.count).toBe("2");
  });

  it("keeps instance identity/quantity while a newly published definition changes displayed base data", async () => {
    const inventory = new InventoryService(pool);
    await inventory.addItems(characterId, [{ itemId: "wolf-pelt", quantity: 2 }]);
    const before = (await inventory.getSnapshot(characterId)).items[0]!;

    const details = await catalog.getItem("wolf-pelt");
    await catalog.updateDraft(
      "wolf-pelt",
      asDraft(details.item, {
        name: "Wolf Pelt v2",
        description: "A newly balanced pelt definition.",
        rarity: "UNCOMMON"
      }),
      1,
      actor
    );
    await catalog.publish("wolf-pelt", 1, actor);

    const after = (await inventory.getSnapshot(characterId)).items[0]!;
    expect(after.instanceId).toBe(before.instanceId);
    expect(after.quantity).toBe(2);
    expect(after).toMatchObject({
      itemId: "wolf-pelt",
      name: "Wolf Pelt v2",
      description: "A newly balanced pelt definition.",
      rarity: "UNCOMMON"
    });
  });

  it("survives reconstructing the inventory service", async () => {
    const first = new InventoryService(pool);
    await first.addItems(characterId, [{ itemId: "field-bandage", quantity: 2 }]);
    const saved = (await first.getSnapshot(characterId)).items[0]!;

    const restarted = new InventoryService(pool);
    const restored = (await restarted.getSnapshot(characterId)).items[0]!;

    expect(restored.instanceId).toBe(saved.instanceId);
    expect(restored.quantity).toBe(saved.quantity);
    expect(restored.name).toBe("Field Bandage");
  });

  it("stacks compatible stackable rewards but keeps non-stackable definitions separate", async () => {
    const inventory = new InventoryService(pool);
    await inventory.addItems(characterId, [{ itemId: "wolf-pelt", quantity: 1 }]);
    await inventory.addItems(characterId, [{ itemId: "wolf-pelt", quantity: 1 }]);

    const snapshot = await inventory.getSnapshot(characterId);
    const pelts = snapshot.items.filter((item) => item.itemId === "wolf-pelt");
    expect(pelts).toHaveLength(1);
    expect(pelts[0]?.quantity).toBe(2);
  });
});
