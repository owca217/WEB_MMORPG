ALTER TABLE item_instances ADD COLUMN container_position INTEGER;

WITH positions AS (
  SELECT id, (row_number() OVER (PARTITION BY container_instance_id ORDER BY created_at, id) - 1)::integer AS position
  FROM item_instances WHERE container_instance_id IS NOT NULL
)
UPDATE item_instances instance SET container_position = positions.position
FROM positions WHERE instance.id = positions.id;

ALTER TABLE item_instances
  ADD CONSTRAINT item_instances_container_position_valid
    CHECK (container_position IS NULL OR (container_position >= 0 AND container_instance_id IS NOT NULL)),
  ADD CONSTRAINT item_instances_container_position_unique
    UNIQUE (container_instance_id, container_position) DEFERRABLE INITIALLY IMMEDIATE;
