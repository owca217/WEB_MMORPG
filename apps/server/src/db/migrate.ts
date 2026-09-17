import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { createPool } from "./pool";

export async function runMigrations(pool: Pool, migrationsDir?: string): Promise<void> {
  const baseDir =
    migrationsDir ?? join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
  );

  const names = (await readdir(baseDir))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const name of names) {
    const applied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [name]
    );
    if (applied.rowCount) continue;

    const sql = await readFile(join(baseDir, name), "utf8");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(process.env.DATABASE_URL ?? "");

  runMigrations(pool)
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(
        "Database migration failed:",
        error instanceof Error ? error.message : error
      );
      await pool.end();
      process.exitCode = 1;
    });
}
