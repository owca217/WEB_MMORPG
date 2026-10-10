ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS experience INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS character_equipment (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  item_instance_id UUID NOT NULL UNIQUE REFERENCES item_instances(id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, slot)
);

CREATE TABLE IF NOT EXISTS character_reward_claims (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, reward_key)
);
