import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

async function applyLegacyRenderSchema(pool: ReturnType<typeof createPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO schema_migrations (name) VALUES
      ('001_accounts_characters.sql'),
      ('002_character_experience.sql'),
      ('003_container_capacity.sql'),
      ('004_bag_storage_and_npc_rewards.sql'),
      ('005_admin_roles_and_operations.sql');

    CREATE TABLE accounts (
      id UUID PRIMARY KEY,
      username VARCHAR(32) NOT NULL,
      username_normalized VARCHAR(32) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      recovery_code_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      role TEXT NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('PLAYER', 'ADMIN'))
    );

    CREATE TABLE account_sessions (
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX one_active_session_per_account
      ON account_sessions(account_id)
      WHERE revoked_at IS NULL;

    CREATE TABLE characters (
      id UUID PRIMARY KEY,
      account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
      nickname VARCHAR(20) NOT NULL,
      nickname_normalized VARCHAR(20) NOT NULL UNIQUE,
      appearance JSONB NOT NULL,
      location_id TEXT NOT NULL,
      x DOUBLE PRECISION NOT NULL,
      y DOUBLE PRECISION NOT NULL,
      level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
      hp INTEGER NOT NULL DEFAULT 100,
      max_hp INTEGER NOT NULL DEFAULT 100 CHECK (max_hp > 0),
      max_ap INTEGER NOT NULL DEFAULT 5 CHECK (max_ap > 0),
      initiative INTEGER NOT NULL DEFAULT 10,
      severely_injured BOOLEAN NOT NULL DEFAULT FALSE,
      deletion_requested_at TIMESTAMPTZ,
      deletion_effective_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0),
      CHECK (hp >= 0 AND hp <= max_hp)
    );

    CREATE TABLE character_injuries (
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      injury_kind TEXT NOT NULL,
      PRIMARY KEY (character_id, injury_kind)
    );

    CREATE TABLE character_items (
      instance_id UUID PRIMARY KEY,
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      container_capacity INTEGER,
      container_instance_id UUID
    );
  `);

  await pool.query(
    `INSERT INTO accounts
      (id, username, username_normalized, password_hash, recovery_code_hash, role, status)
     VALUES
      ('11111111-1111-4111-8111-111111111111', 'LegacyAdmin', 'legacyadmin', 'hash', 'recovery', 'ADMIN', 'active')`
  );
  await pool.query(
    `INSERT INTO characters
      (id, account_id, nickname, nickname_normalized, appearance, location_id, x, y)
     VALUES
      ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'LegacyHero', 'legacyhero', '{}'::jsonb, 'forest-settlement-01', 12, 34)`
  );
  await pool.query(
    `INSERT INTO character_injuries (character_id, injury_kind) VALUES
      ('22222222-2222-4222-8222-222222222222', 'bleeding'),
      ('22222222-2222-4222-8222-222222222222', 'chestWound')`
  );
  await pool.query(`
    INSERT INTO character_items
      (instance_id, character_id, item_id, name, quantity, category, description, container_capacity)
    VALUES
      ('30000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'wolf-pelt', 'Wolf Pelt', 10, 'material', 'A rough pelt taken from a forest wolf.', NULL),
      ('30000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'field-bandage', 'Field Bandage', 20, 'medical', 'A simple bandage for field treatment.', NULL),
      ('30000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'simple-bag', 'Zwykły worek', 1, 'bag', 'Prosty worek mieszczący osiem przedmiotów.', 8),
      ('30000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'expedition-backpack', 'Plecak ekspedycyjny', 1, 'bag', 'Duży plecak na sześćdziesiąt przedmiotów.', 60)
  `);
}

describeDatabase("Render legacy production migration compatibility", () => {
  const pool = createPool(databaseUrl);

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await applyLegacyRenderSchema(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("upgrades the legacy Render schema in place without losing account, character, injury, or inventory state", async () => {
    await runMigrations(pool);
    await seedItemMetadata(pool);
    await seedItemMetadata(pool);

    const account = await pool.query<{ username: string; role: string; status: string }>(
      "SELECT username, role, status FROM accounts WHERE id = '11111111-1111-4111-8111-111111111111'"
    );
    expect(account.rows).toEqual([
      { username: "LegacyAdmin", role: "ADMIN", status: "active" }
    ]);

    const character = await pool.query<{ nickname: string; injuries: unknown }>(
      "SELECT nickname, injuries FROM characters WHERE id = '22222222-2222-4222-8222-222222222222'"
    );
    expect(character.rows).toEqual([
      { nickname: "LegacyHero", injuries: ["bleeding", "chestWound"] }
    ]);

    const migratedItems = await pool.query<{
      id: string;
      item_id: string;
      quantity: number;
      character_id: string;
    }>(`
      SELECT instance.id, item.item_id, instance.quantity, instance.character_id
      FROM item_instances AS instance
      JOIN items AS item ON item.id = instance.item_id
      WHERE instance.character_id = '22222222-2222-4222-8222-222222222222'
      ORDER BY item.item_id
    `);
    expect(migratedItems.rows).toEqual([
      {
        id: "30000000-0000-4000-8000-000000000004",
        item_id: "expedition-backpack",
        quantity: 1,
        character_id: "22222222-2222-4222-8222-222222222222"
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        item_id: "field-bandage",
        quantity: 20,
        character_id: "22222222-2222-4222-8222-222222222222"
      },
      {
        id: "30000000-0000-4000-8000-000000000003",
        item_id: "simple-bag",
        quantity: 1,
        character_id: "22222222-2222-4222-8222-222222222222"
      },
      {
        id: "30000000-0000-4000-8000-000000000001",
        item_id: "wolf-pelt",
        quantity: 10,
        character_id: "22222222-2222-4222-8222-222222222222"
      }
    ]);

    const bagSlots = await pool.query<{ item_id: string; value: string }>(`
      SELECT item.item_id, modifier.value::text AS value
      FROM item_stat_modifiers AS modifier
      JOIN item_versions AS version ON version.id = modifier.version_id
      JOIN items AS item ON item.id = version.item_id
      WHERE modifier.stat_code = 'EXTRA_SLOTS'
        AND item.item_id IN ('simple-bag', 'expedition-backpack')
      ORDER BY item.item_id
    `);
    expect(bagSlots.rows).toEqual([
      { item_id: "expedition-backpack", value: "60" },
      { item_id: "simple-bag", value: "8" }
    ]);

    const columns = await pool.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ('item_instances', 'character_id'),
          ('admin_audit_log', 'actor_account_id')
        )
      ORDER BY table_name, column_name
    `);
    expect(columns.rows).toEqual([
      { table_name: "admin_audit_log", column_name: "actor_account_id" },
      { table_name: "item_instances", column_name: "character_id" }
    ]);

    const applied = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name IN ('001_item_catalog', '002_account_auth') ORDER BY name"
    );
    expect(applied.rows.map((row) => row.name)).toEqual([
      "001_item_catalog",
      "002_account_auth"
    ]);
  });
});
