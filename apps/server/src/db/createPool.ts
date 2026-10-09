import { Pool } from "pg";

export function createPool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start PostgreSQL persistence.");
  }

  return new Pool({ connectionString: databaseUrl });
}
