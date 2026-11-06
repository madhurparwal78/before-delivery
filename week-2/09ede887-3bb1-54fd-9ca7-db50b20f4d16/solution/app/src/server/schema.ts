// The PostgreSQL schema. Every statement is idempotent; boot runs it under an advisory lock.

export const schemaSql = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('attendee', 'organiser')),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS signin_failures (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS signin_failures_by_email ON signin_failures (email, failed_at);

CREATE TABLE IF NOT EXISTS stages (
  slug text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  position integer NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  day integer NOT NULL CHECK (day IN (1, 2)),
  date date NOT NULL,
  start_local text NOT NULL,
  end_local text NOT NULL,
  start_instant timestamptz NOT NULL,
  end_instant timestamptz NOT NULL CHECK (end_instant >= start_instant),
  title text NOT NULL,
  stage text REFERENCES stages (slug),
  location text,
  format text,
  description text NOT NULL,
  capacity integer CHECK (capacity BETWEEN 1 AND 500)
);

CREATE TABLE IF NOT EXISTS speakers (
  slug text PRIMARY KEY,
  name text NOT NULL,
  company text NOT NULL,
  bio text NOT NULL DEFAULT '',
  position integer NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS session_speakers (
  session_id text NOT NULL REFERENCES sessions (id),
  speaker_slug text NOT NULL REFERENCES speakers (slug),
  position integer NOT NULL,
  PRIMARY KEY (session_id, speaker_slug)
);

CREATE TABLE IF NOT EXISTS reservations (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  session_id text NOT NULL REFERENCES sessions (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, session_id)
);
CREATE INDEX IF NOT EXISTS reservations_roster ON reservations (session_id, created_at, id);

CREATE TABLE IF NOT EXISTS holds (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id),
  account_id uuid NOT NULL REFERENCES accounts (id),
  held_from timestamptz NOT NULL,
  held_until timestamptz NOT NULL CHECK (held_until > held_from),
  UNIQUE (account_id, session_id)
);
CREATE INDEX IF NOT EXISTS holds_by_end ON holds (held_until);

CREATE TABLE IF NOT EXISTS seat_events (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id),
  account_id uuid NOT NULL REFERENCES accounts (id),
  kind text NOT NULL CHECK (kind IN ('promoted', 'claimed', 'expired', 'surrendered')),
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS seat_events_by_owner ON seat_events (account_id, session_id, id);

CREATE TABLE IF NOT EXISTS saved_sessions (
  account_id uuid NOT NULL REFERENCES accounts (id),
  session_id text NOT NULL REFERENCES sessions (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, session_id)
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  session_id text NOT NULL REFERENCES sessions (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, session_id)
);
CREATE INDEX IF NOT EXISTS waitlist_queue ON waitlist_entries (session_id, created_at, id);

CREATE TABLE IF NOT EXISTS contest (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  final_figure integer CHECK (final_figure BETWEEN 1 AND 100000000),
  revealed_at timestamptz,
  CHECK ((final_figure IS NULL) = (revealed_at IS NULL))
);

CREATE TABLE IF NOT EXISTS guesses (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES accounts (id),
  value integer NOT NULL CHECK (value BETWEEN 1 AND 100000000),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id uuid NOT NULL REFERENCES accounts (id),
  key text NOT NULL,
  version text NOT NULL,
  session_id text NOT NULL REFERENCES sessions (id),
  response_body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, key)
);

-- ISO-8601 UTC with a Z suffix; whole seconds print without a fraction.
CREATE OR REPLACE FUNCTION iso(t timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
         || CASE WHEN date_trunc('second', t) = t THEN '' ELSE to_char(t AT TIME ZONE 'UTC', '.US') END
         || 'Z'
$fn$;

-- A hold is live while the database clock is before held_until.
CREATE OR REPLACE VIEW live_holds AS
  SELECT * FROM holds WHERE held_until > clock_timestamp();

-- Seats are counted from stored rows on every read; nothing keeps a counter.
CREATE OR REPLACE VIEW session_seats AS
  SELECT s.id AS session_id,
         s.capacity,
         r.reserved,
         h.held,
         s.capacity - r.reserved - h.held AS seats_left,
         w.waitlisted
  FROM sessions s
  CROSS JOIN LATERAL (SELECT count(*)::int AS reserved FROM reservations WHERE session_id = s.id) r
  CROSS JOIN LATERAL (SELECT count(*)::int AS held FROM live_holds WHERE session_id = s.id) h
  CROSS JOIN LATERAL (SELECT count(*)::int AS waitlisted FROM waitlist_entries WHERE session_id = s.id) w;
`;
