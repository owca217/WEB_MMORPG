import { Pool } from "pg";

export function createPool(databaseUrl: string): Pool {
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000
  });
}
