export const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS players_email_key ON players (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS players_display_name_key ON players (lower(display_name));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player_id);

CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify', 'reset')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial NOT NULL,
  player_id uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('solo', 'daily')),
  level text NOT NULL,
  puzzle_id text NOT NULL,
  daily_date date,
  status text NOT NULL CHECK (status IN ('playing', 'lost', 'won', 'abandoned')),
  start_board jsonb NOT NULL,
  moves jsonb NOT NULL DEFAULT '[]',
  elapsed_ms integer NOT NULL DEFAULT 0,
  mistakes integer NOT NULL DEFAULT 0,
  hints integer NOT NULL DEFAULT 0,
  second_chance_used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  lost_at timestamptz,
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS games_daily_key ON games (player_id, daily_date) WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS games_player_level ON games (player_id, level, seq);
CREATE INDEX IF NOT EXISTS games_daily_board ON games (daily_date) WHERE mode = 'daily' AND status = 'won';

CREATE TABLE IF NOT EXISTS duels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  level text NOT NULL,
  puzzle_id text NOT NULL,
  seat1_player uuid NOT NULL REFERENCES players (id),
  seat2_player uuid NOT NULL REFERENCES players (id),
  state text NOT NULL,
  winner_player uuid REFERENCES players (id),
  winning_seconds integer,
  ended_at timestamptz NOT NULL
);
`;
