import type { PoolClient } from "pg";

interface StarterItemSeed {
  itemUuid: string;
  versionUuid: string;
  itemId: string;
  name: string;
  categoryId: string;
  subcategoryId: string;
  description: string;
  maxStack: number;
  weight: number;
}

const seedActor = "00000000-0000-4000-8000-000000000001";

const STARTER_ITEMS: readonly StarterItemSeed[] = [
  {
    itemUuid: "10000000-0000-4000-8000-000000000001",
    versionUuid: "10000000-0000-4000-8000-000000000011",
    itemId: "wolf-pelt",
    name: "Wolf Pelt",
    categoryId: "material",
    subcategoryId: "monster-part",
    description: "A rough pelt taken from a forest wolf.",
    maxStack: 99,
    weight: 0.5
  },
  {
    itemUuid: "10000000-0000-4000-8000-000000000002",
    versionUuid: "10000000-0000-4000-8000-000000000012",
    itemId: "field-bandage",
    name: "Field Bandage",
    categoryId: "consumable",
    subcategoryId: "bandage",
    description: "A simple bandage for field treatment.",
    maxStack: 20,
    weight: 0.1
  }
];

export async function seedStarterItems(client: PoolClient): Promise<void> {
  for (const seed of STARTER_ITEMS) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO items (id, item_id, status, active_version_no)
       VALUES ($1, $2, 'PUBLISHED', 1)
       ON CONFLICT (item_id) DO NOTHING
       RETURNING id`,
      [seed.itemUuid, seed.itemId]
    );

    if (inserted.rowCount === 0) continue;

    await client.query(
      `INSERT INTO item_versions (
        id, item_id, version_no, revision, state, name, category_id,
        subcategory_id, description, rarity, item_level, minimum_level,
        sell_value, sellable, tradable, droppable, stackable, max_stack,
        weight, soulbound, unique_item, special_data, created_by
      ) VALUES (
        $1, $2, 1, 1, 'PUBLISHED', $3, $4, $5, $6, 'COMMON', 1, 0,
        0, TRUE, TRUE, TRUE, TRUE, $7, $8, 'NONE', FALSE, '{}'::jsonb, $9
      )`,
      [
        seed.versionUuid,
        seed.itemUuid,
        seed.name,
        seed.categoryId,
        seed.subcategoryId,
        seed.description,
        seed.maxStack,
        seed.weight,
        seedActor
      ]
    );
  }
}
