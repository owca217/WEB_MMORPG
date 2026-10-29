ALTER TABLE item_instances
  ADD COLUMN container_slot SMALLINT;

ALTER TABLE item_instances
  ADD CONSTRAINT item_instances_container_slot_range
    CHECK (container_slot BETWEEN 0 AND 3),
  ADD CONSTRAINT item_instances_container_slot_ownership
    CHECK (container_slot IS NULL OR (character_id IS NOT NULL AND container_instance_id IS NULL));

CREATE UNIQUE INDEX item_instances_character_container_slot_unique
  ON item_instances(character_id, container_slot)
  WHERE container_slot IS NOT NULL;
