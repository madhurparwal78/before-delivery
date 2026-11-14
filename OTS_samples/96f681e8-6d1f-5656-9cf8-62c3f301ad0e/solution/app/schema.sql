CREATE TABLE IF NOT EXISTS meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  username text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  level numeric(2,1),
  coach_id text UNIQUE,
  is_player boolean NOT NULL DEFAULT false
);
ALTER TABLE people ADD COLUMN IF NOT EXISTS push_topic text UNIQUE;

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  username text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS login_states (
  state text PRIMARY KEY,
  return_to text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS pricing_versions (
  version int PRIMARY KEY,
  effective_from date NOT NULL,
  offpeak_cents int NOT NULL CHECK (offpeak_cents BETWEEN 1 AND 10000),
  peak_cents int NOT NULL CHECK (peak_cents BETWEEN 1 AND 10000),
  peak_start text NOT NULL,
  peak_end text NOT NULL,
  peak_days text[] NOT NULL
);
ALTER TABLE pricing_versions ADD COLUMN IF NOT EXISTS saved_by text REFERENCES people (username);
ALTER TABLE pricing_versions ADD COLUMN IF NOT EXISTS saved_by_name text;
ALTER TABLE pricing_versions ADD COLUMN IF NOT EXISTS saved_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE TABLE IF NOT EXISTS cancellation_rules (
  version int PRIMARY KEY,
  late_fee_percent int NOT NULL CHECK (late_fee_percent BETWEEN 0 AND 100),
  description text NOT NULL
);
ALTER TABLE cancellation_rules ADD COLUMN IF NOT EXISTS saved_by text REFERENCES people (username);
ALTER TABLE cancellation_rules ADD COLUMN IF NOT EXISTS saved_by_name text;
ALTER TABLE cancellation_rules ADD COLUMN IF NOT EXISTS saved_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('booking', 'match')),
  court int NOT NULL CHECK (court BETWEEN 1 AND 7),
  start_utc timestamptz NOT NULL,
  minutes int NOT NULL,
  note text NOT NULL DEFAULT '',
  total_cents int NOT NULL CHECK (total_cents > 0),
  organiser text NOT NULL REFERENCES people (username),
  status text NOT NULL CHECK (status IN ('held', 'paid', 'released', 'checked-in', 'no-show', 'cancelled')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  settle_at timestamptz,
  pricing_version int NOT NULL,
  match_id text,
  split boolean NOT NULL DEFAULT false,
  covered_notified boolean NOT NULL DEFAULT false,
  refresh_next_at timestamptz
);
CREATE INDEX IF NOT EXISTS bookings_court_start ON bookings (court, start_utc);
CREATE INDEX IF NOT EXISTS bookings_organiser ON bookings (organiser, start_utc DESC);
CREATE INDEX IF NOT EXISTS bookings_start ON bookings (start_utc, court, id);
CREATE INDEX IF NOT EXISTS bookings_status ON bookings (status);

CREATE TABLE IF NOT EXISTS shares (
  token text PRIMARY KEY,
  owner_kind text NOT NULL CHECK (owner_kind IN ('booking', 'lesson')),
  owner_id text NOT NULL,
  position int NOT NULL,
  username text NOT NULL REFERENCES people (username),
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL CHECK (status IN ('due', 'paid', 'covered', 'void')),
  provider_id text,
  settle_next_at timestamptz,
  UNIQUE (owner_id, position)
);
CREATE INDEX IF NOT EXISTS shares_username ON shares (username);

CREATE TABLE IF NOT EXISTS guarantees (
  id bigserial PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings (id),
  sequence int NOT NULL,
  provider_id text NOT NULL,
  amount_cents int NOT NULL,
  status text NOT NULL CHECK (status IN ('authorized', 'captured', 'superseded', 'voided')),
  authorized_at timestamptz NOT NULL,
  UNIQUE (booking_id, sequence)
);
CREATE UNIQUE INDEX IF NOT EXISTS guarantees_current ON guarantees (booking_id) WHERE status = 'authorized';

CREATE TABLE IF NOT EXISTS owed_voids (
  id bigserial PRIMARY KEY,
  provider_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  done_at timestamptz,
  attempts int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS owed_voids_pending ON owed_voids (next_attempt_at) WHERE done_at IS NULL;

CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY,
  court int NOT NULL CHECK (court BETWEEN 1 AND 7),
  start_utc timestamptz NOT NULL,
  minutes int NOT NULL,
  level_min numeric(2,1) NOT NULL,
  level_max numeric(2,1) NOT NULL,
  total_cents int NOT NULL CHECK (total_cents > 0),
  creator text NOT NULL REFERENCES people (username),
  status text NOT NULL CHECK (status IN ('open', 'full', 'cancelled')),
  created_at timestamptz NOT NULL,
  cutoff_at timestamptz NOT NULL,
  pricing_version int NOT NULL,
  booking_id text
);
CREATE INDEX IF NOT EXISTS matches_court_start ON matches (court, start_utc);
CREATE INDEX IF NOT EXISTS matches_start ON matches (start_utc);

CREATE TABLE IF NOT EXISTS place_reservations (
  id bigserial PRIMARY KEY,
  match_id text NOT NULL REFERENCES matches (id),
  username text NOT NULL REFERENCES people (username),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL CHECK (status IN ('reserved', 'paid')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (match_id, username)
);

CREATE TABLE IF NOT EXISTS lessons (
  id text PRIMARY KEY,
  series_id text NOT NULL,
  coach_id text NOT NULL,
  court int NOT NULL CHECK (court BETWEEN 1 AND 7),
  start_utc timestamptz NOT NULL,
  minutes int NOT NULL,
  total_cents int NOT NULL CHECK (total_cents > 0),
  pricing_version int NOT NULL
);
CREATE INDEX IF NOT EXISTS lessons_court_start ON lessons (court, start_utc);
CREATE INDEX IF NOT EXISTS lessons_coach ON lessons (coach_id, start_utc);

CREATE TABLE IF NOT EXISTS credits (
  id bigserial PRIMARY KEY,
  username text NOT NULL REFERENCES people (username),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL CHECK (reason IN ('booking_cancelled', 'match_cancelled', 'late_capture')),
  booking_id text,
  match_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS credits_username ON credits (username, id DESC);

CREATE TABLE IF NOT EXISTS notices (
  id bigserial PRIMARY KEY,
  event text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'push')),
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- address is where a notice goes (an email address or an ntfy topic); recipient is who it is for, as the desk reads it.
ALTER TABLE notices ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS notices_due ON notices (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS notices_queue ON notices (recipient, channel, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS notices_listing ON notices (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  username text NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'done')),
  status int,
  response text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (username, route, key)
);

CREATE TABLE IF NOT EXISTS join_attempts (
  id bigserial PRIMARY KEY,
  username text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS join_attempts_recent ON join_attempts (username, attempted_at);
