CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  username varchar(32) NOT NULL,
  username_normalized varchar(32) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  recovery_code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_account
  ON account_sessions(account_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  nickname varchar(20) NOT NULL,
  nickname_normalized varchar(20) NOT NULL UNIQUE,
  appearance jsonb NOT NULL,
  location_id text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  level integer NOT NULL DEFAULT 1 CHECK (level >= 1),
  hp integer NOT NULL DEFAULT 100,
  max_hp integer NOT NULL DEFAULT 100 CHECK (max_hp > 0),
  max_ap integer NOT NULL DEFAULT 5 CHECK (max_ap > 0),
  initiative integer NOT NULL DEFAULT 10,
  severely_injured boolean NOT NULL DEFAULT false,
  deletion_requested_at timestamptz,
  deletion_effective_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (hp >= 0 AND hp <= max_hp)
);

CREATE TABLE IF NOT EXISTS character_items (
  instance_id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  category text NOT NULL,
  description text NOT NULL
);

CREATE INDEX IF NOT EXISTS character_items_character_idx
  ON character_items(character_id);

CREATE TABLE IF NOT EXISTS character_equipment (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot text NOT NULL,
  item_instance_id uuid NOT NULL REFERENCES character_items(instance_id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, slot),
  UNIQUE (item_instance_id)
);

CREATE TABLE IF NOT EXISTS character_injuries (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  injury_kind text NOT NULL,
  PRIMARY KEY (character_id, injury_kind)
);

CREATE TABLE IF NOT EXISTS reserved_nicknames (
  nickname_normalized varchar(20) PRIMARY KEY,
  display_nickname varchar(20) NOT NULL,
  former_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reserved_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
