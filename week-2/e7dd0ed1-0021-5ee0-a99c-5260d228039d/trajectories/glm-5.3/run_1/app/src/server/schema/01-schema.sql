-- Farshore schema, part 1. Applied idempotently on every serve.

CREATE TABLE IF NOT EXISTS schema_meta (k text PRIMARY KEY, v text NOT NULL);

CREATE TABLE IF NOT EXISTS regions (
  id text PRIMARY KEY,
  name text NOT NULL,
  continent text NOT NULL,
  lon double precision NOT NULL,
  lat double precision NOT NULL,
  state text NOT NULL DEFAULT 'online'
);

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price text NOT NULL,
  included_storage_bytes bigint NOT NULL,
  included_egress_bytes bigint NOT NULL,
  storage_overage text NOT NULL,
  egress_overage text NOT NULL,
  request_units text NOT NULL,
  kb_plan_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_lower text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  operator boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  slug text PRIMARY KEY,
  name text NOT NULL,
  plan text NOT NULL REFERENCES plans(id),
  status text NOT NULL DEFAULT 'active',
  suspended_reason text,
  suspended_at timestamptz,
  key_generation integer NOT NULL DEFAULT 1,
  key_rotated_at timestamptz,
  rotation_running boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  workspace_slug text NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (workspace_slug, user_id)
);

CREATE TABLE IF NOT EXISTS signin_failures (
  id bigserial PRIMARY KEY,
  email_lower text NOT NULL,
  kind text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signin_failures_email ON signin_failures (email_lower, at);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'active',
  device text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  pending_expires_at timestamptz,
  confirmed_until timestamptz,
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS two_step (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sealed_secret text,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  last_accepted_step bigint NOT NULL DEFAULT -1,
  setup_at timestamptz
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  hash text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, idx)
);

CREATE TABLE IF NOT EXISTS buckets (
  name text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE,
  placement text[] NOT NULL,
  object_count integer NOT NULL DEFAULT 0,
  stored_bytes bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lifecycle (
  bucket_name text PRIMARY KEY REFERENCES buckets(name) ON DELETE CASCADE,
  noncurrent_days integer,
  keep_newest_noncurrent integer NOT NULL DEFAULT 0,
  abort_multipart_days integer,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS versions (
  version_id text PRIMARY KEY,
  bucket_name text NOT NULL REFERENCES buckets(name) ON DELETE CASCADE,
  key text NOT NULL,
  etag text NOT NULL,
  size bigint NOT NULL,
  content_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  tags jsonb NOT NULL DEFAULT '{}',
  checksum_algo text,
  checksum_value text,
  state text NOT NULL DEFAULT 'current',
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  noncurrent_since timestamptz,
  retain_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  expired_at timestamptz,
  wrapped_key text NOT NULL,
  key_generation integer NOT NULL,
  part_count integer,
  part_sizes bigint[],
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_versions_bucket_key ON versions (bucket_name, key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_current ON versions (bucket_name, key, version_id) WHERE state = 'current';
CREATE INDEX IF NOT EXISTS idx_versions_noncurrent ON versions (bucket_name, key, state) WHERE state = 'noncurrent';

CREATE TABLE IF NOT EXISTS replicas (
  version_id text NOT NULL REFERENCES versions(version_id) ON DELETE CASCADE,
  region text NOT NULL,
  position integer NOT NULL,
  role text NOT NULL,
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  settled_at timestamptz,
  settle_ms integer,
  error text,
  PRIMARY KEY (version_id, region)
);
CREATE INDEX IF NOT EXISTS idx_replicas_state ON replicas (region, state);

CREATE TABLE IF NOT EXISTS multipart_uploads (
  upload_id text PRIMARY KEY,
  bucket_name text NOT NULL REFERENCES buckets(name) ON DELETE CASCADE,
  key text NOT NULL,
  checksum_algo text,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  wrapped_key text NOT NULL,
  key_generation integer NOT NULL,
  complete_result jsonb
);
CREATE INDEX IF NOT EXISTS idx_uploads_bucket_key ON multipart_uploads (bucket_name, key);

CREATE TABLE IF NOT EXISTS upload_parts (
  upload_id text NOT NULL REFERENCES multipart_uploads(upload_id) ON DELETE CASCADE,
  part_number integer NOT NULL,
  etag text NOT NULL,
  size bigint NOT NULL,
  checksum_value text,
  PRIMARY KEY (upload_id, part_number)
);

CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  workspace_slug text NOT NULL,
  endpoint text NOT NULL,
  bucket_name text NOT NULL,
  obj_key text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_slug, key)
);
