export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_keys (
  name text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id text PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  launcher_origin text NOT NULL,
  widget_secret text NOT NULL,
  server_secret text NOT NULL,
  previous_server_secret text,
  previous_valid_until timestamptz
);

CREATE TABLE IF NOT EXISTS staff (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_families (
  id text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff(id),
  change_token text NOT NULL,
  last_rotated_at timestamptz NOT NULL DEFAULT now(),
  revoked boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash text PRIMARY KEY,
  family_id text NOT NULL REFERENCES refresh_families(id) ON DELETE CASCADE,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revoked_access_tokens (
  jti text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id),
  player_id text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS buckets (
  player_row_id text PRIMARY KEY REFERENCES players(id),
  tokens double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS threads (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id),
  player_row_id text NOT NULL UNIQUE REFERENCES players(id),
  topic text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_player_message_at timestamptz NOT NULL,
  waiting_since timestamptz,
  reopens integer NOT NULL DEFAULT 0,
  first_reply_at timestamptz,
  first_closed_at timestamptz,
  last_closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES games(id),
  thread_id text REFERENCES threads(id),
  player_row_id text NOT NULL REFERENCES players(id),
  kind text NOT NULL,
  author_role text NOT NULL,
  author_name text NOT NULL,
  body text,
  created_at timestamptz NOT NULL,
  seq bigserial NOT NULL,
  event jsonb,
  forensics jsonb NOT NULL DEFAULT '[]'::jsonb,
  unfurl jsonb
);

CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_id, created_at, seq);
CREATE INDEX IF NOT EXISTS messages_player_idx ON messages (player_row_id, created_at, seq);
CREATE INDEX IF NOT EXISTS threads_list_idx ON threads (game_id, status, last_player_message_at, id);

CREATE TABLE IF NOT EXISTS purchases (
  game_id text NOT NULL REFERENCES games(id),
  receipt_id text NOT NULL,
  item text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  player_row_id text NOT NULL REFERENCES players(id),
  message_id text NOT NULL REFERENCES messages(id),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, receipt_id)
);

CREATE TABLE IF NOT EXISTS refunds (
  game_id text NOT NULL REFERENCES games(id),
  refund_id text NOT NULL,
  receipt_id text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  player_row_id text NOT NULL REFERENCES players(id),
  message_id text NOT NULL REFERENCES messages(id),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, refund_id)
);

CREATE INDEX IF NOT EXISTS refunds_receipt_idx ON refunds (game_id, receipt_id);
CREATE INDEX IF NOT EXISTS purchases_player_idx ON purchases (game_id, player_row_id);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  message_id text NOT NULL REFERENCES messages(id),
  game_id text NOT NULL REFERENCES games(id),
  player_row_id text NOT NULL REFERENCES players(id),
  filename text NOT NULL,
  content_type text NOT NULL,
  size bigint NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments (message_id, created_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL,
  status_code integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (scope, route, key)
);

CREATE TABLE IF NOT EXISTS webhook_nonces (
  game_id text NOT NULL REFERENCES games(id),
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, nonce)
);

CREATE TABLE IF NOT EXISTS rules (
  id text PRIMARY KEY,
  moderator_id text NOT NULL REFERENCES staff(id),
  effect text NOT NULL,
  action text NOT NULL,
  topic text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL
);

CREATE INDEX IF NOT EXISTS rules_moderator_idx ON rules (moderator_id, seq);
`;
