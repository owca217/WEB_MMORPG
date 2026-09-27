ALTER TABLE characters
  ADD COLUMN experience integer NOT NULL DEFAULT 0 CHECK (experience >= 0);
