ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS weapon_training JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'characters_weapon_training_object'
      AND conrelid = 'characters'::regclass
  ) THEN
    ALTER TABLE characters ADD CONSTRAINT characters_weapon_training_object
      CHECK (jsonb_typeof(weapon_training) = 'object');
  END IF;
END $$;
