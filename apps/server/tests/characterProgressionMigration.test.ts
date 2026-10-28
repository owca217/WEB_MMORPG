import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { CharacterRepository } from "../src/persistence/CharacterRepository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("additive character progression migration", () => {
  const pool = createPool(databaseUrl);

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await pool.query("CREATE TABLE schema_migrations (migration_name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    for (const migration of ["001_item_catalog", "002_account_auth", "003_item_icon_assets", "004_item_special_fields"]) {
      await pool.query(await readFile(new URL(`../src/db/migrations/${migration}.sql`, import.meta.url), "utf8"));
      await pool.query("INSERT INTO schema_migrations (migration_name) VALUES ($1)", [migration]);
    }
  });

  afterAll(async () => { await pool.end(); });

  it("backfills legacy level XP while preserving account, skin and inventory ownership", async () => {
    const accountId = randomUUID();
    const characterId = randomUUID();
    const itemId = randomUUID();
    const instanceId = randomUUID();
    await pool.query(`INSERT INTO accounts (id, username, username_normalized, password_hash, recovery_code_hash)
      VALUES ($1, 'legacy_owner', 'legacy_owner', 'password-hash', 'recovery-hash')`, [accountId]);
    await pool.query(`INSERT INTO characters (id, account_id, nickname, nickname_normalized, appearance, level)
      VALUES ($1, $2, 'LegacyHero', 'legacyhero', '{"gender":"female","skinId":"female-guard"}', 4)`, [characterId, accountId]);
    await pool.query("INSERT INTO items (id, item_id, status) VALUES ($1, 'legacy-sword', 'DRAFT')", [itemId]);
    await pool.query("INSERT INTO item_instances (id, player_id, character_id, item_id, quantity) VALUES ($1, $2, $2, $3, 2)", [instanceId, characterId, itemId]);

    await runMigrations(pool);
    await runMigrations(pool);

    expect(await new CharacterRepository(pool).findById(characterId)).toMatchObject({
      id: characterId, accountId, level: 4, experience: 600,
      appearance: { gender: "female", skinId: "female-guard" }
    });
    expect((await pool.query("SELECT password_hash, recovery_code_hash FROM accounts WHERE id = $1", [accountId])).rows)
      .toEqual([{ password_hash: "password-hash", recovery_code_hash: "recovery-hash" }]);
    expect((await pool.query("SELECT character_id, item_id, quantity FROM item_instances WHERE id = $1", [instanceId])).rows)
      .toEqual([{ character_id: characterId, item_id: itemId, quantity: 2 }]);

    await pool.query("UPDATE characters SET experience = 750 WHERE id = $1", [characterId]);
    await pool.query(await readFile(new URL("../src/db/migrations/005_character_progression.sql", import.meta.url), "utf8"));
    expect((await new CharacterRepository(pool).findById(characterId))?.experience).toBe(750);
    await expect(pool.query("UPDATE characters SET experience = -1 WHERE id = $1", [characterId]))
      .rejects.toMatchObject({ code: "23514" });
  });
});
