import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for database tests.");

const pool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("database migrations", () => {
  it("creates account, session, character, inventory and nickname reservation tables", async () => {
    const result = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );

    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "schema_migrations",
        "accounts",
        "account_sessions",
        "characters",
        "character_items",
        "character_equipment",
        "character_injuries",
        "reserved_nicknames"
      ])
    );
  });

  it("enforces one character per account", async () => {
    const accountId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO accounts (id, username, username_normalized, password_hash, recovery_code_hash) VALUES ($1,$2,$3,$4,$5)",
      [accountId, "Owner", "owner", "hash", "recovery"]
    );

    const appearance = {
      bodyType: "body-01",
      skinTone: "skin-01",
      face: "face-01",
      eyes: "eyes-01",
      hair: "hair-01",
      hairColor: "hair-color-01",
      facialHair: "facial-hair-none",
      marking: "marking-none",
      startingOutfit: "outfit-01"
    };

    await pool.query(
      "INSERT INTO characters (id, account_id, nickname, nickname_normalized, appearance, location_id, x, y) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [crypto.randomUUID(), accountId, "Owczy", "owczy", appearance, "forest-settlement-01", 360, 470]
    );

    await expect(
      pool.query(
        "INSERT INTO characters (id, account_id, nickname, nickname_normalized, appearance, location_id, x, y) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [crypto.randomUUID(), accountId, "OwczyTwo", "owczytwo", appearance, "forest-settlement-01", 360, 470]
      )
    ).rejects.toMatchObject({ code: "23505" });
  });
});
