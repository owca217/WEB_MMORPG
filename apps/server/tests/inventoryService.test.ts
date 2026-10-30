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

  it("seeds an equipable eight-place rag bag without granting an instance automatically", async () => {
    expect((await catalog.getItem("rag-bag")).item).toMatchObject({
      itemId: "rag-bag",
      name: "Szmaciany worek",
      categoryId: "container",
      status: "PUBLISHED",
      activeVersionNo: 1,
      stackable: false,
      maxStack: 1,
      specialData: { capacity: 8 }
    });
    const inventory = new InventoryService(pool);
    const initial = await inventory.getSnapshot(characterId);
    expect(initial.items).toEqual([expect.objectContaining({ permanentContainer: true, containerCapacity: 16 })]);
    const backpack = initial.items[0]!;
    const snapshot = await inventory.addItems(characterId, [{ itemId: "rag-bag", quantity: 1 }]);
    const bag = snapshot.items.find(item => item.itemId === "rag-bag")!;
    expect(bag).toMatchObject({ name: "Szmaciany worek", category: "container", containerCapacity: 8 });
    expect((await inventory.setContainerSlot(characterId, 2, bag.instanceId)).containerSlots)
      .toEqual([backpack.instanceId, null, bag.instanceId, null]);
  });

  it("preserves edited rag bag definitions on reseed and resolves their published capacity", async () => {
    const inventory = new InventoryService(pool);
    const bag = (await inventory.addItems(characterId, [{ itemId: "rag-bag", quantity: 1 }])).items.find(item => item.itemId === "rag-bag")!;
    await pool.query("UPDATE item_instances SET container_capacity = 4 WHERE id = $1", [bag.instanceId]);
    const source = (await catalog.getItem("rag-bag")).item;
    await catalog.updateDraft("rag-bag", asDraft(source, {
      name: "Uszyty worek",
      specialData: { capacity: 12 }
    }), 1, actor);
    await catalog.publish("rag-bag", 1, actor);
    await seedItemMetadata(pool);
    await seedItemMetadata(pool);
    expect((await catalog.getItem("rag-bag")).item).toMatchObject({
      name: "Uszyty worek", activeVersionNo: 2, specialData: { capacity: 12 }
    });
    expect((await inventory.getSnapshot(characterId)).items).toEqual([
      expect.objectContaining({ permanentContainer: true, containerCapacity: 16 }),
      expect.objectContaining({ instanceId: bag.instanceId, name: "Uszyty worek", containerCapacity: 12 })
    ]);
  });

  it("uses valid legacy bag capacity when the published definition has none", async () => {
    const inventory = new InventoryService(pool);
    const snapshot = await inventory.addItems(characterId, [
      { itemId: "rag-bag", quantity: 1 }, { itemId: "simple-bag", quantity: 1 }
    ]);
    const source = (await catalog.getItem("rag-bag")).item;
    await catalog.updateDraft("rag-bag", asDraft(source, { specialData: {} }), 1, actor);
    await catalog.publish("rag-bag", 1, actor);
    for (const item of snapshot.items.filter(item => !item.permanentContainer)) {
      await pool.query("UPDATE item_instances SET container_capacity = 8 WHERE id = $1", [item.instanceId]);
    }
    expect((await inventory.getSnapshot(characterId)).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "rag-bag", containerCapacity: 8 }),
      expect.objectContaining({ itemId: "simple-bag", containerCapacity: 8 })
    ]));
    await pool.query("UPDATE item_instances SET container_capacity = 0 WHERE character_id = $1 AND NOT permanent_container", [characterId]);
    for (const item of (await inventory.getSnapshot(characterId)).items.filter(item => !item.permanentContainer)) {
      expect(item).not.toHaveProperty("containerCapacity");
    }
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
      "SELECT COUNT(*)::text AS count FROM item_instances WHERE character_id = $1 AND player_id IS NULL AND NOT permanent_container",
      [characterId]
    );
    expect(rows.rows[0]?.count).toBe("2");
  });

  it("keeps instance identity/quantity while a newly published definition changes displayed base data", async () => {
    const inventory = new InventoryService(pool);
    await inventory.addItems(characterId, [{ itemId: "wolf-pelt", quantity: 2 }]);
    const before = (await inventory.getSnapshot(characterId)).items.find(item => item.itemId === "wolf-pelt")!;

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

    const after = (await inventory.getSnapshot(characterId)).items.find(item => item.itemId === "wolf-pelt")!;
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
    const saved = (await first.getSnapshot(characterId)).items.find(item => item.itemId === "field-bandage")!;

    const restarted = new InventoryService(pool);
    const restored = (await restarted.getSnapshot(characterId)).items.find(item => item.itemId === "field-bandage")!;

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
