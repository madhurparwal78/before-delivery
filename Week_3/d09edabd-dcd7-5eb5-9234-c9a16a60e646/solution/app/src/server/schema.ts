/** The whole schema, applied idempotently every time the app serves. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  email text NOT NULL, password_hash text NOT NULL, display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','co_designer')), created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS logins (
  id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL, starter boolean NOT NULL DEFAULT false,
  width_mm integer NOT NULL, depth_mm integer NOT NULL, height_mm integer NOT NULL,
  version integer NOT NULL DEFAULT 1, revision integer NOT NULL DEFAULT 0,
  scene_order jsonb NOT NULL DEFAULT '[]', thumbnail_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS rooms_name_key ON rooms (workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS props (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), name text NOT NULL,
  width_mm integer NOT NULL, depth_mm integer NOT NULL, height_mm integer NOT NULL,
  content_type text NOT NULL, bytes integer NOT NULL, sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp());

CREATE TABLE IF NOT EXISTS placements (
  id uuid PRIMARY KEY, room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, seq bigserial,
  kind text NOT NULL, label text NOT NULL, prop_id uuid, entry boolean NOT NULL DEFAULT false,
  x_mm integer NOT NULL, y_mm integer NOT NULL, z_mm integer NOT NULL, rotation_deg integer NOT NULL,
  width_mm integer NOT NULL, depth_mm integer NOT NULL, height_mm integer NOT NULL,
  version integer NOT NULL DEFAULT 1, deleted_at timestamptz, deleted_by uuid REFERENCES users(id));
CREATE INDEX IF NOT EXISTS placements_room_idx ON placements (room_id, seq);

CREATE TABLE IF NOT EXISTS nodes (
  id uuid PRIMARY KEY, room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, seq bigserial,
  title text NOT NULL, kind text NOT NULL, placement_id uuid, answer text,
  prerequisites uuid[] NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS nodes_room_idx ON nodes (room_id, seq);

CREATE TABLE IF NOT EXISTS changes (
  id bigserial PRIMARY KEY, room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id), revision integer NOT NULL,
  op_id text, scope text, kind text NOT NULL, placement_id uuid,
  user_id uuid REFERENCES users(id), status integer, response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (room_id, revision));
CREATE UNIQUE INDEX IF NOT EXISTS changes_op_key ON changes (workspace_id, op_id) WHERE op_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS undo_entries (
  id bigserial PRIMARY KEY, room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id), placement_id uuid NOT NULL, field text NOT NULL, before jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS undo_entries_idx ON undo_entries (room_id, user_id, id);

CREATE TABLE IF NOT EXISTS versions (
  id uuid PRIMARY KEY, room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  number integer NOT NULL, label text NOT NULL, state text NOT NULL, superseded_by integer,
  frozen_at timestamptz NOT NULL DEFAULT now(), stats jsonb NOT NULL, content jsonb NOT NULL,
  pack_token text UNIQUE, UNIQUE (room_id, number));

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id uuid NOT NULL REFERENCES workspaces(id), key text NOT NULL, fingerprint text NOT NULL,
  status integer NOT NULL, response jsonb NOT NULL, PRIMARY KEY (workspace_id, key));

CREATE TABLE IF NOT EXISTS playtests (
  id uuid PRIMARY KEY, room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id), kind text NOT NULL, state text NOT NULL,
  host_user_id uuid NOT NULL REFERENCES users(id), starts_at timestamptz NOT NULL,
  started_at timestamptz, ended_at timestamptz, outcome text, duration_seconds integer NOT NULL,
  hints_used integer NOT NULL DEFAULT 0, last_hint_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE UNIQUE INDEX IF NOT EXISTS playtests_one_active ON playtests (room_id) WHERE state IN ('lobby','running');

CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY, playtest_id uuid NOT NULL REFERENCES playtests(id) ON DELETE CASCADE,
  email text NOT NULL, token text NOT NULL UNIQUE, display_name text, joined boolean NOT NULL DEFAULT false,
  revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE UNIQUE INDEX IF NOT EXISTS invites_email_key ON invites (playtest_id, lower(email)) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS solves (
  id bigserial PRIMARY KEY, playtest_id uuid NOT NULL REFERENCES playtests(id) ON DELETE CASCADE,
  node_id uuid NOT NULL, elapsed_seconds integer NOT NULL, solved_by text, UNIQUE (playtest_id, node_id));

CREATE TABLE IF NOT EXISTS hints (
  id bigserial PRIMARY KEY, playtest_id uuid NOT NULL REFERENCES playtests(id) ON DELETE CASCADE,
  text text NOT NULL, sent_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY, kind text NOT NULL, playtest_id uuid NOT NULL REFERENCES playtests(id) ON DELETE CASCADE,
  invite_id uuid REFERENCES invites(id) ON DELETE CASCADE, to_email text NOT NULL, subject text NOT NULL, body text NOT NULL,
  status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox (status, next_attempt_at);
`;
