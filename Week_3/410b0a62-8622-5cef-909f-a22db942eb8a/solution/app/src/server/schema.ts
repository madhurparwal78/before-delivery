export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('athlete', 'coach')),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  tz text NOT NULL,
  coach_code text UNIQUE,
  series_start date,
  start_ctl double precision NOT NULL DEFAULT 0,
  start_atl double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sign_in_links (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS links (
  id text PRIMARY KEY,
  coach_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  athlete_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('requested', 'accepted', 'declined', 'removed', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS links_one_open_per_pair ON links (coach_id, athlete_id)
  WHERE status IN ('requested', 'accepted');

CREATE TABLE IF NOT EXISTS thresholds (
  athlete_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ftp', 'pace')),
  effective_from date NOT NULL,
  value integer NOT NULL,
  PRIMARY KEY (athlete_id, kind, effective_from)
);

CREATE TABLE IF NOT EXISTS library_items (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  sport text NOT NULL,
  steps jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  weeks integer NOT NULL,
  entries jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workouts (
  id text PRIMARY KEY,
  seq bigserial,
  athlete_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('planned', 'completed')),
  sport text NOT NULL CHECK (sport IN ('bike', 'run')),
  title text NOT NULL,
  date date NOT NULL,
  start_local text,
  start_utc timestamptz,
  duration_s integer NOT NULL,
  steps jsonb,
  planned_tss double precision,
  planned_if double precision,
  tss double precision,
  intensity double precision,
  measure double precision,
  source text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  file_name text,
  file_size integer,
  file_sha256 text,
  file_content_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workouts_athlete_date ON workouts (athlete_id, date);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  seq bigserial,
  workout_id text NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS athlete_events (
  id text PRIMARY KEY,
  athlete_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  date date NOT NULL
);

CREATE TABLE IF NOT EXISTS series_days (
  athlete_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  tss double precision NOT NULL,
  ctl double precision NOT NULL,
  atl double precision NOT NULL,
  tsb double precision NOT NULL,
  PRIMARY KEY (athlete_id, date)
);

CREATE TABLE IF NOT EXISTS seed_keys (
  key text PRIMARY KEY,
  id text NOT NULL
);
`;
