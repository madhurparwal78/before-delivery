-- Evidence Desk core schema. The schema is applied without duplication on
-- every start (see db.ts).

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('head_of_product','product_manager','customer_success')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('head_of_product','product_manager','customer_success')),
  token TEXT NOT NULL UNIQUE,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companies_workspace_idx ON companies (workspace_id);

CREATE TABLE IF NOT EXISTS company_domains (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  PRIMARY KEY (workspace_id, domain)
);
CREATE INDEX IF NOT EXISTS company_domains_company_idx ON company_domains (company_id);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('support_ticket','sales_call','email','csv_import')),
  status TEXT NOT NULL CHECK (status IN ('unprocessed','snoozed','processed')),
  snoozed_until TIMESTAMPTZ,
  received_on DATE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notes_inbox_idx
  ON notes (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS notes_workspace_idx ON notes (workspace_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available','pending')),
  storage_key TEXT NOT NULL,
  pending_bytes BYTEA,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_note_idx ON attachments (note_id);
CREATE INDEX IF NOT EXISTS attachments_pending_idx ON attachments (status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS pending_object_deletions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pending_deletions_open_idx
  ON pending_object_deletions (done) WHERE done = FALSE;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_workspace_idx ON products (workspace_id);

CREATE TABLE IF NOT EXISTS components (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS components_product_idx ON components (product_id);

CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  parent_feature_id TEXT REFERENCES features(id),
  name TEXT NOT NULL,
  public_description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('candidate','planned','in_progress','released','archived')),
  status_before_archive TEXT,
  release_id TEXT,
  release_position INTEGER NOT NULL DEFAULT 0,
  effort INTEGER NOT NULL DEFAULT 5,
  confidence INTEGER NOT NULL DEFAULT 50,
  fits JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS features_unique_name_idx
  ON features (workspace_id, lower(name));
CREATE INDEX IF NOT EXISTS features_workspace_idx ON features (workspace_id);
CREATE INDEX IF NOT EXISTS features_component_idx ON features (component_id);

CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK (weight BETWEEN 0 AND 100),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS objectives_workspace_idx ON objectives (workspace_id);

CREATE TABLE IF NOT EXISTS score_versions (
  feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  effort INTEGER NOT NULL,
  confidence INTEGER NOT NULL,
  fits JSONB NOT NULL,
  priority NUMERIC(12,2) NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  saved_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  PRIMARY KEY (feature_id, version)
);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  quote TEXT NOT NULL,
  importance TEXT NOT NULL CHECK (importance IN ('nice_to_have','important','critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (note_id, start_offset, end_offset, feature_id)
);
CREATE INDEX IF NOT EXISTS insights_note_idx ON insights (note_id);
CREATE INDEX IF NOT EXISTS insights_feature_idx ON insights (feature_id);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','frozen','shipped')),
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  order_version INTEGER NOT NULL DEFAULT 1,
  snapshot_version INTEGER,
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS releases_workspace_idx ON releases (workspace_id);

CREATE TABLE IF NOT EXISTS idempotency_records (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  release_id TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_in_seconds INTEGER,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS share_links_token_idx ON share_links (token);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  release_id TEXT,
  to_email TEXT NOT NULL,
  to_name TEXT,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_unsent_idx ON outbox (sent_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_workspace_idx ON audit_log (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS import_locks (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  locked_until TIMESTAMPTZ
);
