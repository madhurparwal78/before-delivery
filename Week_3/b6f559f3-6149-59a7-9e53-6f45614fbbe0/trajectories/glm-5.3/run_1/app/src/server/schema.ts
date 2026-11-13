// Schema, applied idempotently at start.
import type { Pool } from 'pg';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL,
  trashed_at TIMESTAMPTZ,
  purge_at TIMESTAMPTZ,
  import_original_key TEXT
);
CREATE TABLE IF NOT EXISTS members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (project_id, person_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0,
  doc JSONB NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]',
  presets JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (project_id, id)
);
CREATE TABLE IF NOT EXISTS versions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  published_by TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bundle BYTEA NOT NULL,
  doc JSONB NOT NULL,
  PRIMARY KEY (project_id, number)
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  content_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  vertices INTEGER,
  clips JSONB,
  parsed JSONB
);
CREATE TABLE IF NOT EXISTS locks (
  project_id TEXT NOT NULL,
  layer_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, layer_id)
);
CREATE TABLE IF NOT EXISTS op_history (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  changes JSONB NOT NULL,
  inverse JSONB,
  undone BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (project_id, person_id, op_id)
);
CREATE TABLE IF NOT EXISTS redo_stack (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id BIGSERIAL PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  UNIQUE (id, status)
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
CREATE TABLE IF NOT EXISTS publish_notices (
  project_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  person_id TEXT NOT NULL,
  outbox_id BIGINT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (project_id, number, person_id)
);
CREATE TABLE IF NOT EXISTS invite_notices (
  invite_id TEXT NOT NULL,
  outbox_id BIGINT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (invite_id)
);
`;

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
