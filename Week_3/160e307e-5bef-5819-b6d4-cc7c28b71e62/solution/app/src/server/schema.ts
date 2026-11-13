/** The whole schema, applied idempotently every time the app serves. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_key text NOT NULL UNIQUE,
  avatar integer NOT NULL DEFAULT 1,
  chosen boolean NOT NULL DEFAULT false,
  email text,
  email_key text UNIQUE,
  rating double precision NOT NULL DEFAULT 1500,
  rd double precision NOT NULL DEFAULT 350,
  volatility double precision NOT NULL DEFAULT 0.06,
  ranked_games integer NOT NULL DEFAULT 0,
  equipped_striker text NOT NULL DEFAULT 'striker-ply',
  equipped_board text NOT NULL DEFAULT 'board-ply',
  equipped_coins text NOT NULL DEFAULT 'coins-ivory',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS link_tokens (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  player_id uuid NOT NULL REFERENCES players(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  format text NOT NULL,
  status text NOT NULL,
  room_code text,
  seat0 uuid REFERENCES players(id),
  seat1 uuid REFERENCES players(id),
  opponent_name text,
  ready0 boolean NOT NULL DEFAULT false,
  ready1 boolean NOT NULL DEFAULT false,
  state jsonb NOT NULL,
  shot_seq integer NOT NULL DEFAULT 0,
  last_result jsonb,
  last_result_seat integer,
  last_was_shot boolean NOT NULL DEFAULT false,
  expired0 boolean NOT NULL DEFAULT false,
  expired1 boolean NOT NULL DEFAULT false,
  turn_deadline timestamptz,
  disconnect0 timestamptz,
  disconnect1 timestamptz,
  toss_line text,
  first_breaker integer,
  settlement jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS matches_seat0 ON matches (seat0, ended_at DESC);
CREATE INDEX IF NOT EXISTS matches_seat1 ON matches (seat1, ended_at DESC);
CREATE INDEX IF NOT EXISTS matches_active ON matches (status);
CREATE TABLE IF NOT EXISTS rooms (
  code text PRIMARY KEY,
  format text NOT NULL,
  host_id uuid NOT NULL REFERENCES players(id),
  guest_id uuid REFERENCES players(id),
  match_id uuid NOT NULL REFERENCES matches(id),
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shots (
  match_id uuid NOT NULL REFERENCES matches(id),
  seq integer NOT NULL,
  seat integer NOT NULL,
  board integer NOT NULL,
  intent jsonb,
  events jsonb NOT NULL,
  verdict jsonb NOT NULL,
  ruled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seq)
);
CREATE TABLE IF NOT EXISTS boards (
  match_id uuid NOT NULL REFERENCES matches(id),
  board integer NOT NULL,
  winner_seat integer NOT NULL,
  points integer NOT NULL,
  line text NOT NULL,
  PRIMARY KEY (match_id, board)
);
CREATE TABLE IF NOT EXISTS queue_entries (
  player_id uuid PRIMARY KEY REFERENCES players(id),
  mode text NOT NULL,
  near integer NOT NULL,
  joined_at timestamptz NOT NULL,
  match_id uuid
);
CREATE TABLE IF NOT EXISTS rematches (
  match_id uuid PRIMARY KEY REFERENCES matches(id),
  offered_by integer NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  new_match_id uuid
);
CREATE TABLE IF NOT EXISTS rating_changes (
  match_id uuid NOT NULL REFERENCES matches(id),
  player_id uuid NOT NULL REFERENCES players(id),
  rating_before double precision NOT NULL,
  rating_after double precision NOT NULL,
  rd_before double precision NOT NULL,
  rd_after double precision NOT NULL,
  volatility_after double precision NOT NULL,
  delta double precision NOT NULL,
  PRIMARY KEY (match_id, player_id)
);
CREATE TABLE IF NOT EXISTS ledger (
  id bigserial PRIMARY KEY,
  movement_id uuid NOT NULL,
  account text NOT NULL,
  player_id uuid NOT NULL REFERENCES players(id),
  delta integer NOT NULL,
  reason text NOT NULL,
  item_id text,
  match_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_player ON ledger (player_id, account);
CREATE TABLE IF NOT EXISTS owned_items (
  player_id uuid NOT NULL REFERENCES players(id),
  item_id text NOT NULL,
  PRIMARY KEY (player_id, item_id)
);
CREATE TABLE IF NOT EXISTS idempotent_requests (
  player_id uuid NOT NULL REFERENCES players(id),
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (player_id, scope, key)
);
`;
