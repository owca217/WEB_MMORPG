ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'PLAYER';

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

CREATE TABLE IF NOT EXISTS admin_item_grants (
  operation_id text PRIMARY KEY CHECK (length(operation_id) BETWEEN 1 AND 128),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_item_grants_account_idx
  ON admin_item_grants(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_item_grants_character_idx
  ON admin_item_grants(character_id, created_at DESC);
