import { randomUUID } from "node:crypto";
import type { ItemDefinition, ItemDraftInput } from "@web-mmorpg/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { InventoryService } from "../src/inventory/InventoryService";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
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

describeDatabase("persistent character inventory ownership", () => {
  const pool = createPool(databaseUrl);
  let characterId: string;

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);

    const accountId = randomUUID();
    await pool.query(
      `INSERT INTO accounts
        (id, username, username_normalized, password_hash, recovery_code_hash)
       VALUES ($1, 'InventoryOwner', 'inventoryowner', 'hash', 'recovery')`,
      [accountId]
    );
    const character = await new CharacterLifecycleService(pool).createCharacter(accountId, {
      nickname: "InventoryHero",
      appearance: {}
    });
    characterId = character.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("writes new item instances to character_id and leaves legacy player_id empty", async () => {
    const inventory = new InventoryService(pool);
    await inventory.addItems(characterId, [{ itemId: "wolf-pelt", quantity: 2 }]);

    const rows = await pool.query<{
      character_id: string | null;
      player_id: string | null;
      quantity: number;
    }>(
      `SELECT character_id, player_id, quantity
       FROM item_instances
       WHERE character_id = $1`,
      [characterId]
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toEqual({
      character_id: characterId,
      player_id: null,
      quantity: 2
    });
  });

  it("never exposes a legacy player_id row as inventory for a persistent character", async () => {
    const item = await pool.query<{ id: string }>(
      "SELECT id FROM items WHERE item_id = 'wolf-pelt'"
    );
    await pool.query(
      `INSERT INTO item_instances (id, player_id, character_id, item_id, quantity)
       VALUES ($1, $2, NULL, $3, 7)`,
      [randomUUID(), characterId, item.rows[0]!.id]
    );

    const snapshot = await new InventoryService(pool).getSnapshot(characterId);
    expect(snapshot.items).toEqual([]);
  });

  it("keeps the same character-owned instance while a newly published definition changes its display", async () => {
    const inventory = new InventoryService(pool);
    const metadata = new ItemMetadataRepository(pool);
    const catalog = new ItemCatalogService(pool, metadata);

    await inventory.addItems(characterId, [{ itemId: "wolf-pelt", quantity: 1 }]);
    const before = (await inventory.getSnapshot(characterId)).items[0]!;

    const details = await catalog.getItem("wolf-pelt");
    await catalog.updateDraft(
      "wolf-pelt",
      asDraft(details.item, {
        name: "Persistent Wolf Pelt v2",
        rarity: "UNCOMMON"
      }),
      1,
      actor
    );
    await catalog.publish("wolf-pelt", 1, actor);

    const after = (await inventory.getSnapshot(characterId)).items[0]!;
    expect(after.instanceId).toBe(before.instanceId);
    expect(after.quantity).toBe(1);
    expect(after).toMatchObject({
      name: "Persistent Wolf Pelt v2",
      rarity: "UNCOMMON"
    });
  });
});
