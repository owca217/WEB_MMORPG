ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS experience INTEGER NOT NULL DEFAULT 0;

UPDATE characters
SET experience = GREATEST(experience, 50 * (LEAST(level, 100) - 1) * LEAST(level, 100))
WHERE experience < 50 * (LEAST(level, 100) - 1) * LEAST(level, 100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'characters_experience_check'
      AND conrelid = 'characters'::regclass
  ) THEN
    ALTER TABLE characters
      ADD CONSTRAINT characters_experience_check CHECK (experience >= 0);
  END IF;
END $$;
