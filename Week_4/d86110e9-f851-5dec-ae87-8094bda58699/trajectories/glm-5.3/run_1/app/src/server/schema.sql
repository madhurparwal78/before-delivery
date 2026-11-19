CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  clock_offset_seconds bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  user_id text NOT NULL REFERENCES users(id),
  workspace_id text NOT NULL REFERENCES workspaces(id),
  role text NOT NULL,
  joined_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  email text NOT NULL,
  role text NOT NULL,
  token text NOT NULL UNIQUE,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS confirm_tokens (
  user_id text PRIMARY KEY REFERENCES users(id),
  token text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS automations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  trigger_kind text NOT NULL,
  live_version int,
  draft_revision bigint NOT NULL DEFAULT 1,
  next_fire_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS automation_versions (
  automation_id text NOT NULL REFERENCES automations(id),
  version int NOT NULL,
  revision bigint NOT NULL,
  published_at timestamptz NOT NULL,
  content jsonb NOT NULL,
  PRIMARY KEY (automation_id, version)
);
CREATE TABLE IF NOT EXISTS steps (
  automation_id text NOT NULL REFERENCES automations(id),
  version int,
  id text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  col int NOT NULL,
  row int NOT NULL,
  fields jsonb NOT NULL,
  sample jsonb,
  seq int NOT NULL,
  PRIMARY KEY (automation_id, version, id)
);
CREATE TABLE IF NOT EXISTS edges (
  automation_id text NOT NULL REFERENCES automations(id),
  version int,
  id text NOT NULL,
  from_step text NOT NULL,
  port text NOT NULL,
  to_step text NOT NULL,
  ord int NOT NULL,
  PRIMARY KEY (automation_id, version, id)
);
CREATE TABLE IF NOT EXISTS step_counters (
  automation_id text NOT NULL,
  kind text NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (automation_id, kind)
);
CREATE TABLE IF NOT EXISTS tables_ (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  columns jsonb NOT NULL,
  seq bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS table_rows (
  table_id text NOT NULL REFERENCES tables_(id),
  row_id text NOT NULL,
  seq bigint NOT NULL,
  values jsonb NOT NULL,
  PRIMARY KEY (table_id, row_id)
);
CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  automation_id text NOT NULL,
  number int NOT NULL,
  status text NOT NULL,
  test boolean NOT NULL DEFAULT false,
  version int,
  replay_of text,
  owner_port int NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  trigger_output jsonb,
  message text,
  UNIQUE (automation_id, number)
);
CREATE INDEX IF NOT EXISTS runs_ws_status_idx ON runs (workspace_id, id);
CREATE TABLE IF NOT EXISTS run_steps (
  run_id text NOT NULL,
  step_id text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  col int NOT NULL,
  row int NOT NULL,
  status text NOT NULL,
  reused boolean NOT NULL DEFAULT false,
  input jsonb,
  output jsonb,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempts int NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  due_at timestamptz,
  retry_at timestamptz,
  ord int NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, step_id)
);
CREATE TABLE IF NOT EXISTS timers (
  id bigserial PRIMARY KEY,
  workspace_id text NOT NULL,
  run_id text,
  step_id text,
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  fired boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_port int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timers_due_idx ON timers (fired, owner_port, due_at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text NOT NULL,
  hook_path text NOT NULL,
  key text NOT NULL,
  run_id text NOT NULL,
  body_sha text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, hook_path, key)
);
CREATE TABLE IF NOT EXISTS edit_holds (
  automation_id text NOT NULL,
  step_id text NOT NULL,
  holder text NOT NULL,
  held_until timestamptz NOT NULL,
  PRIMARY KEY (automation_id, step_id)
);

CREATE TABLE IF NOT EXISTS clock_state (
  key text PRIMARY KEY,
  value text NOT NULL
);
