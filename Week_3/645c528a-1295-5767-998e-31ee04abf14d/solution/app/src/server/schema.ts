export const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  seed_key text UNIQUE,
  email text UNIQUE,
  password_hash text,
  display_name text NOT NULL,
  birth_year int,
  level int NOT NULL DEFAULT 1,
  xp int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  losses int NOT NULL DEFAULT 0,
  win_streak int NOT NULL DEFAULT 0,
  highest_pot bigint NOT NULL DEFAULT 0,
  equipped_cue_id text NOT NULL DEFAULT 'cue-starter',
  equipped_cloth_id text NOT NULL DEFAULT 'cloth-hall-blue',
  email_verified boolean NOT NULL DEFAULT false,
  verify_token_hash text,
  friend_code text UNIQUE,
  settings jsonb NOT NULL DEFAULT '{}',
  fixed_weekly_wins int,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  id uuid NOT NULL,
  player_id uuid NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS signin_failures (
  email text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  failures int NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_lines (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  pair_id uuid NOT NULL,
  player_id uuid REFERENCES players(id),
  currency text NOT NULL CHECK (currency IN ('coins', 'cash')),
  account text NOT NULL CHECK (account IN ('wallet', 'escrow', 'house', 'system')),
  amount bigint NOT NULL,
  kind text NOT NULL,
  ref_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_lines_wallet ON ledger_lines (player_id, currency, seq);
CREATE INDEX IF NOT EXISTS ledger_lines_ref ON ledger_lines (ref_id);
CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('cue', 'cloth')),
  name text NOT NULL,
  currency text NOT NULL,
  price bigint NOT NULL,
  min_level int NOT NULL,
  aim int NOT NULL DEFAULT 0,
  power int NOT NULL DEFAULT 0,
  spin int NOT NULL DEFAULT 0,
  time int NOT NULL DEFAULT 0,
  sort int NOT NULL
);
CREATE TABLE IF NOT EXISTS owned_items (
  player_id uuid NOT NULL REFERENCES players(id),
  item_id text NOT NULL REFERENCES items(id),
  PRIMARY KEY (player_id, item_id)
);
CREATE TABLE IF NOT EXISTS cash_packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  cash bigint NOT NULL,
  price_cents int NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_purchases (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id),
  idempotency_key text NOT NULL,
  pack_id text NOT NULL REFERENCES cash_packs(id),
  response jsonb NOT NULL,
  UNIQUE (player_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id),
  kind text NOT NULL CHECK (kind IN ('verification', 'receipt')),
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox (player_id) WHERE delivered_at IS NULL;
CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('stake', 'private', 'tournament')),
  mode text NOT NULL,
  tier int NOT NULL,
  status text NOT NULL,
  seat_one uuid NOT NULL REFERENCES players(id),
  seat_two uuid REFERENCES players(id),
  tournament_id uuid,
  room jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE TABLE IF NOT EXISTS shots (
  match_id uuid NOT NULL REFERENCES matches(id),
  number int NOT NULL,
  seat int NOT NULL,
  aim_degrees numeric NOT NULL,
  power numeric NOT NULL,
  side_spin numeric NOT NULL,
  top_spin numeric NOT NULL,
  called_pocket text,
  outcome jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, number)
);
CREATE TABLE IF NOT EXISTS weekly_wins (
  player_id uuid NOT NULL REFERENCES players(id),
  week_start date NOT NULL,
  wins int NOT NULL,
  last_win_at timestamptz NOT NULL,
  PRIMARY KEY (player_id, week_start)
);
CREATE TABLE IF NOT EXISTS friend_requests (
  id uuid PRIMARY KEY,
  from_player uuid NOT NULL REFERENCES players(id),
  to_player uuid NOT NULL REFERENCES players(id),
  UNIQUE (from_player, to_player)
);
CREATE TABLE IF NOT EXISTS friendships (
  player_id uuid NOT NULL REFERENCES players(id),
  friend_id uuid NOT NULL REFERENCES players(id),
  PRIMARY KEY (player_id, friend_id)
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id uuid NOT NULL REFERENCES players(id),
  blocked_id uuid NOT NULL REFERENCES players(id),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS clubs (
  id uuid PRIMARY KEY,
  seed_key text UNIQUE,
  name text NOT NULL UNIQUE,
  join_policy text NOT NULL CHECK (join_policy IN ('open', 'request')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS club_members (
  player_id uuid PRIMARY KEY REFERENCES players(id),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'officer', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  ordinal bigserial
);
CREATE TABLE IF NOT EXISTS club_requests (
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id),
  PRIMARY KEY (club_id, player_id)
);
CREATE TABLE IF NOT EXISTS club_messages (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id),
  preset text NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY,
  tier int NOT NULL,
  status text NOT NULL,
  window_ends_at timestamptz,
  ready_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_bracket ON tournaments (tier) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS tournament_entrants (
  tournament_id uuid NOT NULL REFERENCES tournaments(id),
  player_id uuid NOT NULL REFERENCES players(id),
  slot int,
  ready boolean NOT NULL DEFAULT false,
  eliminated_in text,
  seq bigserial,
  PRIMARY KEY (tournament_id, player_id)
);
`;
