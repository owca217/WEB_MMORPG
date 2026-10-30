ALTER TABLE item_instances ADD COLUMN equipment_slot TEXT;

ALTER TABLE item_instances ADD CONSTRAINT item_instances_equipment_slot_valid
  CHECK (equipment_slot IS NULL OR equipment_slot IN ('mainHand','offHand','helmet','chest','gloves','pants','boots','cloak'));
ALTER TABLE item_instances ADD CONSTRAINT item_instances_equipment_ownership
  CHECK (equipment_slot IS NULL OR (character_id IS NOT NULL AND quantity=1 AND container_instance_id IS NULL AND container_slot IS NULL));
CREATE UNIQUE INDEX item_instances_character_equipment_slot_unique
  ON item_instances(character_id,equipment_slot) WHERE equipment_slot IS NOT NULL;

-- Upgrade the old system staff mapping only when it still has the original restrictions.
-- Authored mappings remain untouched.
INSERT INTO category_allowed_stats(category_id,subcategory_id,stat_code)
SELECT 'weapon','staff','PHYSICAL_DAMAGE'
FROM item_subcategories subcategory
JOIN item_categories category ON category.id=subcategory.category_id
WHERE subcategory.id='staff' AND subcategory.category_id='weapon' AND subcategory.system AND category.system
  AND (SELECT array_agg(mapping.stat_code ORDER BY mapping.stat_code)
       FROM category_allowed_stats mapping WHERE mapping.category_id='weapon' AND mapping.subcategory_id='staff')
    = ARRAY['CAST_SPEED','CRIT_CHANCE','FIRE_DAMAGE','FROST_DAMAGE','LIGHTNING_DAMAGE','MAGIC_DAMAGE','MANA_REGEN','MAX_MANA','POISON_DAMAGE','SPELL_POWER']::text[];
