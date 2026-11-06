export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS company_domains (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain text NOT NULL,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, domain)
);

CREATE TABLE IF NOT EXISTS contacts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id text REFERENCES companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_workspace_email ON contacts (workspace_id, lower(email));

CREATE TABLE IF NOT EXISTS notes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  text text NOT NULL,
  source text NOT NULL,
  status text NOT NULL,
  snoozed_until timestamptz,
  received_on date,
  created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
);
CREATE INDEX IF NOT EXISTS notes_workspace_created ON notes (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL,
  status text NOT NULL,
  object_key text NOT NULL,
  pending_bytes bytea,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS attachments_pending ON attachments (status);

CREATE TABLE IF NOT EXISTS pending_object_deletions (
  id text PRIMARY KEY,
  prefix text NOT NULL,
  claimed_at timestamptz,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS components (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS objectives (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  weight integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS releases (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_date date NOT NULL,
  is_public boolean NOT NULL,
  status text NOT NULL,
  order_version integer NOT NULL DEFAULT 1,
  snapshot_version integer NOT NULL DEFAULT 0,
  frozen_at timestamptz,
  shipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS features (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  component_id text NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  parent_feature_id text REFERENCES features(id) ON DELETE CASCADE,
  name text NOT NULL,
  public_description text NOT NULL DEFAULT '',
  status text NOT NULL,
  prior_status text,
  release_id text REFERENCES releases(id) ON DELETE SET NULL,
  board_position integer NOT NULL DEFAULT 0,
  effort integer NOT NULL DEFAULT 5,
  confidence integer NOT NULL DEFAULT 50,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS features_workspace_name ON features (workspace_id, lower(name));
CREATE INDEX IF NOT EXISTS features_release ON features (release_id);

CREATE TABLE IF NOT EXISTS feature_fits (
  feature_id text NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  objective_id text NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  level integer NOT NULL,
  PRIMARY KEY (feature_id, objective_id)
);

CREATE TABLE IF NOT EXISTS score_versions (
  id text PRIMARY KEY,
  feature_id text NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  version integer NOT NULL,
  effort integer NOT NULL,
  confidence integer NOT NULL,
  fits jsonb NOT NULL,
  priority numeric(14,2) NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  saved_by text REFERENCES members(id) ON DELETE SET NULL,
  UNIQUE (feature_id, version)
);

CREATE TABLE IF NOT EXISTS insights (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  feature_id text NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  quote text NOT NULL,
  importance text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS insights_unique_span
  ON insights (note_id, feature_id, start_offset, end_offset);
CREATE INDEX IF NOT EXISTS insights_feature ON insights (feature_id);

CREATE TABLE IF NOT EXISTS share_links (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_in_seconds integer,
  expires_at timestamptz,
  revoked_at timestamptz,
  sequence bigserial
);

CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_by text REFERENCES members(id) ON DELETE SET NULL,
  email text NOT NULL,
  role text NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  replaced_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  scope text NOT NULL,
  target_id text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  release_id text REFERENCES releases(id) ON DELETE SET NULL,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  html_body text NOT NULL,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (sent_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id text REFERENCES members(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_workspace ON audit_log (workspace_id, at DESC);
`;
