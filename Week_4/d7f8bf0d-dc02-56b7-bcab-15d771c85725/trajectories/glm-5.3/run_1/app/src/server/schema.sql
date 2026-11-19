-- Schema is applied idempotently on every serve; safe with concurrent instances.

CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  walkthrough_done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS standards (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  profile jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions_auth (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  workspace_scope text,
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS layouts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  working_hash text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS layout_history (
  id text PRIMARY KEY,
  layout_id text NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
  actor text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  object_id text,
  from_value text,
  to_value text
);
CREATE INDEX IF NOT EXISTS layout_history_layout_idx ON layout_history (layout_id, at DESC);

CREATE TABLE IF NOT EXISTS layout_versions (
  id text PRIMARY KEY,
  layout_id text NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
  number integer NOT NULL,
  state text NOT NULL,
  label text NOT NULL,
  canonical_hash text NOT NULL,
  content jsonb NOT NULL,
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  restored_from text,
  revision bigint NOT NULL DEFAULT 1,
  timetable_version integer NOT NULL DEFAULT 1,
  UNIQUE (layout_id, number)
);

CREATE TABLE IF NOT EXISTS run_sessions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL,
  hold_reason text,
  ratio integer NOT NULL DEFAULT 6,
  revision bigint NOT NULL DEFAULT 0,
  control_revision bigint NOT NULL DEFAULT 0,
  session_version bigint NOT NULL DEFAULT 1,
  tick bigint NOT NULL DEFAULT 0,
  fast_clock_seconds bigint NOT NULL DEFAULT 0,
  layout_version_id text NOT NULL,
  layout_version_number integer NOT NULL,
  timetable_version integer NOT NULL,
  state jsonb NOT NULL,
  last_tick_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_ticks (
  session_id text NOT NULL,
  tick bigint NOT NULL,
  revision bigint NOT NULL,
  positions jsonb NOT NULL,
  counters jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, tick)
);

CREATE TABLE IF NOT EXISTS event_outbox (
  stream text NOT NULL,
  seq bigint NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  PRIMARY KEY (stream, seq)
);
CREATE INDEX IF NOT EXISTS event_outbox_unpublished_idx ON event_outbox (published_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS crew_packets (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  state text NOT NULL,
  session_version bigint NOT NULL,
  content_hash text,
  failure text,
  issued_by text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  byte_length integer,
  pdf_bytes bytea
);
CREATE INDEX IF NOT EXISTS crew_packets_session_idx ON crew_packets (session_id);

CREATE TABLE IF NOT EXISTS idempotency (
  workspace_id text NOT NULL,
  user_id text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response_body jsonb,
  state text,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, key)
);
