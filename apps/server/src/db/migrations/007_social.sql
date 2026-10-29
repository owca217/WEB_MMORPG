CREATE TABLE IF NOT EXISTS friend_requests (
  sender_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sender_id, recipient_id),
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS friend_requests_recipient_idx ON friend_requests(recipient_id);

CREATE TABLE IF NOT EXISTS friendships (
  character_low UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  character_high UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_low, character_high),
  CHECK (character_low < character_high)
);
CREATE INDEX IF NOT EXISTS friendships_high_idx ON friendships(character_high);

CREATE TABLE IF NOT EXISTS trade_receipts (
  trade_id UUID PRIMARY KEY,
  participant_a UUID NOT NULL,
  participant_b UUID NOT NULL,
  offers JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (participant_a <> participant_b)
);
