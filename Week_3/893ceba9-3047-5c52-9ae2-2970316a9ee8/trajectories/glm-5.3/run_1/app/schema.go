package main

import (
	"context"
	"database/sql"
	"fmt"
)

const schemaSQL = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','reviewer')),
  access_key text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  client text NOT NULL,
  source_language text NOT NULL,
  target_languages text[] NOT NULL,
  repository text NOT NULL,
  mqm_threshold int NOT NULL,
  ai_routes jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS reviewer_scopes (
  reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (reviewer_id, project_id)
);

CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  state text NOT NULL CHECK (state IN ('open','in_review','merged','abandoned')),
  is_main boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS keys (
  id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (branch_id, id),
  UNIQUE (branch_id, name)
);

CREATE TABLE IF NOT EXISTS key_revisions (
  id bigserial PRIMARY KEY,
  key_id uuid NOT NULL,
  at timestamptz NOT NULL,
  branch text NOT NULL,
  field text NOT NULL,
  from_val text,
  to_val text,
  actor text NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  key_id uuid NOT NULL,
  language text NOT NULL,
  value text,
  status text NOT NULL CHECK (status IN ('untranslated','drafted','scored','needs_review','approved')),
  score int,
  origin text,
  issues jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (branch_id, key_id, language)
);

CREATE TABLE IF NOT EXISTS segment_history (
  id bigserial PRIMARY KEY,
  segment_id uuid NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  at timestamptz NOT NULL,
  actor text NOT NULL,
  from_status text,
  to_status text,
  value text
);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY,
  segment_id uuid NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  author text NOT NULL,
  body text NOT NULL,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS tm_entries (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_norm text NOT NULL,
  target text NOT NULL,
  target_norm text NOT NULL,
  target_language text NOT NULL,
  import_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE (target_language, source_norm, target_norm)
);

CREATE TABLE IF NOT EXISTS tm_imports (
  import_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename text NOT NULL,
  format text NOT NULL,
  size int NOT NULL,
  sha256 text NOT NULL,
  object_key text NOT NULL,
  at timestamptz NOT NULL,
  restored_at timestamptz
);

CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('import','merge')),
  label text NOT NULL,
  at timestamptz NOT NULL,
  snapshot_key text NOT NULL,
  restored_at timestamptz,
  main_version bigint NOT NULL,
  tm_version bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS source_files (
  file_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size int NOT NULL,
  sha256 text NOT NULL,
  object_key text NOT NULL,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS branch_bases (
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  key_id uuid NOT NULL,
  name text NOT NULL,
  source text NOT NULL,
  present boolean NOT NULL,
  PRIMARY KEY (branch_id, key_id)
);

CREATE TABLE IF NOT EXISTS conflicts (
  id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  key_id uuid NOT NULL,
  field text NOT NULL,
  base text,
  main text,
  branch text,
  resolution jsonb,
  held_until timestamptz,
  hold_session text,
  seen_main text,
  PRIMARY KEY (branch_id, id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch text NOT NULL,
  language text NOT NULL,
  segment_ids uuid[] NOT NULL,
  state text NOT NULL CHECK (state IN ('active','completed','expired','cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  url text NOT NULL,
  signing_secret text NOT NULL,
  svix_endpoint_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash text NOT NULL,
  status int NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS publishes (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','awaiting_host_confirmation','published','failed')),
  failure_reason text,
  languages text[] NOT NULL,
  pull_request_number int,
  pull_request_url text,
  bundles jsonb NOT NULL DEFAULT '{}',
  owner_instance text NOT NULL,
  created_at timestamptz NOT NULL,
  confirmed_at timestamptz
);

CREATE TABLE IF NOT EXISTS events (
  event_id text PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','sent')),
  attempts int NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  owner_instance text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  at timestamptz NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  project text NOT NULL,
  detail text NOT NULL
);

CREATE TABLE IF NOT EXISTS import_reports (
  import_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_segments_project_status ON segments(project_id, status);
CREATE INDEX IF NOT EXISTS idx_segments_branch ON segments(branch_id);
CREATE INDEX IF NOT EXISTS idx_keys_branch ON keys(branch_id);
CREATE INDEX IF NOT EXISTS idx_tm_project ON tm_entries(project_id, target_language, source_norm);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
`

func ApplySchema(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	return nil
}
