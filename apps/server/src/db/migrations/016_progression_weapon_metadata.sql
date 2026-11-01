-- Existing system metadata can already have allowed_stats_seeded = TRUE.
-- Add only the new weapon profile mappings once; retain all authored mappings.
INSERT INTO stat_definitions (
  code, label, allowed_modifier_types, minimum_value, maximum_value, formatting_kind
) VALUES ('INITIATIVE', 'Inicjatywa', ARRAY['flat', 'percent', 'multiplier']::item_modifier_type[], -100000, 100000, 'integer')
ON CONFLICT (code) DO NOTHING;

WITH additions (subcategory_id, stat_code) AS (
  VALUES
    (NULL::text, 'ARMOR'),
    (NULL::text, 'INITIATIVE'),
    (NULL::text, 'BLOCK_POWER'),
    ('sword', 'ARMOR'),
    ('hammer', 'ARMOR'),
    ('dagger', 'INITIATIVE'),
    ('spear', 'INITIATIVE'),
    ('offensive-shield', 'MAGIC_DAMAGE')
)
INSERT INTO category_allowed_stats (category_id, subcategory_id, stat_code)
SELECT category.id, additions.subcategory_id, additions.stat_code
FROM additions
JOIN item_categories category ON category.id = 'weapon' AND category.system = TRUE
JOIN stat_definitions stat ON stat.code = additions.stat_code
LEFT JOIN item_subcategories subcategory
  ON subcategory.category_id = category.id AND subcategory.id = additions.subcategory_id
WHERE additions.subcategory_id IS NULL OR subcategory.system = TRUE
ON CONFLICT DO NOTHING;
