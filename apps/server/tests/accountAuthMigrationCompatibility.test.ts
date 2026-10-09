import { readFile } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { AccountRepository } from "../src/persistence/AccountRepository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

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

describeDatabase("account auth migration compatibility acceptance", () => {
  const pool = createPool(databaseUrl);

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("adds durable accounts without changing legacy catalog/history/audit/inventory fixtures", async () => {
    await applyCatalogOnly(pool);

    const itemUuid = "11111111-1111-4111-8111-111111111111";
    const versionUuid = "22222222-2222-4222-8222-222222222222";
    const instanceUuid = "33333333-3333-4333-8333-333333333333";
    const legacyPlayer = "44444444-4444-4444-8444-444444444444";
    const auditUuid = "55555555-5555-4555-8555-555555555555";

    await pool.query(
      "INSERT INTO item_categories (id, name, system) VALUES ('weapon', 'Weapon', true)"
    );
    await pool.query(
      "INSERT INTO items (id, item_id, status) VALUES ($1, 'compat-item', 'PUBLISHED')",
      [itemUuid]
    );
    await pool.query(
      `INSERT INTO item_versions (
        id, item_id, version_no, revision, state, name, category_id,
        description, rarity, item_level, minimum_level, sell_value,
        sellable, tradable, droppable, stackable, max_stack, weight,
        soulbound, unique_item, special_data, created_by
      ) VALUES (
        $1, $2, 1, 1, 'PUBLISHED', 'Compat Item', 'weapon',
        'legacy fixture', 'COMMON', 1, 1, 0,
        true, true, true, false, 1, 0,
        'NONE', false, '{}'::jsonb, $3
      )`,
      [versionUuid, itemUuid, legacyPlayer]
    );
    await pool.query(
      "UPDATE items SET active_version_no = 1 WHERE id = $1",
      [itemUuid]
    );
    await pool.query(
      `INSERT INTO item_instances (id, player_id, item_id, quantity)
       VALUES ($1, $2, $3, 3)`,
      [instanceUuid, legacyPlayer, itemUuid]
    );
    await pool.query(
      `INSERT INTO admin_audit_log
        (id, actor_player_id, action, object_type, object_id)
       VALUES ($1, $2, 'PUBLISH', 'item', 'compat-item')`,
      [auditUuid, legacyPlayer]
    );

    const before = {
      items: (await pool.query("SELECT * FROM items")).rowCount,
      versions: (await pool.query("SELECT * FROM item_versions")).rowCount,
      audit: (await pool.query("SELECT * FROM admin_audit_log")).rowCount,
      instances: (await pool.query("SELECT * FROM item_instances")).rowCount
    };

    await runMigrations(pool);

    const lifecycle = new CharacterLifecycleService(pool);
    const accounts = new AccountRepository(pool);
    const auth = new AuthService(pool, accounts, lifecycle);
    const registered = await auth.register("compat_player", PASSWORD);
    expect(registered.recoveryCode).toBeTruthy();
    const login = await auth.login("compat_player", PASSWORD);
    expect(login.session.accountRole).toBe("PLAYER");

    const after = {
      items: (await pool.query("SELECT * FROM items")).rowCount,
      versions: (await pool.query("SELECT * FROM item_versions")).rowCount,
      audit: (await pool.query("SELECT * FROM admin_audit_log")).rowCount,
      instances: (await pool.query("SELECT * FROM item_instances")).rowCount
    };
    expect(after).toEqual(before);

    const legacy = await pool.query<{
      player_id: string | null;
      character_id: string | null;
      quantity: number;
    }>(
      "SELECT player_id, character_id, quantity FROM item_instances WHERE id = $1",
      [instanceUuid]
    );
    expect(legacy.rows).toEqual([
      { player_id: legacyPlayer, character_id: null, quantity: 3 }
    ]);
  });
});
