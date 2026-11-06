export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  handle          text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  email           text NOT NULL UNIQUE,
  passcode_hash   text NOT NULL,
  sound           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servers (
  id                 text PRIMARY KEY,
  slug               text NOT NULL UNIQUE,
  name               text NOT NULL,
  owner_id           text NOT NULL REFERENCES users(id),
  plan               text NOT NULL,
  pending_plan       text,
  status             text NOT NULL,
  time_zone          text NOT NULL DEFAULT 'UTC',
  weather_seed       integer NOT NULL DEFAULT 0,
  season             integer NOT NULL DEFAULT 1,
  balance            numeric(12,2) NOT NULL DEFAULT 0,
  past_due_since     timestamptz,
  suspends_at        timestamptz,
  kb_account_id      text,
  provider_reachable boolean NOT NULL DEFAULT true,
  checked_at         timestamptz,
  polled_at          timestamptz,
  weather_period     bigint,
  event_seq          bigint NOT NULL DEFAULT 0,
  revision           bigint NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS servers_name_ci ON servers (lower(name));

CREATE TABLE IF NOT EXISTS members (
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS worlds (
  id         text PRIMARY KEY,
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  slug       text NOT NULL,
  name       text NOT NULL,
  tiles      text NOT NULL,
  revision   bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, slug)
);

CREATE TABLE IF NOT EXISTS blocks (
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  world_id  text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  x         integer NOT NULL,
  y         integer NOT NULL,
  material  text NOT NULL,
  PRIMARY KEY (world_id, x, y)
);

CREATE TABLE IF NOT EXISTS characters (
  id         text PRIMARY KEY,
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  world_id   text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name       text NOT NULL,
  appearance text NOT NULL,
  loadout    jsonb NOT NULL DEFAULT '[]'::jsonb,
  x          integer NOT NULL,
  y          integer NOT NULL,
  revision   bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS characters_name_ci ON characters (server_id, lower(name));
CREATE INDEX IF NOT EXISTS characters_by_user ON characters (server_id, user_id);

CREATE TABLE IF NOT EXISTS inventory_slots (
  character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  slot         integer NOT NULL,
  kind         text,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, slot)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id                  text PRIMARY KEY,
  server_id           text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  world_id            text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name                text NOT NULL,
  kind                text NOT NULL,
  owner_character_id  text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  x                   integer NOT NULL,
  y                   integer NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id         text PRIMARY KEY,
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  vehicle_id text NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  from_x     integer NOT NULL,
  from_y     integer NOT NULL,
  to_x       integer NOT NULL,
  to_y       integer NOT NULL,
  steps      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_tables (
  id            text PRIMARY KEY,
  server_id     text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  world_id      text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name          text NOT NULL,
  game          text NOT NULL,
  x             integer NOT NULL,
  y             integer NOT NULL,
  state         text NOT NULL DEFAULT 'open',
  stake         integer NOT NULL DEFAULT 10,
  turn_seconds  integer NOT NULL DEFAULT 30,
  game_id       text,
  revision      bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS seats (
  table_id     text NOT NULL REFERENCES game_tables(id) ON DELETE CASCADE,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  seat         integer NOT NULL,
  character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (table_id, seat)
);
CREATE UNIQUE INDEX IF NOT EXISTS seats_one_per_character ON seats (character_id);

CREATE TABLE IF NOT EXISTS spectators (
  table_id     text NOT NULL REFERENCES game_tables(id) ON DELETE CASCADE,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (table_id, character_id)
);

CREATE TABLE IF NOT EXISTS games (
  id           text PRIMARY KEY,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  table_id     text NOT NULL REFERENCES game_tables(id) ON DELETE CASCADE,
  game         text NOT NULL,
  season       integer NOT NULL,
  stake        integer NOT NULL,
  seed         bigint,
  seats        jsonb NOT NULL,
  hands        jsonb,
  moves        jsonb NOT NULL DEFAULT '[]'::jsonb,
  position     jsonb NOT NULL,
  state        text NOT NULL,
  to_move_seat integer,
  deadline     timestamptz,
  result       jsonb,
  settled      boolean NOT NULL DEFAULT false,
  pending_store boolean NOT NULL DEFAULT false,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS games_by_server ON games (server_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS rematch_offers (
  table_id     text NOT NULL REFERENCES game_tables(id) ON DELETE CASCADE,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (table_id, character_id)
);

CREATE TABLE IF NOT EXISTS parties (
  id         text PRIMARY KEY,
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name       text NOT NULL,
  state      text NOT NULL DEFAULT 'open',
  leader_id  text REFERENCES characters(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS party_members (
  party_id     text NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, character_id)
);

CREATE TABLE IF NOT EXISTS chapter_runs (
  id          text PRIMARY KEY,
  server_id   text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  party_id    text NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  chapter_id  text NOT NULL,
  world_id    text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  state       text NOT NULL DEFAULT 'in_progress',
  start_tiles jsonb NOT NULL,
  walk_log    jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkpoints (
  run_id     text NOT NULL REFERENCES chapter_runs(id) ON DELETE CASCADE,
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  n          integer NOT NULL,
  name       text NOT NULL,
  x          integer NOT NULL,
  y          integer NOT NULL,
  reached    boolean NOT NULL DEFAULT false,
  stored     boolean NOT NULL DEFAULT false,
  reached_at timestamptz,
  PRIMARY KEY (run_id, n)
);

CREATE TABLE IF NOT EXISTS trades (
  id          text PRIMARY KEY,
  server_id   text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  state       text NOT NULL DEFAULT 'open',
  version     integer NOT NULL DEFAULT 1,
  a_char      text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  b_char      text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  a_coins     integer NOT NULL DEFAULT 0,
  b_coins     integer NOT NULL DEFAULT 0,
  a_items     jsonb NOT NULL DEFAULT '[]'::jsonb,
  b_items     jsonb NOT NULL DEFAULT '[]'::jsonb,
  a_accepted_at timestamptz,
  b_accepted_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id          text PRIMARY KEY,
  server_id   text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  game_id     text,
  trade_id    text,
  purchase_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_lines (
  entry_id  text NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  account   text NOT NULL,
  amount    integer NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_lines_account ON ledger_lines (server_id, account);

CREATE TABLE IF NOT EXISTS invites (
  id         text PRIMARY KEY,
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  inviter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  token      text NOT NULL UNIQUE,
  state      text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail (
  id         text PRIMARY KEY,
  server_id  text REFERENCES servers(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  to_handle  text NOT NULL,
  to_email   text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  state      text NOT NULL DEFAULT 'held',
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);

CREATE TABLE IF NOT EXISTS coin_purchases (
  id            text PRIMARY KEY,
  server_id     text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id  text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  pack          text NOT NULL,
  coins         integer NOT NULL,
  price         numeric(12,2) NOT NULL,
  state         text NOT NULL DEFAULT 'pending',
  kb_account_id text,
  kb_invoice_id text,
  kb_payment_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  local_day     date NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_by_day ON coin_purchases (server_id, user_id, local_day);

CREATE TABLE IF NOT EXISTS pending_payments (
  id           text PRIMARY KEY,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  purchase_id  text,
  invoice_id   text,
  kb_account_id text NOT NULL,
  external_key text NOT NULL UNIQUE,
  amount       numeric(12,2) NOT NULL,
  state        text NOT NULL DEFAULT 'pending',
  attempted_at timestamptz NOT NULL DEFAULT now(),
  resent_at    timestamptz
);

CREATE TABLE IF NOT EXISTS world_saves (
  id            text PRIMARY KEY,
  server_id     text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  world_id      text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  number        integer NOT NULL,
  restored_from integer,
  snapshot_key  text NOT NULL,
  manifest_key  text NOT NULL,
  sha256        text NOT NULL,
  bytes         integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, number)
);

CREATE TABLE IF NOT EXISTS world_exports (
  id           text PRIMARY KEY,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  key          text NOT NULL,
  manifest_key text NOT NULL,
  sha256       text NOT NULL,
  bytes        integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           text PRIMARY KEY,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  world_id     text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  character_id text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  text         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_by_world ON chat_messages (world_id, created_at);

CREATE TABLE IF NOT EXISTS server_events (
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  seq        bigint NOT NULL,
  stream     text NOT NULL,
  scope_id   text,
  kind       text NOT NULL,
  payload    jsonb NOT NULL,
  audience   jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, seq)
);
CREATE INDEX IF NOT EXISTS events_recent ON server_events (server_id, created_at);

CREATE TABLE IF NOT EXISTS achievements (
  character_id   text NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  server_id      text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  achievement_id text NOT NULL,
  name           text NOT NULL,
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS break_counts (
  character_id text PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  server_id    text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  broken       integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS idempotency (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  key        text NOT NULL,
  body_hash  text NOT NULL,
  status     integer NOT NULL,
  response   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS presence (
  server_id   text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  open_count  integer NOT NULL DEFAULT 0,
  closed_at   timestamptz,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS billing_notices (
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  ref        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, kind, ref)
);

CREATE TABLE IF NOT EXISTS seed_state (
  key        text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;
