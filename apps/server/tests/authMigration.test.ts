import { readFile } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

async function resetSchema(pool: ReturnType<typeof createPool>): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
}

async function applyCatalogOnly(pool: ReturnType<typeof createPool>): Promise<void> {
  const sql = await readFile(
    new URL("../src/db/migrations/001_item_catalog.sql", import.meta.url),
    "utf8"
  );
  await pool.query(sql);
  await pool.query(`
    CREATE TABLE schema_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "INSERT INTO schema_migrations (migration_name) VALUES ('001_item_catalog')"
  );
}

describeDatabase("additive account auth migration", () => {
  const pool = createPool(databaseUrl);

  beforeEach(async () => {
    await resetSchema(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates account/session/character ownership schema on an empty database", async () => {
    await runMigrations(pool);

    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual(
      expect.arrayContaining(["accounts", "account_sessions", "characters", "item_icon_assets"])
    );

    const instanceOwner = await pool.query<{ is_nullable: string }>(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'item_instances'
        AND column_name = 'character_id'
    `);
    expect(instanceOwner.rows).toEqual([{ is_nullable: "YES" }]);

    const auditActor = await pool.query<{ is_nullable: string }>(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'admin_audit_log'
        AND column_name = 'actor_account_id'
    `);
    expect(auditActor.rows).toEqual([{ is_nullable: "YES" }]);

    const migrations = await pool.query<{ migration_name: string }>(
      "SELECT migration_name FROM schema_migrations ORDER BY migration_name"
    );
    expect(migrations.rows).toEqual([
      { migration_name: "001_item_catalog" },
      { migration_name: "002_account_auth" },
      { migration_name: "003_item_icon_assets" },
      { migration_name: "004_item_special_fields" }
    ]);
  });

  it("preserves the existing catalog, legacy inventory owner and audit row", async () => {
    await applyCatalogOnly(pool);

    const itemUuid = "11111111-1111-4111-8111-111111111111";
    const instanceUuid = "22222222-2222-4222-8222-222222222222";
    const legacyPlayer = "33333333-3333-4333-8333-333333333333";
    const auditUuid = "44444444-4444-4444-8444-444444444444";

    await pool.query(
      "INSERT INTO items (id, item_id, status) VALUES ($1, 'legacy-item', 'DRAFT')",
      [itemUuid]
    );
    await pool.query(
      `INSERT INTO item_instances (id, player_id, item_id, quantity)
       VALUES ($1, $2, $3, 2)`,
      [instanceUuid, legacyPlayer, itemUuid]
    );
    await pool.query(
      `INSERT INTO admin_audit_log
        (id, actor_player_id, action, object_type, object_id)
       VALUES ($1, $2, 'CREATE', 'item', 'legacy-item')`,
      [auditUuid, legacyPlayer]
    );

    await runMigrations(pool);
    await runMigrations(pool);

    const catalog = await pool.query<{ item_id: string }>(
      "SELECT item_id FROM items WHERE id = $1",
      [itemUuid]
    );
    expect(catalog.rows).toEqual([{ item_id: "legacy-item" }]);

    const instance = await pool.query<{
      player_id: string;
      character_id: string | null;
      quantity: number;
    }>(
      "SELECT player_id, character_id, quantity FROM item_instances WHERE id = $1",
      [instanceUuid]
    );
    expect(instance.rows).toEqual([
      { player_id: legacyPlayer, character_id: null, quantity: 2 }
    ]);

    const audit = await pool.query<{
      actor_player_id: string | null;
      actor_account_id: string | null;
    }>(
      `SELECT actor_player_id, actor_account_id
       FROM admin_audit_log WHERE id = $1`,
      [auditUuid]
    );
    expect(audit.rows).toEqual([
      { actor_player_id: legacyPlayer, actor_account_id: null }
    ]);
  });
});
