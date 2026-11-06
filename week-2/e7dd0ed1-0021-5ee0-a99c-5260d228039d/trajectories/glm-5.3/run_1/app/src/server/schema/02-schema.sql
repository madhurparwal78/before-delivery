-- Farshore schema, part 2.

CREATE TABLE IF NOT EXISTS share_links (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  bucket_name text NOT NULL,
  key text NOT NULL,
  version_id text NOT NULL,
  workspace_slug text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_links_version ON share_links (version_id);

CREATE TABLE IF NOT EXISTS link_hits (
  link_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_link_hits ON link_hits (link_id, at);

CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE,
  email text NOT NULL,
  email_lower text NOT NULL,
  role text NOT NULL,
  token text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS access_keys (
  key_id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE,
  description text NOT NULL DEFAULT '',
  permission text NOT NULL,
  buckets text[],
  prefix text,
  expires_at timestamptz,
  state text NOT NULL DEFAULT 'active',
  sealed_secret text NOT NULL,
  sealed_prev_secret text,
  prev_expires_at timestamptz,
  prev_last_used_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE,
  url text NOT NULL,
  events text[] NOT NULL,
  buckets text[],
  description text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'active',
  sealed_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  bucket text NOT NULL,
  key text NOT NULL,
  version_id text NOT NULL,
  etag text NOT NULL,
  size bigint NOT NULL,
  reason text
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY,
  endpoint_id text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  workspace_slug text NOT NULL,
  sequence bigint NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_status integer,
  last_error text,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_state ON webhook_deliveries (state, next_attempt_at);

CREATE TABLE IF NOT EXISTS batches (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL,
  bucket_name text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  undo_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_items (
  batch_id text NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  key text NOT NULL,
  version_id text NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (batch_id, key)
);

CREATE TABLE IF NOT EXISTS audit_entries (
  workspace_slug text NOT NULL,
  seq bigint NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  detail text NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  PRIMARY KEY (workspace_slug, seq)
);

CREATE TABLE IF NOT EXISTS usage_rows (
  workspace_slug text NOT NULL,
  bucket_name text NOT NULL,
  unit text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  amount text NOT NULL,
  tracking_id text NOT NULL,
  billing_state text NOT NULL DEFAULT 'open',
  PRIMARY KEY (workspace_slug, bucket_name, unit, window_start)
);
CREATE INDEX IF NOT EXISTS idx_usage_posted ON usage_rows (billing_state);

CREATE TABLE IF NOT EXISTS storage_events (
  bucket_name text NOT NULL,
  at timestamptz NOT NULL,
  stored_bytes bigint NOT NULL,
  PRIMARY KEY (bucket_name, at)
);

CREATE TABLE IF NOT EXISTS quota_reservations (
  workspace_slug text NOT NULL,
  upload_id text NOT NULL,
  part_number integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL,
  PRIMARY KEY (workspace_slug, upload_id, part_number)
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id bigserial PRIMARY KEY,
  to_addr text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_state (
  id integer PRIMARY KEY DEFAULT 1,
  last_attempt_at timestamptz,
  last_error text,
  last_attempt_ok boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS kb_accounts (
  workspace_slug text PRIMARY KEY,
  account_id text,
  account_created boolean NOT NULL DEFAULT false,
  subscription_id text
);

CREATE TABLE IF NOT EXISTS alerts_sent (
  workspace_slug text NOT NULL,
  metric text NOT NULL,
  threshold integer NOT NULL,
  period text NOT NULL,
  PRIMARY KEY (workspace_slug, metric, threshold, period)
);

CREATE TABLE IF NOT EXISTS workers_state (
  name text PRIMARY KEY,
  running boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_heads (
  workspace_slug text PRIMARY KEY,
  last_seq bigint NOT NULL DEFAULT 0,
  last_hash text NOT NULL
);
