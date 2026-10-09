import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

const MIGRATION_LOCK_ID = 184472031;
const MIGRATIONS = [
  {
    name: "001_item_catalog",
    url: new URL("./migrations/001_item_catalog.sql", import.meta.url)
  }
] as const;

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    for (const migration of MIGRATIONS) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE migration_name = $1",
        [migration.name]
      );
      if (applied.rowCount) continue;

      const sql = await readFile(migration.url, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (migration_name) VALUES ($1)",
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
