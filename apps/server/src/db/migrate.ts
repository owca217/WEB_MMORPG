import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";

const MIGRATION_LOCK_ID = 184472031;
const MIGRATIONS = [
  {
    name: "001_item_catalog",
    url: new URL("./migrations/001_item_catalog.sql", import.meta.url)
  },
  {
    name: "002_account_auth",
    url: new URL("./migrations/002_account_auth.sql", import.meta.url)
  },
  {
    name: "003_item_icon_assets",
    url: new URL("./migrations/003_item_icon_assets.sql", import.meta.url)
  },
  {
    name: "004_item_special_fields",
    url: new URL("./migrations/004_item_special_fields.sql", import.meta.url)
  }
] as const;

type MigrationNameColumn = "migration_name" | "name";

async function resolveMigrationNameColumn(
  client: PoolClient
): Promise<MigrationNameColumn> {
  const columns = await client.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schema_migrations'
      AND column_name IN ('migration_name', 'name')
  `);
  const names = new Set(columns.rows.map((row) => row.column_name));
  if (names.has("migration_name")) return "migration_name";
  if (names.has("name")) return "name";
  throw new Error("Unsupported schema_migrations table: expected migration_name or name column.");
}

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const migrationNameColumn = await resolveMigrationNameColumn(client);
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    for (const migration of MIGRATIONS) {
      const applied = await client.query(
        `SELECT 1 FROM schema_migrations WHERE ${migrationNameColumn} = $1`,
        [migration.name]
      );
      if (applied.rowCount) continue;

      const sql = await readFile(migration.url, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (${migrationNameColumn}) VALUES ($1)`,
          [migration.name]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    } finally {
      client.release();
    }
  }
}
