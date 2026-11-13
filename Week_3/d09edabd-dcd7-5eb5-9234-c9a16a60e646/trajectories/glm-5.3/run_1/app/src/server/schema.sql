-- Accounts
CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  email_lower text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_workspace_idx ON users(workspace_id);

CREATE TABLE IF NOT EXISTS props (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  width_mm integer NOT NULL,
  depth_mm integer NOT NULL,
  height_mm integer NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  starter boolean NOT NULL DEFAULT false,
  width_mm integer NOT NULL,
  depth_mm integer NOT NULL,
  height_mm integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  revision integer NOT NULL DEFAULT 0,
  has_thumbnail boolean NOT NULL DEFAULT false,
  scene_order text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_workspace_name_idx ON rooms(workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS placements (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind text NOT NULL,
  label text NOT NULL,
  prop_id text REFERENCES props(id) ON DELETE SET NULL,
  entry boolean NOT NULL DEFAULT false,
  x_mm integer NOT NULL,
  y_mm integer NOT NULL,
  z_mm integer NOT NULL,
  rotation_deg integer NOT NULL,
  width_mm integer NOT NULL,
  depth_mm integer NOT NULL,
  height_mm integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by text
);

CREATE TABLE IF NOT EXISTS trigger_nodes (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL,
  placement_id text REFERENCES placements(id) ON DELETE SET NULL,
  answer text,
  prerequisites text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nodes_room_idx ON trigger_nodes(room_id);

-- Placement deletion log (tombstones)
CREATE TABLE IF NOT EXISTS deleted_placements (
  room_id text NOT NULL,
  placement_id text NOT NULL,
  label text NOT NULL,
  deleted_by text NOT NULL,
  deleted_by_name text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, placement_id)
);

-- Change log
CREATE TABLE IF NOT EXISTS change_log (
  workspace_id text NOT NULL,
  op_id text NOT NULL,
  room_id text NOT NULL,
  revision integer NOT NULL,
  kind text NOT NULL,
  placement_id text,
  user_id text NOT NULL,
  status integer NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, op_id)
);
CREATE INDEX IF NOT EXISTS change_log_room_idx ON change_log(room_id, revision);

CREATE TABLE IF NOT EXISTS room_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id text NOT NULL,
  revision integer NOT NULL,
  op_id text,
  kind text NOT NULL,
  placement_id text,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_changes_room_idx ON room_changes(room_id, revision);

-- Undo entries (per author per room, oldest first)
CREATE TABLE IF NOT EXISTS undo_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id text NOT NULL,
  user_id text NOT NULL,
  placement_id text NOT NULL,
  label text NOT NULL,
  fields jsonb NOT NULL,
  prev_values jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS undo_idx ON undo_entries(room_id, user_id, id);

-- Playtests
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'scheduled',
  host_user_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  outcome text,
  duration_seconds integer NOT NULL,
  last_hint_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_room_idx ON sessions(room_id, created_at);

CREATE TABLE IF NOT EXISTS session_solves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  title text NOT NULL,
  elapsed_seconds integer NOT NULL,
  solved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solves_session_idx ON session_solves(session_id, id);

CREATE TABLE IF NOT EXISTS hints (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  text text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  display_name text,
  joined boolean NOT NULL DEFAULT false,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invites_session_idx ON invites(session_id);

CREATE TABLE IF NOT EXISTS emails (
  id text PRIMARY KEY,
  kind text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  session_id text,
  invite_id text,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emails_status_idx ON emails(status, next_attempt);

CREATE TABLE IF NOT EXISTS build_tokens (
  token text PRIMARY KEY,
  version_id text NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency
CREATE TABLE IF NOT EXISTS sessions_auth (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_auth_user_idx ON sessions_auth(user_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);

-- Versions
CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  number integer NOT NULL,
  label text NOT NULL,
  state text NOT NULL DEFAULT 'frozen',
  superseded_by integer,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  stats jsonb NOT NULL,
  UNIQUE (room_id, number)
);
CREATE INDEX IF NOT EXISTS versions_room_idx ON versions(room_id, number);

CREATE TABLE IF NOT EXISTS version_placements (
  version_id text NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  placement_id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (version_id, placement_id)
);

CREATE TABLE IF NOT EXISTS version_nodes (
  version_id text NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (version_id, node_id)
);

CREATE TABLE IF NOT EXISTS version_scene (
  version_id text NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  scene_order text[] NOT NULL,
  room_json jsonb NOT NULL,
  PRIMARY KEY (version_id)
);

-- Email status cached on the invite for the roster
ALTER TABLE invites ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'queued';
