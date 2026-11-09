-- Existing initialized system metadata must gain the new fields additively.
-- Authored categories, subcategories and allowed mappings remain intact.
WITH additions (subcategory_id) AS (
  VALUES (NULL::text), ('helmet'), ('chest'), ('gloves'), ('pants'), ('boots'), ('cloak')
)
INSERT INTO category_allowed_special_fields (category_id, subcategory_id, field_code)
SELECT category.id, additions.subcategory_id, 'armorFamily'
FROM additions
JOIN item_categories category ON category.id = 'armor' AND category.system = TRUE
LEFT JOIN item_subcategories subcategory
  ON subcategory.category_id = category.id AND subcategory.id = additions.subcategory_id
WHERE additions.subcategory_id IS NULL OR subcategory.system = TRUE
ON CONFLICT DO NOTHING;

WITH slots (subcategory_id) AS (
  VALUES (NULL::text), ('helmet'), ('chest'), ('gloves'), ('pants'), ('boots'), ('cloak')
), attributes (stat_code) AS (
  VALUES ('STRENGTH'), ('DEXTERITY'), ('VITALITY')
)
INSERT INTO category_allowed_stats (category_id, subcategory_id, stat_code)
SELECT category.id, slots.subcategory_id, attributes.stat_code
FROM slots CROSS JOIN attributes
JOIN item_categories category ON category.id = 'armor' AND category.system = TRUE
JOIN stat_definitions stat ON stat.code = attributes.stat_code
LEFT JOIN item_subcategories subcategory
  ON subcategory.category_id = category.id AND subcategory.id = slots.subcategory_id
WHERE slots.subcategory_id IS NULL OR subcategory.system = TRUE
ON CONFLICT DO NOTHING;

-- Only the six untouched, original system cloth seeds are retrofitted.
-- Keep IDs, versions, revisions, quality, modifiers and every owned copy unchanged.
WITH seeds (item_id, slot, name, armor) AS (
  VALUES
    ('cloth-helmet', 'helmet', 'Płócienny kaptur', 1),
    ('cloth-chest', 'chest', 'Płócienna tunika', 3),
    ('cloth-gloves', 'gloves', 'Płócienne rękawice', 1),
    ('cloth-pants', 'pants', 'Płócienne spodnie', 2),
    ('cloth-boots', 'boots', 'Płócienne buty', 1),
    ('cloth-cloak', 'cloak', 'Płócienny płaszcz', 1)
)
UPDATE item_versions version
SET special_data = version.special_data || '{"armorFamily":"cloth"}'::jsonb
FROM items item, seeds seed
WHERE item.item_id = seed.item_id AND item.id = version.item_id
  AND item.status = 'PUBLISHED' AND item.active_version_no = 1
  AND version.version_no = 1 AND version.revision = 1 AND version.state = 'PUBLISHED'
  AND version.created_by = '00000000-0000-4000-8000-000000000001'::uuid
  AND version.category_id = 'armor' AND version.subcategory_id = seed.slot
  AND version.name = seed.name
  AND version.description = 'Podstawowy przedmiot: ' || lower(seed.name) || '.'
  AND version.special_data = jsonb_build_object('armorSlot', seed.slot)
  AND version.rarity = 'COMMON' AND version.quality = 'NORMAL'
  AND version.item_level = 1 AND version.minimum_level = 1
  AND version.sell_value = 0 AND version.sellable AND version.tradable AND version.droppable
  AND NOT version.stackable AND version.max_stack = 1 AND version.weight = 1
  AND version.soulbound = 'NONE' AND NOT version.unique_item
  AND version.icon_key IS NULL AND version.icon_url IS NULL
  AND NOT EXISTS (SELECT 1 FROM item_versions other WHERE other.item_id = item.id AND other.id <> version.id)
  AND EXISTS (SELECT 1 FROM item_stat_modifiers stat WHERE stat.version_id = version.id
    AND stat.stat_code = 'ARMOR' AND stat.modifier_type = 'flat' AND stat.value = seed.armor)
  AND NOT EXISTS (SELECT 1 FROM item_stat_modifiers stat WHERE stat.version_id = version.id
    AND NOT (stat.stat_code = 'ARMOR' AND stat.modifier_type = 'flat' AND stat.value = seed.armor))
  AND NOT EXISTS (SELECT 1 FROM item_requirements requirement WHERE requirement.version_id = version.id)
  AND NOT EXISTS (SELECT 1 FROM item_effects effect WHERE effect.version_id = version.id)
  AND NOT EXISTS (SELECT 1 FROM item_tags tag WHERE tag.version_id = version.id);
