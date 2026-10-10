import type { PoolClient } from "pg";

interface StarterItemSeed {
  itemUuid: string;
  versionUuid: string;
  itemId: string;
  name: string;
  categoryId: string;
  subcategoryId: string | null;
  description: string;
  stackable: boolean;
  maxStack: number;
  weight: number;
  stats?: readonly {
    id: string;
    statCode: string;
    modifierType: "flat" | "percent" | "multiplier";
    value: number;
  }[];
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
    stackable: true,
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
    stackable: true,
    maxStack: 20,
    weight: 0.1
  },
  {
    itemUuid: "10000000-0000-4000-8000-000000000003",
    versionUuid: "10000000-0000-4000-8000-000000000013",
    itemId: "simple-bag",
    name: "Zwykły worek",
    categoryId: "backpack",
    subcategoryId: null,
    description: "Prosty worek mieszczący osiem przedmiotów.",
    stackable: false,
    maxStack: 1,
    weight: 0,
    stats: [
      {
        id: "10000000-0000-4000-8000-000000000103",
        statCode: "EXTRA_SLOTS",
        modifierType: "flat",
        value: 8
      }
    ]
  },
  {
    itemUuid: "10000000-0000-4000-8000-000000000005",
    versionUuid: "10000000-0000-4000-8000-000000000015",
    itemId: "traditional-backpack",
    name: "Tradycyjny plecak",
    categoryId: "backpack",
    subcategoryId: null,
    description: "Pojemny plecak mieszczący dwadzieścia przedmiotów.",
    stackable: false,
    maxStack: 1,
    weight: 0,
    stats: [
      {
        id: "10000000-0000-4000-8000-000000000105",
        statCode: "EXTRA_SLOTS",
        modifierType: "flat",
        value: 20
      }
    ]
  },
  {
    itemUuid: "10000000-0000-4000-8000-000000000006",
    versionUuid: "10000000-0000-4000-8000-000000000016",
    itemId: "travel-backpack",
    name: "Plecak podróżny",
    categoryId: "backpack",
    subcategoryId: null,
    description: "Plecak podróżny mieszczący czterdzieści przedmiotów.",
    stackable: false,
    maxStack: 1,
    weight: 0,
    stats: [
      {
        id: "10000000-0000-4000-8000-000000000106",
        statCode: "EXTRA_SLOTS",
        modifierType: "flat",
        value: 40
      }
    ]
  },
  {
    itemUuid: "10000000-0000-4000-8000-000000000004",
    versionUuid: "10000000-0000-4000-8000-000000000014",
    itemId: "expedition-backpack",
    name: "Plecak ekspedycyjny",
    categoryId: "backpack",
    subcategoryId: null,
    description: "Duży plecak na sześćdziesiąt przedmiotów.",
    stackable: false,
    maxStack: 1,
    weight: 0,
    stats: [
      {
        id: "10000000-0000-4000-8000-000000000104",
        statCode: "EXTRA_SLOTS",
        modifierType: "flat",
        value: 60
      }
    ]
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
        0, TRUE, TRUE, TRUE, $7, $8, $9, 'NONE', FALSE, '{}'::jsonb, $10
      )`,
      [
        seed.versionUuid,
        seed.itemUuid,
        seed.name,
        seed.categoryId,
        seed.subcategoryId,
        seed.description,
        seed.stackable,
        seed.maxStack,
        seed.weight,
        seedActor
      ]
    );

    for (const stat of seed.stats ?? []) {
      await client.query(
        `INSERT INTO item_stat_modifiers (id, version_id, stat_code, modifier_type, value)
         VALUES ($1, $2, $3, $4, $5)`,
        [stat.id, seed.versionUuid, stat.statCode, stat.modifierType, stat.value]
      );
    }
  }
}
