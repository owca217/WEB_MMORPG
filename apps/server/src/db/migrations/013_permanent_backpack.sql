ALTER TABLE item_instances ADD COLUMN permanent_container BOOLEAN NOT NULL DEFAULT FALSE;

-- Keep former first-slot bags and all their children; only free the reserved assignment.
UPDATE item_instances SET container_slot=NULL,updated_at=NOW() WHERE container_slot=0;

ALTER TABLE item_instances ADD CONSTRAINT item_instances_permanent_backpack_fixed
  CHECK (NOT permanent_container OR (
    character_id IS NOT NULL AND player_id IS NULL AND quantity=1
    AND container_slot IS NOT DISTINCT FROM 0
    AND container_capacity IS NOT DISTINCT FROM 16
    AND container_instance_id IS NULL AND equipment_slot IS NULL
    AND bound_to_player_id IS NOT DISTINCT FROM character_id
  ));
ALTER TABLE item_instances ADD CONSTRAINT item_instances_permanent_slot_reserved
  CHECK (container_slot IS DISTINCT FROM 0 OR permanent_container);
CREATE UNIQUE INDEX item_instances_character_permanent_backpack_unique
  ON item_instances(character_id) WHERE permanent_container;
