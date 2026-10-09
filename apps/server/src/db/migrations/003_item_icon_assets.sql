CREATE TABLE IF NOT EXISTS item_icon_assets (
  key TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/webp')),
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
