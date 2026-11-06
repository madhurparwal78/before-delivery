export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('attendee', 'organiser')),
  created_at    timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())
);

CREATE TABLE IF NOT EXISTS tokens (
  token      text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())
);

CREATE TABLE IF NOT EXISTS stages (
  slug        text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL,
  position    integer NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            text PRIMARY KEY,
  day           integer NOT NULL CHECK (day IN (1, 2)),
  date          date NOT NULL,
  start_local   text NOT NULL,
  end_local     text NOT NULL,
  start_instant timestamptz NOT NULL,
  end_instant   timestamptz NOT NULL,
  title         text NOT NULL,
  stage         text REFERENCES stages (slug),
  location      text,
  format        text,
  description   text NOT NULL,
  capacity      integer CHECK (capacity IS NULL OR (capacity >= 1 AND capacity <= 500))
);

CREATE TABLE IF NOT EXISTS speakers (
  slug     text PRIMARY KEY,
  name     text NOT NULL,
  company  text NOT NULL,
  bio      text NOT NULL DEFAULT '',
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS session_speakers (
  session_id   text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  speaker_slug text NOT NULL REFERENCES speakers (slug) ON DELETE CASCADE,
  position     integer NOT NULL,
  PRIMARY KEY (session_id, speaker_slug)
);

CREATE TABLE IF NOT EXISTS reservations (
  id         bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  UNIQUE (session_id, account_id)
);
CREATE INDEX IF NOT EXISTS reservations_roster ON reservations (session_id, created_at, id);

CREATE TABLE IF NOT EXISTS holds (
  id         bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  held_from  timestamptz NOT NULL,
  held_until timestamptz NOT NULL,
  settled_as text CHECK (settled_as IS NULL OR settled_as IN ('claimed', 'expired', 'surrendered')),
  settled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_open_per_account_session
  ON holds (session_id, account_id) WHERE settled_as IS NULL;
CREATE INDEX IF NOT EXISTS holds_open_by_session ON holds (session_id) WHERE settled_as IS NULL;

CREATE TABLE IF NOT EXISTS seat_events (
  id         bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('promoted', 'claimed', 'expired', 'surrendered')),
  at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS seat_events_by_session ON seat_events (session_id, id);

CREATE TABLE IF NOT EXISTS saved_sessions (
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  PRIMARY KEY (account_id, session_id)
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id         bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  UNIQUE (session_id, account_id)
);
CREATE INDEX IF NOT EXISTS waitlist_order ON waitlist_entries (session_id, created_at, id);

CREATE TABLE IF NOT EXISTS guesses (
  id         bigserial PRIMARY KEY,
  account_id bigint NOT NULL UNIQUE REFERENCES accounts (id) ON DELETE CASCADE,
  value      bigint NOT NULL CHECK (value >= 1 AND value <= 100000000),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS contest (
  id           integer PRIMARY KEY CHECK (id = 1),
  final_figure bigint,
  revealed_at  timestamptz
);

CREATE TABLE IF NOT EXISTS signin_failures (
  id      bigserial PRIMARY KEY,
  email   text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now())
);
CREATE INDEX IF NOT EXISTS signin_failures_by_email ON signin_failures (email, failed_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id    bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  key           text NOT NULL,
  api_version   text NOT NULL CHECK (api_version IN ('v1', 'v2')),
  session_id    text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  status        integer,
  body          text,
  first_used_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  PRIMARY KEY (account_id, key)
);
`;
