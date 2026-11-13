// Applied idempotently on every start, under an advisory lock so two instances can boot together.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_hits (
  scope text NOT NULL,
  key text NOT NULL,
  at_ms bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_hits_lookup ON rate_hits (scope, key, at_ms);
CREATE TABLE IF NOT EXISTS server_clock (
  id integer PRIMARY KEY CHECK (id = 1),
  offset_ms bigint NOT NULL
);
INSERT INTO server_clock (id, offset_ms) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS tournaments (
  id text PRIMARY KEY,
  name text NOT NULL,
  format text NOT NULL,
  time_zone text NOT NULL,
  fill text NOT NULL,
  state text NOT NULL,
  organizer_id text NOT NULL REFERENCES users(id),
  share_code text NOT NULL UNIQUE,
  checkin_closes_at bigint,
  field_size integer,
  swiss_rounds integer,
  seeding_version integer NOT NULL DEFAULT 0,
  seeding_updated_by text,
  logo_key text,
  logo_sha text,
  roster_key text,
  roster_name text,
  live_seq bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  finished_at bigint
);
CREATE TABLE IF NOT EXISTS co_organizers (
  tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  PRIMARY KEY (tournament_id, user_id)
);
CREATE TABLE IF NOT EXISTS entrants (
  id text PRIMARY KEY,
  tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name text NOT NULL,
  seed integer NOT NULL,
  user_id text REFERENCES users(id),
  checked_in boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS entrants_tournament ON entrants (tournament_id, seed);
CREATE UNIQUE INDEX IF NOT EXISTS entrants_one_account ON entrants (tournament_id, user_id) WHERE user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY,
  tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  bracket text NOT NULL,
  round integer NOT NULL,
  number integer NOT NULL,
  label text NOT NULL,
  upper_kind text NOT NULL,
  upper_entrant_id text,
  lower_kind text NOT NULL,
  lower_entrant_id text,
  state text NOT NULL,
  winner text,
  upper_games integer,
  lower_games integer,
  report jsonb,
  dispute jsonb,
  called_at bigint,
  overdue boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL,
  resolved_by text,
  paired_at bigint,
  winner_to text,
  winner_slot text,
  loser_to text,
  loser_slot text
);
CREATE INDEX IF NOT EXISTS matches_tournament ON matches (tournament_id);
CREATE INDEX IF NOT EXISTS matches_reported ON matches (state) WHERE state = 'reported';
CREATE TABLE IF NOT EXISTS live_messages (
  tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  type text NOT NULL,
  at_ms bigint NOT NULL,
  data jsonb NOT NULL,
  organizers_only boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tournament_id, seq)
);
CREATE TABLE IF NOT EXISTS history_rows (
  user_id text NOT NULL REFERENCES users(id),
  tournament_id text NOT NULL,
  tournament_name text NOT NULL,
  place integer NOT NULL,
  field_size integer NOT NULL,
  finished_on text NOT NULL,
  finished_at bigint NOT NULL,
  text text NOT NULL,
  PRIMARY KEY (user_id, tournament_id)
);
`;
