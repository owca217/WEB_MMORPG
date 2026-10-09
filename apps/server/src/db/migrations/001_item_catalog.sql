DO $$ BEGIN
  CREATE TYPE item_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE item_version_state AS ENUM ('DRAFT', 'PUBLISHED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE item_rarity AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE item_modifier_type AS ENUM ('flat', 'percent', 'multiplier');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE item_soulbound_type AS ENUM ('NONE', 'ON_PICKUP', 'ON_EQUIP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE item_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE item_subcategories (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES item_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, id)
);

CREATE TABLE stat_definitions (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  allowed_modifier_types item_modifier_type[] NOT NULL,
  minimum_value NUMERIC,
  maximum_value NUMERIC,
  formatting_kind TEXT NOT NULL DEFAULT 'number',
  CHECK (maximum_value IS NULL OR minimum_value IS NULL OR maximum_value >= minimum_value)
);

CREATE TABLE category_allowed_stats (
  id BIGSERIAL PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES item_categories(id) ON DELETE CASCADE,
  subcategory_id TEXT,
  stat_code TEXT NOT NULL REFERENCES stat_definitions(code) ON DELETE RESTRICT,
  FOREIGN KEY (category_id, subcategory_id)
    REFERENCES item_subcategories(category_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX category_allowed_stats_category_unique
  ON category_allowed_stats (category_id, stat_code)
  WHERE subcategory_id IS NULL;

CREATE UNIQUE INDEX category_allowed_stats_subcategory_unique
  ON category_allowed_stats (category_id, subcategory_id, stat_code)
  WHERE subcategory_id IS NOT NULL;

CREATE TABLE items (
  id UUID PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE,
  status item_status NOT NULL DEFAULT 'DRAFT',
  active_version_no INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (active_version_no IS NULL OR active_version_no > 0)
);

CREATE TABLE item_versions (
  id UUID PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  state item_version_state NOT NULL,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES item_categories(id) ON DELETE RESTRICT,
  subcategory_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  icon_key TEXT,
  icon_url TEXT,
  rarity item_rarity NOT NULL,
  item_level INTEGER NOT NULL DEFAULT 1 CHECK (item_level >= 0),
  minimum_level INTEGER NOT NULL DEFAULT 0 CHECK (minimum_level >= 0),
  sell_value NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (sell_value >= 0),
  sellable BOOLEAN NOT NULL DEFAULT TRUE,
  tradable BOOLEAN NOT NULL DEFAULT TRUE,
  droppable BOOLEAN NOT NULL DEFAULT TRUE,
  stackable BOOLEAN NOT NULL DEFAULT FALSE,
  max_stack INTEGER NOT NULL DEFAULT 1 CHECK (max_stack > 0),
  weight NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (weight >= 0),
  soulbound item_soulbound_type NOT NULL DEFAULT 'NONE',
  unique_item BOOLEAN NOT NULL DEFAULT FALSE,
  special_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, version_no),
  FOREIGN KEY (category_id, subcategory_id)
    REFERENCES item_subcategories(category_id, id) ON DELETE RESTRICT,
  CHECK (stackable OR max_stack = 1)
);

CREATE UNIQUE INDEX item_versions_single_draft
  ON item_versions (item_id)
  WHERE state = 'DRAFT';

CREATE TABLE item_stat_modifiers (
  id UUID PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES item_versions(id) ON DELETE CASCADE,
  stat_code TEXT NOT NULL REFERENCES stat_definitions(code) ON DELETE RESTRICT,
  modifier_type item_modifier_type NOT NULL,
  value NUMERIC NOT NULL,
  UNIQUE (version_id, stat_code, modifier_type)
);

CREATE TABLE item_requirements (
  id UUID PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES item_versions(id) ON DELETE CASCADE,
  requirement_type TEXT NOT NULL,
  code TEXT,
  value_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE item_effects (
  id UUID PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES item_versions(id) ON DELETE CASCADE,
  trigger_code TEXT NOT NULL,
  effect_code TEXT NOT NULL,
  value NUMERIC,
  chance NUMERIC,
  duration_ms INTEGER,
  cooldown_ms INTEGER,
  condition JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (chance IS NULL OR (chance >= 0 AND chance <= 1)),
  CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CHECK (cooldown_ms IS NULL OR cooldown_ms >= 0)
);

CREATE TABLE item_tags (
  version_id UUID NOT NULL REFERENCES item_versions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (version_id, tag)
);

CREATE TABLE item_instances (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  durability NUMERIC,
  max_durability NUMERIC,
  upgrade_level INTEGER NOT NULL DEFAULT 0 CHECK (upgrade_level >= 0),
  affixes JSONB NOT NULL DEFAULT '[]'::jsonb,
  sockets JSONB NOT NULL DEFAULT '[]'::jsonb,
  bound_to_player_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (durability IS NULL OR durability >= 0),
  CHECK (max_durability IS NULL OR max_durability >= 0),
  CHECK (durability IS NULL OR max_durability IS NULL OR durability <= max_durability)
);

CREATE INDEX item_instances_player_id_idx ON item_instances(player_id);
CREATE INDEX item_instances_item_id_idx ON item_instances(item_id);

CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY,
  actor_player_id UUID NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  from_version INTEGER,
  to_version INTEGER,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_audit_object_idx
  ON admin_audit_log(object_type, object_id, created_at);
