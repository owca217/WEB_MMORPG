import { createPool } from "./createPool";
import { runMigrations } from "./migrate";

const pool = createPool();

try {
  await runMigrations(pool);
  console.log("Database migrations are up to date.");
} finally {
  await pool.end();
}
