ALTER TABLE character_items
  ADD COLUMN container_instance_id uuid NULL;

CREATE INDEX character_items_container_instance_idx
  ON character_items(container_instance_id)
  WHERE container_instance_id IS NOT NULL;

UPDATE character_items
SET category = 'bag'
WHERE category = 'container';

CREATE TABLE character_reward_claims (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  reward_key text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, reward_key)
);
