-- Plotwright schema, applied idempotently at every serve.

CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  display_name text NOT NULL,
  email text NOT NULL UNIQUE,
  passcode_hash text NOT NULL,
  sound_on boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servers (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  owner_id text NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending_approval', -- pending_approval|active|past_due|suspended
  plan text NOT NULL, -- hamlet|borough
  pending_plan text, -- hamlet|borough|null
  payment_pending boolean NOT NULL DEFAULT false,
  time_zone text NOT NULL DEFAULT 'UTC',
  season integer NOT NULL DEFAULT 1,
  weather_seed integer NOT NULL DEFAULT 0,
  killbill_account_id text,
  past_due_since timestamptz,
  suspends_at timestamptz,
  kb_balance text NOT NULL DEFAULT '0.00',
  kb_checked_at timestamptz,
  kb_reachable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS worlds (
  id text PRIMARY KEY,
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  tiles text NOT NULL,
  UNIQUE (server_id, slug)
);

CREATE TABLE IF NOT EXISTS blocks (
  server_id text NOT NULL,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  material text NOT NULL, -- wood|stone|brick|glass
  PRIMARY KEY (world_id, x, y)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL, -- car|plane
  owner_character_id text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL
);

CREATE TABLE IF NOT EXISTS tables_ (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name text NOT NULL,
  game text NOT NULL, -- chess|four|tricks
  x integer NOT NULL,
  y integer NOT NULL,
  state text NOT NULL DEFAULT 'open', -- open|seated|in_play|finished|settled
  stake integer NOT NULL DEFAULT 10,
  turn_seconds integer NOT NULL DEFAULT 30,
  etag text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS characters (
  id text PRIMARY KEY,
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  world_id text NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  appearance text NOT NULL, -- surveyor|mason|pilot|gardener
  x integer NOT NULL,
  y integer NOT NULL,
  etag text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS characters_name_unique ON characters (server_id, lower(name));

CREATE TABLE IF NOT EXISTS inventory_slots (
  character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 24),
  kind text, -- item kind or null
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  held integer NOT NULL DEFAULT 0 CHECK (held >= 0),
  PRIMARY KEY (character_id, slot)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  character_id text NOT NULL REFERENCES characters(id),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_world_idx ON chat_messages (world_id, created_at, id);

CREATE TABLE IF NOT EXISTS trips (
  id text PRIMARY KEY,
  vehicle_id text NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  from_x integer NOT NULL,
  from_y integer NOT NULL,
  to_x integer NOT NULL,
  to_y integer NOT NULL,
  steps text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parties (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  world_id text NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'open', -- open|closed
  leader_id text NOT NULL REFERENCES characters(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS party_members (
  party_id text NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  character_id text NOT NULL REFERENCES characters(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, character_id)
);

CREATE TABLE IF NOT EXISTS chapter_runs (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  party_id text NOT NULL REFERENCES parties(id),
  chapter_id text NOT NULL,
  world_id text NOT NULL,
  state text NOT NULL DEFAULT 'in_progress', -- in_progress|paused|completed
  started_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_walk_log (
  run_id text NOT NULL REFERENCES chapter_runs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  character_id text NOT NULL,
  step text NOT NULL, -- N|E|S|W
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS run_start_tiles (
  run_id text NOT NULL REFERENCES chapter_runs(id) ON DELETE CASCADE,
  character_id text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  PRIMARY KEY (run_id, character_id)
);

CREATE TABLE IF NOT EXISTS run_checkpoints (
  run_id text NOT NULL REFERENCES chapter_runs(id) ON DELETE CASCADE,
  n integer NOT NULL,
  name text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  reached boolean NOT NULL DEFAULT false,
  reached_at timestamptz,
  stored boolean NOT NULL DEFAULT false,
  storing boolean NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, n)
);

CREATE TABLE IF NOT EXISTS seats (
  table_id text NOT NULL REFERENCES tables_(id) ON DELETE CASCADE,
  seat integer NOT NULL,
  character_id text NOT NULL REFERENCES characters(id),
  PRIMARY KEY (table_id, seat)
);
CREATE UNIQUE INDEX IF NOT EXISTS seat_character_idx ON seats (character_id);


CREATE TABLE IF NOT EXISTS spectators (
  table_id text NOT NULL REFERENCES tables_(id) ON DELETE CASCADE,
  character_id text NOT NULL REFERENCES characters(id),
  PRIMARY KEY (table_id, character_id)
);

CREATE TABLE IF NOT EXISTS games (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  table_id text NOT NULL REFERENCES tables_(id),
  game text NOT NULL, -- chess|four|tricks
  seed text,
  state text NOT NULL DEFAULT 'in_play', -- in_play|finished
  turn integer NOT NULL DEFAULT 0,
  to_move_seat integer,
  position jsonb NOT NULL,
  hands jsonb,
  turn_deadline timestamptz,
  rematch_offers text[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS games_table_idx ON games (table_id);

CREATE TABLE IF NOT EXISTS game_moves (
  game_id text NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  seat integer NOT NULL,
  move text NOT NULL,
  announcement text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, seq)
);

CREATE TABLE IF NOT EXISTS game_results (
  game_id text PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  result jsonb NOT NULL,
  stored boolean NOT NULL DEFAULT false,
  stored_at timestamptz
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  kind text NOT NULL, -- grant|stake|settlement|top_up|refund|trade
  game_id text,
  trade_id text,
  purchase_id text,
  lines jsonb NOT NULL, -- [{"account","amount"}]
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_server_idx ON ledger_entries (server_id, created_at);

CREATE TABLE IF NOT EXISTS trades (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  world_id text NOT NULL,
  state text NOT NULL DEFAULT 'open', -- open|completed|cancelled
  version integer NOT NULL DEFAULT 0,
  a_character_id text NOT NULL,
  b_character_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_open_idx ON trades (a_character_id) WHERE state = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS trade_open_b_idx ON trades (b_character_id) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS trade_sides (
  trade_id text NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  character_id text NOT NULL,
  coins integer NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]',
  accepted boolean NOT NULL DEFAULT false,
  accepted_at timestamptz,
  PRIMARY KEY (trade_id, character_id)
);

CREATE TABLE IF NOT EXISTS coin_purchases (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  character_id text NOT NULL REFERENCES characters(id),
  user_id text NOT NULL,
  pack text NOT NULL, -- pouch|satchel|chest
  coins integer NOT NULL,
  price text NOT NULL,
  state text NOT NULL DEFAULT 'pending', -- pending|paid|refunded
  receipt text NOT NULL DEFAULT 'held', -- sent|held
  kb_payment_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  killbill_invoice_id text,
  killbill_payment_id text,
  killbill_payment_attempted_at timestamptz
);
CREATE INDEX IF NOT EXISTS purchases_server_idx ON coin_purchases (server_id, created_at);

CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending', -- pending|used|expired|superseded
  mail_state text NOT NULL DEFAULT 'held', -- sent|held
  inviter_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_email_idx ON invites (server_id, email);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  kind text NOT NULL,
  to_handle text,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'held',
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS mail_state_idx ON mail_outbox (state);

CREATE TABLE IF NOT EXISTS events (
  server_id text NOT NULL,
  seq bigint NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  audience jsonb, -- {"users":[handle],"characters":[id],"world":slug,"table":id}
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, seq)
);

CREATE TABLE IF NOT EXISTS event_counters (
  server_id text PRIMARY KEY,
  seq bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id text NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  status integer NOT NULL,
  body text NOT NULL,
  etag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS world_saves (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  number integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_from integer,
  snapshot_key text NOT NULL,
  manifest_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS world_saves_number_unique ON world_saves (world_id, number);

CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  key text NOT NULL,
  manifest_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seasons (
  server_id text NOT NULL,
  n integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, n)
);

CREATE TABLE IF NOT EXISTS wins (
  server_id text NOT NULL,
  season integer NOT NULL,
  game text NOT NULL,
  character_id text NOT NULL REFERENCES characters(id),
  won_at timestamptz NOT NULL,
  PRIMARY KEY (server_id, season, game, character_id, won_at)
);

CREATE TABLE IF NOT EXISTS achievements (
  character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, name)
);

CREATE TABLE IF NOT EXISTS blocks_broken_total (
  character_id text PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  broken integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pending_payments (
  id text PRIMARY KEY,
  server_id text NOT NULL,
  kind text NOT NULL, -- invoice|coins
  purchase_id text,
  invoice_id text NOT NULL,
  external_key text NOT NULL,
  amount text NOT NULL,
  owner_id text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  completed boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_invoice_idx ON pending_payments (invoice_id) WHERE NOT completed;

CREATE TABLE IF NOT EXISTS kb_accounts (
  external_key text PRIMARY KEY,
  account_id text NOT NULL,
  kind text NOT NULL -- server|buyer
);

CREATE TABLE IF NOT EXISTS kb_invoices (
  invoice_id text PRIMARY KEY,
  server_id text NOT NULL,
  account_id text NOT NULL,
  number bigint NOT NULL,
  amount text NOT NULL,
  status text NOT NULL, -- OPEN|PAID etc from Kill Bill
  charged_plan text,
  charge_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_invoices_server_idx ON kb_invoices (server_id, number);

CREATE TABLE IF NOT EXISTS kb_payments (
  payment_id text PRIMARY KEY,
  server_id text NOT NULL,
  invoice_id text NOT NULL,
  external_key text NOT NULL,
  amount text NOT NULL,
  paid_at date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_credits (
  item_id text PRIMARY KEY,
  server_id text NOT NULL,
  invoice_id text NOT NULL,
  amount text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_plan_events (
  event_id text PRIMARY KEY,
  server_id text NOT NULL,
  effective_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Atomic per-server event sequence.
CREATE OR REPLACE FUNCTION next_event_seq(p_server_id text) RETURNS bigint AS $$
DECLARE
  next_val bigint;
BEGIN
  INSERT INTO event_counters (server_id, seq) VALUES (p_server_id, 1)
  ON CONFLICT (server_id) DO UPDATE SET seq = event_counters.seq + 1
  RETURNING event_counters.seq INTO next_val;
  RETURN next_val;
END;
$$ LANGUAGE plpgsql;
