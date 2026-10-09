import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";

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

  it("upgrades the legacy Render schema in place without losing existing accounts, characters, or injuries", async () => {
    await runMigrations(pool);

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
