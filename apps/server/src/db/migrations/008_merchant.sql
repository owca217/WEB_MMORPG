CREATE TABLE character_wallets (
  character_id UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  gold INTEGER NOT NULL DEFAULT 100 CHECK (gold >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE merchant_purchase_receipts (
  request_id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  total_price INTEGER NOT NULL CHECK (total_price > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX merchant_purchase_character_idx ON merchant_purchase_receipts(character_id);

CREATE TABLE character_gold_rewards (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  battle_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, battle_id)
);
