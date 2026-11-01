ALTER TABLE item_instances ADD COLUMN injury_upgrade JSONB;
ALTER TABLE item_instances ADD CONSTRAINT item_instances_injury_upgrade_object
  CHECK (injury_upgrade IS NULL OR jsonb_typeof(injury_upgrade) = 'object');

-- Instance IDs intentionally have no FK: consumed stones disappear and weapons can change owners.
CREATE TABLE weapon_injury_upgrade_receipts (
  request_id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  weapon_instance_id UUID NOT NULL,
  stone_instance_id UUID NOT NULL,
  upgrade JSONB NOT NULL CHECK (jsonb_typeof(upgrade) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX weapon_injury_upgrade_character_idx ON weapon_injury_upgrade_receipts(character_id);
