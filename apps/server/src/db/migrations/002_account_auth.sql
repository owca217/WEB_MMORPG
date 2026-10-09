CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  username VARCHAR(32) NOT NULL,
  username_normalized VARCHAR(32) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  recovery_code_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('PLAYER', 'ADMIN')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'PLAYER';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounts_role_check'
      AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_role_check CHECK (role IN ('PLAYER', 'ADMIN'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS account_sessions (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS account_sessions_one_active_per_account_idx
  ON account_sessions(account_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS account_sessions_account_id_idx
  ON account_sessions(account_id);

CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  nickname VARCHAR(20) NOT NULL,
  nickname_normalized VARCHAR(20) NOT NULL UNIQUE,
  appearance JSONB NOT NULL DEFAULT '{}'::jsonb,
  location_id TEXT NOT NULL DEFAULT 'forest-settlement-01',
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  y DOUBLE PRECISION NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  hp INTEGER NOT NULL DEFAULT 100,
  max_hp INTEGER NOT NULL DEFAULT 100 CHECK (max_hp > 0),
  max_ap INTEGER NOT NULL DEFAULT 5 CHECK (max_ap > 0),
  initiative INTEGER NOT NULL DEFAULT 10,
  severely_injured BOOLEAN NOT NULL DEFAULT FALSE,
  injuries JSONB NOT NULL DEFAULT '[]'::jsonb,
  deletion_requested_at TIMESTAMPTZ,
  deletion_effective_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hp >= 0 AND hp <= max_hp)
);

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS injuries JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF to_regclass('public.character_injuries') IS NOT NULL THEN
    UPDATE characters AS character
    SET injuries = legacy.injuries
    FROM (
      SELECT character_id, jsonb_agg(injury_kind ORDER BY injury_kind) AS injuries
      FROM character_injuries
      GROUP BY character_id
    ) AS legacy
    WHERE character.id = legacy.character_id
      AND character.injuries = '[]'::jsonb;
  END IF;
END $$;

ALTER TABLE item_instances
  ADD COLUMN IF NOT EXISTS character_id UUID REFERENCES characters(id) ON DELETE CASCADE;

ALTER TABLE item_instances
  ALTER COLUMN player_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS item_instances_character_id_idx
  ON item_instances(character_id);

ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS actor_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE admin_audit_log
  ALTER COLUMN actor_player_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS admin_audit_actor_account_idx
  ON admin_audit_log(actor_account_id, created_at DESC);
