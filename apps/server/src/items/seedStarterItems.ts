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
  specialData?: Readonly<Record<string, unknown>>;
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
    weight: 0.1,
    stats: [{
      id: "10000000-0000-4000-8000-000000000102",
      statCode: "HEAL_AMOUNT",
      modifierType: "flat",
      value: 30
    }]
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
  },
  {
    itemUuid: "10000000-0000-4000-8000-000000000005",
    versionUuid: "10000000-0000-4000-8000-000000000015",
    itemId: "rag-bag",
    name: "Szmaciany worek",
    categoryId: "container",
    subcategoryId: null,
    description: "Szmaciany worek mieszczący osiem przedmiotów.",
    stackable: false,
    maxStack: 1,
    weight: 0,
    specialData: { capacity: 8 }
  },
  {
    itemUuid: "10000000-0000-4000-8000-000000000006",
    versionUuid: "10000000-0000-4000-8000-000000000016",
    itemId: "minor-healing-potion",
    name: "Mała mikstura leczenia",
    categoryId: "consumable",
    subcategoryId: "health-potion",
    description: "Podstawowa mikstura przywracająca 50 punktów zdrowia.",
    stackable: true,
    maxStack: 20,
    weight: 0.2,
    stats: [{ id: "10000000-0000-4000-8000-000000000106", statCode: "HEAL_AMOUNT", modifierType: "flat", value: 50 }]
  },
  {
    itemUuid: "10000000-0000-4000-8000-000000000007",
    versionUuid: "10000000-0000-4000-8000-000000000017",
    itemId: "invigorating-tonic",
    name: "Tonik wigoru",
    categoryId: "consumable",
    subcategoryId: "drink",
    description: "Prosty tonik przywracający 3 punkty akcji podczas walki.",
    stackable: true,
    maxStack: 20,
    weight: 0.2,
    stats: [{ id: "10000000-0000-4000-8000-000000000107", statCode: "AP_RESTORE", modifierType: "flat", value: 3 }]
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

    if (inserted.rowCount === 0) {
      if (seed.itemId === "field-bandage") {
        // Upgrade only the untouched original seed, preserving authored versions and values.
        await client.query(
          `INSERT INTO item_stat_modifiers (id, version_id, stat_code, modifier_type, value)
           SELECT $1, version.id, 'HEAL_AMOUNT', 'flat', 30
           FROM items item JOIN item_versions version ON version.item_id = item.id
           WHERE item.id = $2 AND item.active_version_no = 1 AND item.status = 'PUBLISHED'
             AND version.id = $3 AND version.state = 'PUBLISHED' AND version.revision = 1
             AND version.created_by = $4 AND version.name = $5 AND version.description = $6
             AND NOT EXISTS (SELECT 1 FROM item_stat_modifiers stat WHERE stat.version_id = version.id)
           ON CONFLICT DO NOTHING`,
          [seed.stats![0]!.id, seed.itemUuid, seed.versionUuid, seedActor, seed.name, seed.description]
        );
      }
      continue;
    }

    await client.query(
      `INSERT INTO item_versions (
        id, item_id, version_no, revision, state, name, category_id,
        subcategory_id, description, rarity, item_level, minimum_level,
        sell_value, sellable, tradable, droppable, stackable, max_stack,
        weight, soulbound, unique_item, special_data, created_by
      ) VALUES (
        $1, $2, 1, 1, 'PUBLISHED', $3, $4, $5, $6, 'COMMON', 1, 0,
        0, TRUE, TRUE, TRUE, $7, $8, $9, 'NONE', FALSE, $10::jsonb, $11
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
        JSON.stringify(seed.specialData ?? {}),
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
