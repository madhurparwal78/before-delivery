export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version integer PRIMARY KEY
);
INSERT INTO schema_version (version) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  birth_year integer NOT NULL,
  minor boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT false,
  verify_token text,
  verify_token_at timestamptz,
  level integer NOT NULL DEFAULT 1,
  xp integer NOT NULL DEFAULT 0,
  coins bigint NOT NULL DEFAULT 0,
  cash bigint NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  win_streak integer NOT NULL DEFAULT 0,
  highest_pot bigint NOT NULL DEFAULT 0,
  weekly_wins integer NOT NULL DEFAULT 0,
  last_win_at timestamptz,
  daily_claimed_day text,
  refills_day text,
  refills_used integer NOT NULL DEFAULT 0,
  equipped_cue_id text NOT NULL DEFAULT 'cue-starter',
  equipped_cloth_id text NOT NULL DEFAULT 'cloth-hall-blue',
  friend_code text UNIQUE NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_seed boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signin_attempts (
  id bigserial PRIMARY KEY,
  email_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signin_attempts_email_time ON signin_attempts (email_key, created_at);

CREATE TABLE IF NOT EXISTS ledger_lines (
  id text PRIMARY KEY,
  pair_id text NOT NULL,
  player_id text REFERENCES players(id) ON DELETE SET NULL,
  currency text NOT NULL CHECK (currency IN ('coins','cash')),
  account text NOT NULL CHECK (account IN ('wallet','escrow','house','system')),
  amount bigint NOT NULL,
  kind text NOT NULL,
  ref_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_player ON ledger_lines (player_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_lines (ref_id);

CREATE TABLE IF NOT EXISTS escrow_accounts (
  ref_id text PRIMARY KEY,
  currency text NOT NULL,
  balance bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY,
  mode text NOT NULL,
  tier integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('stake','private','tournament','grading')),
  status text NOT NULL CHECK (status IN ('paired','in_play','settled','forfeited','voided')),
  seat1_player text,
  seat2_player text,
  seat1_session text,
  seat2_session text,
  active_seat integer NOT NULL DEFAULT 1,
  phase text NOT NULL DEFAULT 'break' CHECK (phase IN ('break','open','groups')),
  group_seat1 text CHECK (group_seat1 IN ('solids','stripes')),
  group_seat2 text CHECK (group_seat2 IN ('solids','stripes')),
  balls jsonb NOT NULL DEFAULT '[]'::jsonb,
  cue_ball_across integer NOT NULL DEFAULT 50,
  cue_ball_along integer NOT NULL DEFAULT 88,
  ball_in_hand boolean NOT NULL DEFAULT false,
  ball_in_hand_seat integer,
  ball_in_hand_behind_head boolean NOT NULL DEFAULT false,
  called_pocket text,
  script jsonb,
  script_index integer NOT NULL DEFAULT 0,
  pot bigint NOT NULL DEFAULT 0,
  entry bigint NOT NULL DEFAULT 0,
  shot_clock_seconds integer NOT NULL,
  turn_started_at timestamptz NOT NULL DEFAULT now(),
  seat1_connected_at timestamptz NOT NULL DEFAULT now(),
  seat2_connected_at timestamptz NOT NULL DEFAULT now(),
  seat1_dropped_since timestamptz,
  seat2_dropped_since timestamptz,
  seat1_timeouts integer NOT NULL DEFAULT 0,
  seat2_timeouts integer NOT NULL DEFAULT 0,
  seat1_cue_stats jsonb,
  seat2_cue_stats jsonb,
  result_line text,
  winner_seat integer,
  voided boolean NOT NULL DEFAULT false,
  settlement_written boolean NOT NULL DEFAULT false,
  escrow_closed boolean NOT NULL DEFAULT false,
  tournament_id text,
  tournament_round integer,
  rematch_seat1 boolean NOT NULL DEFAULT false,
  rematch_seat2 boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_matches_player ON matches (seat1_player, status);
CREATE INDEX IF NOT EXISTS idx_matches_player2 ON matches (seat2_player, status);

CREATE TABLE IF NOT EXISTS shots (
  id text PRIMARY KEY,
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat integer NOT NULL,
  aim_degrees numeric NOT NULL,
  power integer NOT NULL,
  side_spin integer NOT NULL,
  top_spin integer NOT NULL,
  called_pocket text,
  ruling jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shots_match ON shots (match_id, created_at);

CREATE TABLE IF NOT EXISTS queue_tickets (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  session_id text,
  mode text NOT NULL,
  tier integer NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','paired')),
  match_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_tickets (mode, tier, status, created_at);

CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('cue','cloth')),
  name text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('coins','cash')),
  price bigint NOT NULL,
  min_level integer NOT NULL,
  aim integer NOT NULL DEFAULT 0,
  power integer NOT NULL DEFAULT 0,
  spin integer NOT NULL DEFAULT 0,
  time integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS item_owners (
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, item_id)
);

CREATE TABLE IF NOT EXISTS cash_packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  cash bigint NOT NULL,
  price_usd numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pack_id text NOT NULL REFERENCES cash_packs(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  price_snapshot numeric,
  status text NOT NULL CHECK (status IN ('pending','confirmed','failed')),
  cash bigint NOT NULL,
  payment_id text,
  receipt text,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_idem ON purchases (player_id, idempotency_key);

CREATE TABLE IF NOT EXISTS friends (
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, friend_id)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id text PRIMARY KEY,
  from_player text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_player text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_player, to_player)
);

CREATE TABLE IF NOT EXISTS blocks (
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS connections (
  session_id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connections_player ON connections (player_id);

CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  table_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  host_player text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_by text
);

CREATE TABLE IF NOT EXISTS clubs (
  id text PRIMARY KEY,
  name text UNIQUE NOT NULL,
  join_policy text NOT NULL CHECK (join_policy IN ('open','request')),
  owner_id text NOT NULL,
  weekly_score integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_members (
  club_id text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','officer','member')),
  weekly_wins integer NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, player_id)
);

CREATE TABLE IF NOT EXISTS club_requests (
  club_id text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, player_id)
);

CREATE TABLE IF NOT EXISTS club_messages (
  id text PRIMARY KEY,
  club_id text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id text NOT NULL,
  display_name text NOT NULL,
  preset text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_club_messages ON club_messages (club_id, created_at);

CREATE TABLE IF NOT EXISTS tournaments (
  id text PRIMARY KEY,
  tier integer NOT NULL,
  status text NOT NULL CHECK (status IN ('open','full','ready_check','round_of_8','semi_finals','final','paid','refunded','closed')),
  entry bigint NOT NULL,
  window_started_at timestamptz,
  window_ends_at timestamptz,
  ready_ends_at timestamptz,
  bracket_drawn boolean NOT NULL DEFAULT false,
  round integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_entrants (
  tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot integer,
  ready boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  eliminated boolean NOT NULL DEFAULT false,
  prize_paid bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_tournament_entrants_slot ON tournament_entrants (tournament_id, slot);

CREATE TABLE IF NOT EXISTS tournament_matches (
  tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round integer NOT NULL,
  match_index integer NOT NULL,
  match_id text REFERENCES matches(id) ON DELETE CASCADE,
  seat1_slot integer,
  seat2_slot integer,
  winner_slot integer,
  voided boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tournament_id, round, match_index)
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('verification','receipt')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_mail_pending ON mail_outbox (status);
`;
