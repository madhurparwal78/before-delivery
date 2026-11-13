import type { DbClient } from './db';

// Applied idempotently on every serve.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_folded text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS last_opened (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email_folded text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor','viewer')),
  token text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  reason text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invites_one_pending ON invites (workspace_id, email_folded)
  WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scenes (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','checkpointed','published','unpublished')),
  revision int NOT NULL DEFAULT 1,
  latest_restore_revision int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scene_revisions (
  scene_id text NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  revision int NOT NULL,
  document text NOT NULL,
  ops jsonb NOT NULL,
  change_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scene_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS scene_revisions_change_id ON scene_revisions (scene_id, change_id)
  WHERE change_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS scene_change_results (
  scene_id text NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  change_id text NOT NULL,
  response jsonb NOT NULL,
  body_sha text NOT NULL,
  PRIMARY KEY (scene_id, change_id)
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id text PRIMARY KEY,
  scene_id text NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  label text NOT NULL,
  label_folded text NOT NULL,
  revision int NOT NULL,
  state_hash text NOT NULL,
  document_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id, label_folded)
);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('glb','gltf','png','jpeg')),
  bytes int NOT NULL,
  sha256 text NOT NULL,
  unit text,
  scale_to_metres double precision,
  extent_metres double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, sha256)
);
CREATE TABLE IF NOT EXISTS activity_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  at timestamptz NOT NULL,
  actor_user_id text NOT NULL,
  actor_name text NOT NULL,
  action text NOT NULL,
  target_name text NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_order ON activity_events (workspace_id, at DESC, id DESC);
CREATE TABLE IF NOT EXISTS share_links (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS labs (
  scene_id text NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  bundle_hash text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  checkpoint_id text NOT NULL,
  exposed jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','dead')),
  PRIMARY KEY (scene_id, token)
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id text PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL,
  ref_id text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_outbox_sent ON mail_outbox (id) WHERE sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox (seq) WHERE sent_at IS NULL;
`;

export async function applySchema(client: DbClient): Promise<void> {
  await client.query(SCHEMA);
}
