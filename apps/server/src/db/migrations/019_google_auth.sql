ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE accounts ALTER COLUMN recovery_code_hash DROP NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT accounts_local_credentials_pair
  CHECK ((password_hash IS NULL) = (recovery_code_hash IS NULL));

CREATE TABLE account_google_identities (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  google_subject TEXT UNIQUE NOT NULL CHECK (length(google_subject) BETWEEN 1 AND 255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE google_auth_challenges (
  id UUID PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('login', 'link')),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  session_id UUID REFERENCES account_sessions(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  CHECK ((intent = 'login' AND account_id IS NULL AND session_id IS NULL)
    OR (intent = 'link' AND account_id IS NOT NULL AND session_id IS NOT NULL))
);
CREATE INDEX google_auth_challenges_expiry ON google_auth_challenges(expires_at);
