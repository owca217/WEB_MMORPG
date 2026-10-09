import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("item catalog database", () => {
  const pool = createPool(databaseUrl);

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates every required catalog table exactly once", async () => {
    const result = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    const tables = result.rows.map((row) => row.tablename);

    expect(tables).toEqual(
      expect.arrayContaining([
        "admin_audit_log",
        "category_allowed_stats",
        "item_categories",
        "item_effects",
        "item_instances",
        "item_requirements",
        "item_stat_modifiers",
        "item_subcategories",
        "item_tags",
        "item_versions",
        "items",
        "schema_migrations",
        "stat_definitions"
      ])
    );

    const migrations = await pool.query<{ migration_name: string }>(
      "SELECT migration_name FROM schema_migrations ORDER BY migration_name"
    );
    expect(migrations.rows).toEqual([{ migration_name: "001_item_catalog" }]);
  });

  it("enforces stable unique itemId and foreign-key ownership", async () => {
    await pool.query(
      "INSERT INTO items (id, item_id, status) VALUES ($1, $2, 'DRAFT')",
      ["11111111-1111-4111-8111-111111111111", "iron-sword"]
    );

    await expect(
      pool.query(
        "INSERT INTO items (id, item_id, status) VALUES ($1, $2, 'DRAFT')",
        ["22222222-2222-4222-8222-222222222222", "iron-sword"]
      )
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      pool.query(
        `INSERT INTO item_versions (
          id, item_id, version_no, revision, state, name, category_id,
          description, rarity, item_level, minimum_level, sell_value,
          sellable, tradable, droppable, stackable, max_stack, weight,
          soulbound, unique_item, special_data, created_by
        ) VALUES (
          $1, $2, 1, 1, 'DRAFT', 'Orphan', 'weapon', '', 'COMMON',
          1, 1, 0, true, true, true, false, 1, 0, 'NONE', false, '{}'::jsonb, $3
        )`,
        [
          "33333333-3333-4333-8333-333333333333",
          "44444444-4444-4444-8444-444444444444",
          "55555555-5555-4555-8555-555555555555"
        ]
      )
    ).rejects.toMatchObject({ code: "23503" });
  });
});
