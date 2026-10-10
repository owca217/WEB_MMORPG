ALTER TABLE item_categories
  ADD COLUMN IF NOT EXISTS allowed_stats_seeded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE item_categories
  ADD COLUMN IF NOT EXISTS allowed_special_fields_seeded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE item_subcategories
  ADD COLUMN IF NOT EXISTS allowed_stats_seeded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE item_subcategories
  ADD COLUMN IF NOT EXISTS allowed_special_fields_seeded BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE category_allowed_special_fields (
  id BIGSERIAL PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES item_categories(id) ON DELETE CASCADE,
  subcategory_id TEXT,
  field_code TEXT NOT NULL,
  FOREIGN KEY (category_id, subcategory_id)
    REFERENCES item_subcategories(category_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX category_allowed_special_fields_category_unique
  ON category_allowed_special_fields (category_id, field_code)
  WHERE subcategory_id IS NULL;

CREATE UNIQUE INDEX category_allowed_special_fields_subcategory_unique
  ON category_allowed_special_fields (category_id, subcategory_id, field_code)
  WHERE subcategory_id IS NOT NULL;

CREATE INDEX category_allowed_special_fields_lookup_idx
  ON category_allowed_special_fields (category_id, subcategory_id, field_code);
