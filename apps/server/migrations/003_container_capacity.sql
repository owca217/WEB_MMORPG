ALTER TABLE character_items
  ADD COLUMN IF NOT EXISTS container_capacity integer
  CHECK (container_capacity IS NULL OR container_capacity > 0);
