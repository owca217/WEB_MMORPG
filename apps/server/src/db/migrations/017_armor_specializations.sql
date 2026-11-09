ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS armor_training JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'characters_armor_training_object') THEN
    ALTER TABLE characters ADD CONSTRAINT characters_armor_training_object
      CHECK (jsonb_typeof(armor_training) = 'object');
  END IF;
END $$;
