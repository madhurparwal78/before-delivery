-- Keelson schema. Idempotent: CREATE TABLE IF NOT EXISTS everywhere.

CREATE TABLE IF NOT EXISTS people (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  person_email TEXT NOT NULL REFERENCES people(email),
  project_slug TEXT NOT NULL REFERENCES projects(slug),
  role TEXT NOT NULL,
  PRIMARY KEY (person_email, project_slug)
);

CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL REFERENCES projects(slug),
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  agent_token TEXT NOT NULL UNIQUE,
  UNIQUE (project_slug, name)
);

CREATE TABLE IF NOT EXISTS sync_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  days TEXT[] NOT NULL,
  "start" TEXT NOT NULL,
  "end" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_slug TEXT NOT NULL REFERENCES projects(slug),
  name TEXT NOT NULL,
  cluster_id TEXT NOT NULL REFERENCES clusters(id),
  upstream_id UUID REFERENCES stages(id),
  pipeline_position INT NOT NULL,
  requires_approval BOOLEAN NOT NULL,
  defaults JSONB NOT NULL,
  UNIQUE (project_slug, name)
);

CREATE TABLE IF NOT EXISTS freeze_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_slug TEXT NOT NULL REFERENCES projects(slug),
  version INT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  freezes JSONB NOT NULL,
  UNIQUE (project_slug, version)
);

CREATE TABLE IF NOT EXISTS bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_slug TEXT NOT NULL REFERENCES projects(slug),
  version TEXT NOT NULL,
  digest TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  resources JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingested_by TEXT NOT NULL,
  UNIQUE (project_slug, version),
  UNIQUE (project_slug, digest)
);

CREATE TABLE IF NOT EXISTS bundle_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL UNIQUE REFERENCES bundles(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_slug TEXT NOT NULL REFERENCES projects(slug),
  stage_id UUID NOT NULL REFERENCES stages(id),
  cluster_id TEXT NOT NULL REFERENCES clusters(id),
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  bundle_id UUID NOT NULL REFERENCES bundles(id),
  overrides JSONB NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  policy_version INT NOT NULL,
  approval_state TEXT NOT NULL DEFAULT 'pending',
  request_expires_at TIMESTAMPTZ,
  approval_decided_by TEXT,
  approval_decided_at TIMESTAMPTZ,
  approval_expires_at TIMESTAMPTZ,
  approval_comment TEXT,
  window_decision JSONB,
  freeze_break JSONB,
  restores UUID,
  failed_progress NUMERIC,
  roll_counter INT NOT NULL DEFAULT 0,
  last_progress NUMERIC NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS promotions_stage_idx ON promotions (stage_id);
CREATE INDEX IF NOT EXISTS promotions_requested_idx ON promotions (project_slug, requested_at DESC);

-- Exactly one active promotion per stage, enforced by Postgres across instances.
CREATE TABLE IF NOT EXISTS stage_locks (
  stage_id UUID PRIMARY KEY REFERENCES stages(id),
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only promotion history.
CREATE TABLE IF NOT EXISTS promotion_history (
  seq BIGSERIAL PRIMARY KEY,
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS promotion_history_idx ON promotion_history (promotion_id, seq);

CREATE TABLE IF NOT EXISTS health_rows (
  id BIGSERIAL PRIMARY KEY,
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  ref TEXT NOT NULL,
  sync TEXT NOT NULL,
  health TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, ref)
);

CREATE TABLE IF NOT EXISTS health_timeline (
  seq BIGSERIAL PRIMARY KEY,
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  phase TEXT NOT NULL,
  in_sync INT NOT NULL,
  total INT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_email TEXT NOT NULL REFERENCES people(email),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_keys (
  id BIGSERIAL PRIMARY KEY,
  person_email TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INT,
  response_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (person_email, method, path, key)
);

-- Queued object-storage uploads (evidence snapshots and seeded bundle objects).
CREATE TABLE IF NOT EXISTS evidence_uploads (
  id BIGSERIAL PRIMARY KEY,
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  project_slug TEXT NOT NULL,
  snapshot_number INT NOT NULL,
  object_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  UNIQUE (promotion_id, snapshot_number)
);

-- Queued mail notices.
CREATE TABLE IF NOT EXISTS notice_queue (
  id BIGSERIAL PRIMARY KEY,
  promotion_id UUID,
  project_slug TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS approval_links (
  token TEXT PRIMARY KEY,
  promotion_id UUID NOT NULL REFERENCES promotions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeded promotion order marker so seeding stays idempotent.
CREATE TABLE IF NOT EXISTS seed_markers (
  key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
