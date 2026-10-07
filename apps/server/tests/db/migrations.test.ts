import { Pool } from "pg";
import { readFile } from "node:fs/promises";
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
        "reserved_nicknames",
        "character_reward_claims"
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

  it("migrates legacy container items without changing inventory or equipment ownership", async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    for (const migration of [
      "001_accounts_characters.sql",
      "002_character_experience.sql",
      "003_container_capacity.sql"
    ]) {
      await pool.query(
        await readFile(new URL(`../../migrations/${migration}`, import.meta.url), "utf8")
      );
    }

    const accountId = crypto.randomUUID();
    const characterId = crypto.randomUUID();
    const bagInstanceId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO accounts (id, username, username_normalized, password_hash, recovery_code_hash) VALUES ($1,$2,$3,$4,$5)",
      [accountId, "LegacyOwner", "legacyowner", "hash", "recovery"]
    );
    await pool.query(
      "INSERT INTO characters (id, account_id, nickname, nickname_normalized, appearance, location_id, x, y) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [characterId, accountId, "LegacyHero", "legacyhero", {}, "forest-settlement-01", 360, 470]
    );
    await pool.query(
      `INSERT INTO character_items
       (instance_id, character_id, item_id, name, quantity, category, description, container_capacity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [bagInstanceId, characterId, "simple-bag", "Zwykły worek", 1, "container", "Worek.", 8]
    );
    await pool.query(
      "INSERT INTO character_equipment (character_id, slot, item_instance_id) VALUES ($1,$2,$3)",
      [characterId, "bag-1", bagInstanceId]
    );

    await pool.query(
      await readFile(new URL("../../migrations/004_bag_storage_and_npc_rewards.sql", import.meta.url), "utf8")
    );

    const item = await pool.query<{
      instance_id: string;
      character_id: string;
      item_id: string;
      category: string;
    }>("SELECT instance_id, character_id, item_id, category FROM character_items WHERE instance_id = $1", [bagInstanceId]);
    const equipment = await pool.query<{ slot: string; item_instance_id: string }>(
      "SELECT slot, item_instance_id FROM character_equipment WHERE character_id = $1",
      [characterId]
    );
    const storageColumn = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'character_items' AND column_name = 'container_instance_id'"
    );
    const claimsTable = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'character_reward_claims'"
    );

    expect(item.rows[0]).toEqual({
      instance_id: bagInstanceId,
      character_id: characterId,
      item_id: "simple-bag",
      category: "bag"
    });
    expect(equipment.rows).toEqual([{ slot: "bag-1", item_instance_id: bagInstanceId }]);
    expect(storageColumn.rowCount).toBe(1);
    expect(claimsTable.rowCount).toBe(1);
  });
});
