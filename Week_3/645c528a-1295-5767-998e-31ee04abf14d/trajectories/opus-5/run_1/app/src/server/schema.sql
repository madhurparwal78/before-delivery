CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  birth_year INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  coins BIGINT NOT NULL DEFAULT 0,
  cash BIGINT NOT NULL DEFAULT 0,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  minor BOOLEAN NOT NULL DEFAULT FALSE,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  win_streak INTEGER NOT NULL DEFAULT 0,
  highest_pot BIGINT NOT NULL DEFAULT 0,
  weekly_wins INTEGER NOT NULL DEFAULT 0,
  week_start DATE,
  last_win_at TIMESTAMPTZ,
  equipped_cue_id TEXT,
  equipped_cloth_id TEXT,
  friend_code TEXT UNIQUE,
  daily_claim_date DATE,
  refill_date DATE,
  refill_count INTEGER NOT NULL DEFAULT 0,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  seeded BOOLEAN NOT NULL DEFAULT FALSE,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_lines (
  id UUID PRIMARY KEY,
  seq BIGSERIAL,
  pair_id UUID NOT NULL,
  player_id UUID,
  currency TEXT NOT NULL,
  account TEXT NOT NULL,
  amount BIGINT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_player_idx ON ledger_lines (player_id, currency, seq DESC);
CREATE INDEX IF NOT EXISTS ledger_ref_idx ON ledger_lines (ref_id);

CREATE TABLE IF NOT EXISTS player_items (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, item_id)
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  token TEXT PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  voided BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id UUID PRIMARY KEY,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  delivered BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signin_failures (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signin_failures_idx ON signin_failures (email, created_at DESC);

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY,
  mode TEXT NOT NULL,
  tier INTEGER,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  entry BIGINT NOT NULL DEFAULT 0,
  pot BIGINT NOT NULL DEFAULT 0,
  seat1 UUID REFERENCES players(id) ON DELETE SET NULL,
  seat2 UUID REFERENCES players(id) ON DELETE SET NULL,
  seat1_session UUID,
  seat2_session UUID,
  state JSONB NOT NULL,
  script JSONB,
  script_index INTEGER NOT NULL DEFAULT 0,
  winner_seat INTEGER,
  result_case TEXT,
  tournament_id UUID,
  tournament_round TEXT,
  seat_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  settlement JSONB,
  host_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS shots (
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL,
  aim_degrees NUMERIC NOT NULL,
  power NUMERIC NOT NULL,
  side_spin NUMERIC NOT NULL,
  top_spin NUMERIC NOT NULL,
  called_pocket TEXT,
  outcome JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS queue_tickets (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  session_id UUID,
  mode TEXT NOT NULL,
  tier INTEGER NOT NULL,
  status TEXT NOT NULL,
  table_id UUID,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id UUID PRIMARY KEY,
  from_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friendships (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, friend_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS clubs (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  join_policy TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_members (
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, player_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS club_member_once_idx ON club_members (player_id);

CREATE TABLE IF NOT EXISTS club_requests (
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, player_id)
);

CREATE TABLE IF NOT EXISTS club_messages (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  preset TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY,
  tier INTEGER NOT NULL,
  status TEXT NOT NULL,
  window_started_at TIMESTAMPTZ,
  ready_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_entrants (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot INTEGER,
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_id TEXT,
  receipt TEXT,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS purchases_key_idx ON purchases (player_id, idempotency_key);

CREATE TABLE IF NOT EXISTS killbill_accounts (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL
);
