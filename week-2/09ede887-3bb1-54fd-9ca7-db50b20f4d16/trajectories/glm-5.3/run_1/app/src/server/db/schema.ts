/**
 * The schema. Every start creates it idempotently; several instances starting
 * at once serialise through the advisory lock, so it is created exactly once.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stages (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  position INT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  day INT NOT NULL,
  date DATE NOT NULL,
  start_local TEXT NOT NULL,
  end_local TEXT NOT NULL,
  start_instant TIMESTAMPTZ NOT NULL,
  end_instant TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  stage_slug TEXT REFERENCES stages(slug),
  location TEXT,
  format TEXT,
  format_label TEXT,
  description TEXT NOT NULL,
  capacity INT
);

CREATE TABLE IF NOT EXISTS speakers (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS session_speakers (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  speaker_id BIGINT NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
  position INT NOT NULL,
  PRIMARY KEY (session_id, speaker_id)
);

CREATE TABLE IF NOT EXISTS reservations (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, account_id)
);

CREATE TABLE IF NOT EXISTS holds (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  held_from TIMESTAMPTZ NOT NULL,
  held_until TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  end_kind TEXT
);

CREATE TABLE IF NOT EXISTS seat_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  account_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, account_id)
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, account_id)
);

CREATE TABLE IF NOT EXISTS guesses (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  value BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contest (
  id INT PRIMARY KEY DEFAULT 1,
  final_figure BIGINT,
  revealed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS signin_failures (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  api_version TEXT NOT NULL,
  key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  response_status INT NOT NULL,
  response_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, api_version, key)
);

CREATE INDEX IF NOT EXISTS idx_reservations_session ON reservations(session_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_holds_session_live ON holds(session_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_waitlist_session ON waitlist_entries(session_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_seat_events_session ON seat_events(session_id, id);
CREATE INDEX IF NOT EXISTS idx_signin_failures_email ON signin_failures(email, at);
CREATE INDEX IF NOT EXISTS idx_sessions_instant ON sessions(start_instant, id);
CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day, start_local, id);
`;
