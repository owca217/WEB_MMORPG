import type { Pool, PoolClient } from "pg";
import { seedStarterItems } from "./seedStarterItems";
import {
  ENGINE_STATS,
  SYSTEM_CATEGORIES,
  SYSTEM_SUBCATEGORIES
} from "./statRegistry";

export async function seedItemMetadata(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await seedStats(client);
    await seedCategories(client);
    await seedSubcategories(client);
    await seedStarterItems(client);
    await migrateLegacyCharacterItems(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function migrateLegacyCharacterItems(client: PoolClient): Promise<void> {
  const legacyTable = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.character_items')::text AS table_name"
  );
  if (!legacyTable.rows[0]?.table_name) return;

  const unmapped = await client.query<{ item_id: string }>(`
    SELECT DISTINCT legacy.item_id
    FROM character_items AS legacy
    LEFT JOIN items AS item ON item.item_id = legacy.item_id
    WHERE item.id IS NULL
    ORDER BY legacy.item_id
  `);
  if (unmapped.rows.length > 0) {
    throw new Error(
      `LEGACY_ITEM_DEFINITION_MISSING:${unmapped.rows.map((row) => row.item_id).join(",")}`
    );
  }

  await client.query(`
    INSERT INTO item_instances (
      id, player_id, character_id, item_id, quantity,
      container_capacity, container_instance_id
    )
    SELECT
      legacy.instance_id,
      NULL,
      legacy.character_id,
      item.id,
      legacy.quantity,
      legacy.container_capacity,
      legacy.container_instance_id
    FROM character_items AS legacy
    JOIN items AS item ON item.item_id = legacy.item_id
    ON CONFLICT (id) DO NOTHING
  `);
}

async function seedStats(client: PoolClient): Promise<void> {
  for (const stat of Object.values(ENGINE_STATS)) {
    await client.query(
      `INSERT INTO stat_definitions (
        code, label, allowed_modifier_types, minimum_value, maximum_value, formatting_kind
      ) VALUES ($1, $2, $3::item_modifier_type[], $4, $5, $6)
      ON CONFLICT (code) DO UPDATE SET
        label = EXCLUDED.label,
        allowed_modifier_types = EXCLUDED.allowed_modifier_types,
        minimum_value = EXCLUDED.minimum_value,
        maximum_value = EXCLUDED.maximum_value,
        formatting_kind = EXCLUDED.formatting_kind`,
      [
        stat.code,
        stat.label,
        [...stat.modifierTypes],
        stat.minimum ?? null,
        stat.maximum ?? null,
        stat.formattingKind
      ]
    );
  }
}

async function seedCategories(client: PoolClient): Promise<void> {
  for (const category of SYSTEM_CATEGORIES) {
    await client.query(
      `INSERT INTO item_categories (id, name, system)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = NOW()
       WHERE item_categories.system = TRUE`,
      [category.id, category.name]
    );

    const isSystem = await client.query<{ system: boolean }>(
      "SELECT system FROM item_categories WHERE id = $1",
      [category.id]
    );
    if (isSystem.rows[0]?.system !== true) continue;

    await client.query(
      `DELETE FROM category_allowed_stats
       WHERE category_id = $1 AND subcategory_id IS NULL`,
      [category.id]
    );

    for (const code of [...new Set(category.allowedStatCodes)].sort()) {
      await client.query(
        `INSERT INTO category_allowed_stats (category_id, subcategory_id, stat_code)
         VALUES ($1, NULL, $2)`,
        [category.id, code]
      );
    }
  }
}

async function seedSubcategories(client: PoolClient): Promise<void> {
  for (const subcategory of SYSTEM_SUBCATEGORIES) {
    const systemParent = await client.query<{ system: boolean }>(
      "SELECT system FROM item_categories WHERE id = $1",
      [subcategory.categoryId]
    );
    if (systemParent.rows[0]?.system !== true) continue;

    await client.query(
      `INSERT INTO item_subcategories (id, category_id, name, system)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (id) DO UPDATE SET
         category_id = EXCLUDED.category_id,
         name = EXCLUDED.name,
         updated_at = NOW()
       WHERE item_subcategories.system = TRUE`,
      [subcategory.id, subcategory.categoryId, subcategory.name]
    );

    const isSystem = await client.query<{ system: boolean; category_id: string }>(
      "SELECT system, category_id FROM item_subcategories WHERE id = $1",
      [subcategory.id]
    );
    if (
      isSystem.rows[0]?.system !== true ||
      isSystem.rows[0]?.category_id !== subcategory.categoryId
    ) {
      continue;
    }

    await client.query(
      `DELETE FROM category_allowed_stats
       WHERE category_id = $1 AND subcategory_id = $2`,
      [subcategory.categoryId, subcategory.id]
    );

    for (const code of [...new Set(subcategory.allowedStatCodes)].sort()) {
      await client.query(
        `INSERT INTO category_allowed_stats (category_id, subcategory_id, stat_code)
         VALUES ($1, $2, $3)`,
        [subcategory.categoryId, subcategory.id, code]
      );
    }
  }
}
