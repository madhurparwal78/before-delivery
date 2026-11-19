// Postgres schema, applied idempotently on every boot.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
  player_id text PRIMARY KEY,
  name text NOT NULL,
  guest boolean NOT NULL DEFAULT true,
  email text,
  units text NOT NULL DEFAULT 'kmh',
  retired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(player_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owned_cars (
  player_id text NOT NULL REFERENCES players(player_id),
  car_id text NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  PRIMARY KEY (player_id, car_id)
);

CREATE TABLE IF NOT EXISTS car_stages (
  player_id text NOT NULL,
  car_id text NOT NULL,
  system text NOT NULL,
  stage int NOT NULL DEFAULT 0,
  paid int NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, car_id, system)
);

CREATE TABLE IF NOT EXISTS ledger (
  movement_id text PRIMARY KEY,
  player_id text NOT NULL,
  kind text NOT NULL,
  run_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  wallet_amount int NOT NULL,
  counter_account text NOT NULL,
  counter_amount int NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_player_idx ON ledger (player_id, created_at DESC, movement_id);

CREATE TABLE IF NOT EXISTS idempotency (
  player_id text NOT NULL,
  key text NOT NULL,
  body_sha text NOT NULL,
  status int NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, key)
);

CREATE TABLE IF NOT EXISTS purchases (
  purchase_id text PRIMARY KEY,
  player_id text NOT NULL,
  car_id text NOT NULL,
  system text NOT NULL,
  stage int NOT NULL,
  price int NOT NULL,
  reference jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  run_id text PRIMARY KEY,
  player_id text NOT NULL,
  layout_id text NOT NULL,
  mode text NOT NULL,
  car_id text NOT NULL,
  event_id text,
  loaner boolean NOT NULL DEFAULT false,
  laps int NOT NULL,
  step_limit int NOT NULL,
  seed text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  reason text,
  car_stats jsonb NOT NULL,
  car_stages jsonb NOT NULL,
  replay_sha text,
  held_bytes bytea,
  stored_at timestamptz,
  verify_at timestamptz,
  lap_results jsonb,
  race_ms int,
  best_lap_ms int,
  drift_score int,
  coins_collected int,
  position int,
  clean boolean,
  payout int,
  payouts jsonb,
  top_speed_mps real,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_player_idx ON runs (player_id);

CREATE TABLE IF NOT EXISTS boards (
  layout_id text NOT NULL,
  mode text NOT NULL,
  class text NOT NULL,
  player_id text NOT NULL,
  run_id text NOT NULL,
  value int NOT NULL,
  top_speed_mps real NOT NULL,
  replay_sha text,
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (layout_id, mode, class, player_id)
);

CREATE TABLE IF NOT EXISTS event_points (
  player_id text NOT NULL,
  event_id text NOT NULL,
  points int NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, event_id)
);

CREATE TABLE IF NOT EXISTS league_state (
  player_id text NOT NULL,
  league_id text NOT NULL,
  complete boolean NOT NULL DEFAULT false,
  PRIMARY KEY (player_id, league_id)
);

CREATE TABLE IF NOT EXISTS player_flags (
  player_id text PRIMARY KEY,
  rookie_complete boolean NOT NULL DEFAULT false,
  club_complete boolean NOT NULL DEFAULT false,
  trophy boolean NOT NULL DEFAULT false,
  guided_paid boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS signin_links (
  token text PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS lobbies (
  lobby_id text PRIMARY KEY,
  host_id text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  ai_count int NOT NULL DEFAULT 0,
  countdown int,
  grace_seconds_left int,
  countdown_started_at timestamptz,
  first_finish_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lobby_players (
  lobby_id text NOT NULL,
  player_id text NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT true,
  reconnecting boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lobby_id, player_id)
);

CREATE TABLE IF NOT EXISTS counter_accounts (
  account text PRIMARY KEY
);
`;
