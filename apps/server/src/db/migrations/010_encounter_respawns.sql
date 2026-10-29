CREATE TABLE IF NOT EXISTS encounter_respawns (
  location_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  respawn_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (location_id, encounter_id)
);
