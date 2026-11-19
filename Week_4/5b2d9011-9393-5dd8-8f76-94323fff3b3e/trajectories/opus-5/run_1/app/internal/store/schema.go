package store

import "context"

const schemaSQL = `
CREATE TABLE IF NOT EXISTS studio (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  zone        text NOT NULL,
  key_hash    text NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id         text PRIMARY KEY,
  callsign   text NOT NULL,
  role       text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  player_id  text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS player_settings (
  player_id      text PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  bindings       jsonb NOT NULL,
  master_volume  int NOT NULL,
  effects_volume int NOT NULL,
  reduce_effects boolean NOT NULL,
  screen_shake   boolean NOT NULL,
  camera_bob     boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS price_changes (
  id              text PRIMARY KEY,
  item            text NOT NULL,
  price           int NOT NULL,
  effective_local text NOT NULL,
  effective_at    timestamptz NOT NULL,
  created_at      timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS price_changes_item_at ON price_changes(item, effective_at);

CREATE TABLE IF NOT EXISTS series (
  id         text PRIMARY KEY,
  title      text NOT NULL,
  mode       text NOT NULL,
  weekday    text NOT NULL,
  local_time text NOT NULL,
  first_date date NOT NULL,
  weeks      int NOT NULL,
  capacity   int NOT NULL,
  seed_key   text UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS nights (
  id                    text PRIMARY KEY,
  series_id             text REFERENCES series(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  mode                  text NOT NULL,
  night_date            date NOT NULL,
  scheduled_local_time  text NOT NULL,
  capacity              int NOT NULL,
  created_at            timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS nights_date ON nights(night_date);

CREATE TABLE IF NOT EXISTS signups (
  id          text PRIMARY KEY,
  night_id    text NOT NULL REFERENCES nights(id) ON DELETE CASCADE,
  name        text NOT NULL,
  email       text NOT NULL,
  email_key   text NOT NULL,
  viewer_zone text NOT NULL,
  created_at  timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS signups_night_email ON signups(night_id, email_key);

CREATE TABLE IF NOT EXISTS outbox (
  id          text PRIMARY KEY,
  dedupe_key  text NOT NULL UNIQUE,
  kind        text NOT NULL,
  to_addr     text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  due_at      timestamptz NOT NULL,
  sent_at     timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(sent_at, due_at);

CREATE TABLE IF NOT EXISTS matches (
  id            text PRIMARY KEY,
  code          text NOT NULL,
  mode          text NOT NULL,
  result        text NOT NULL,
  waves_cleared int NOT NULL,
  night_id      text,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_ended ON matches(ended_at DESC);

CREATE TABLE IF NOT EXISTS match_players (
  match_id       text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat           int NOT NULL,
  player_id      text NOT NULL,
  callsign       text NOT NULL,
  score          int NOT NULL,
  kills          int NOT NULL,
  credits_earned int NOT NULL,
  best_lap_ms    int,
  PRIMARY KEY (match_id, seat)
);

CREATE TABLE IF NOT EXISTS laps (
  id        text PRIMARY KEY,
  match_id  text NOT NULL,
  code      text NOT NULL,
  player_id text NOT NULL,
  callsign  text NOT NULL,
  lap_no    int NOT NULL,
  lap_ms    int NOT NULL,
  set_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS laps_best ON laps(lap_ms, set_at);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id         text PRIMARY KEY,
  code       text NOT NULL,
  match_id   text,
  account    text NOT NULL,
  amount     int NOT NULL,
  kind       text NOT NULL,
  ref        text NOT NULL,
  item       text,
  unit_price int,
  at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_entries(account);
`

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, schemaSQL); err != nil {
		return err
	}
	return s.seed(ctx)
}
