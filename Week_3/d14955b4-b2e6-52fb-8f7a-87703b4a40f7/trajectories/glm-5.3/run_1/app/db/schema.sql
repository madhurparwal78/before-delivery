-- Hushline schema. Applied on every start; every statement is idempotent.

CREATE TABLE IF NOT EXISTS games (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  launcher_origin text NOT NULL,
  widget_secret text NOT NULL,
  server_secret text NOT NULL,
  previous_server_secret text,
  previous_secret_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('developer','moderator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, email)
);

CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, id)
);

CREATE TABLE IF NOT EXISTS buckets (
  player_id text NOT NULL,
  game_id text NOT NULL,
  tokens numeric NOT NULL DEFAULT 8,
  last_refill timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS threads (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id),
  player_id text NOT NULL,
  topic text NOT NULL CHECK (topic IN ('bug','account','purchase','other')),
  status text NOT NULL CHECK (status IN ('waiting','answered','closed')),
  waiting_since timestamptz,
  last_player_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES threads(id),
  game_id text NOT NULL REFERENCES games(id),
  kind text NOT NULL CHECK (kind IN ('player','reply','event')),
  author_role text NOT NULL CHECK (author_role IN ('player','developer','moderator','game_server')),
  author_name text NOT NULL,
  body text,
  created_at timestamptz NOT NULL,
  event_type text,
  event_verdict text,
  event_receipt_id text,
  event_refund_id text,
  event_refund_applied boolean,
  event_item text,
  event_amount_minor bigint,
  event_currency text,
  event_match_id text,
  event_mode text,
  event_result text,
  event_duration_seconds bigint
);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_id, created_at, id);
CREATE INDEX IF NOT EXISTS messages_game_idx ON messages (game_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  message_id text NOT NULL REFERENCES messages(id),
  game_id text NOT NULL REFERENCES games(id),
  player_id text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size bigint NOT NULL,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','attached','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments (message_id);

CREATE TABLE IF NOT EXISTS purchases (
  game_id text NOT NULL,
  receipt_id text NOT NULL,
  message_id text NOT NULL REFERENCES messages(id),
  item text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, receipt_id)
);

CREATE TABLE IF NOT EXISTS refunds (
  game_id text NOT NULL,
  refund_id text NOT NULL,
  message_id text NOT NULL REFERENCES messages(id),
  receipt_id text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  applied boolean NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, refund_id)
);

CREATE TABLE IF NOT EXISTS nonces (
  game_id text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, nonce)
);
CREATE INDEX IF NOT EXISTS nonces_expiry_idx ON nonces (expires_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id text PRIMARY KEY,
  scope_key text NOT NULL,
  idem_key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('in_progress','completed')),
  request_json jsonb NOT NULL,
  response_json jsonb,
  response_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (scope_key, idem_key)
);
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS refresh_families (
  id text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff(id),
  current_token_hash text NOT NULL,
  change_token text NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  last_rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rotated_refresh_tokens (
  id text PRIMARY KEY,
  family_id text NOT NULL REFERENCES refresh_families(id),
  token_hash text NOT NULL,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, token_hash)
);

CREATE TABLE IF NOT EXISTS revoked_jtis (
  jti text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS revoked_jtis_expiry_idx ON revoked_jtis (expires_at);

CREATE TABLE IF NOT EXISTS access_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rules (
  id text PRIMARY KEY,
  moderator_id text NOT NULL REFERENCES staff(id),
  effect text NOT NULL CHECK (effect IN ('grant','deny')),
  action text NOT NULL CHECK (action IN ('read','reply','close','receipts')),
  topic text NOT NULL CHECK (topic IN ('bug','account','purchase','other','*')),
  position bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rules_moderator_idx ON rules (moderator_id, position);

CREATE TABLE IF NOT EXISTS verdicts (
  message_id text PRIMARY KEY REFERENCES messages(id),
  settled boolean NOT NULL DEFAULT false,
  signature_verdict text NOT NULL,
  signature_secret text NOT NULL DEFAULT 'current',
  bucket_previous integer,
  bucket_level integer,
  bucket_capacity integer,
  sanitiser_verdict text NOT NULL,
  sanitiser_before text,
  sanitiser_after text,
  sanitiser_removed jsonb NOT NULL DEFAULT '[]',
  link_verdict text NOT NULL,
  link_url text,
  link_address text,
  link_title text,
  link_description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS closes (
  thread_id text NOT NULL REFERENCES threads(id),
  closed_at timestamptz NOT NULL,
  PRIMARY KEY (thread_id, closed_at)
);

CREATE TABLE IF NOT EXISTS reopens (
  thread_id text NOT NULL REFERENCES threads(id),
  message_id text NOT NULL REFERENCES messages(id),
  PRIMARY KEY (thread_id, message_id)
);

CREATE TABLE IF NOT EXISTS schema_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version text NOT NULL
);
