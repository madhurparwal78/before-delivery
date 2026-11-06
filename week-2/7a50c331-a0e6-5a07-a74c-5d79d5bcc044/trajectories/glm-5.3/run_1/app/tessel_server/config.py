import os

DATABASE_URL = os.environ["DATABASE_URL"]
SMTP_HOST = os.environ["SMTP_HOST"]
SMTP_PORT = int(os.environ["SMTP_PORT"])
MAIL_FROM = os.environ["MAIL_FROM"]
PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173")
PUBLIC_PORT = int(os.environ.get("APP_PUBLIC_PORT", "4173"))
BIND_HOST = "0.0.0.0"
BIND_PORT = 4173
FIXTURE_REPO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "code-host-repo.json")

SQL = """\
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.organizations (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  plan text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_org_name ON app.organizations (name);

CREATE TABLE IF NOT EXISTS app.members (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES app.organizations(id),
  email text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_member_email ON app.members (email);

CREATE TABLE IF NOT EXISTS app.sessions (
  id bigserial PRIMARY KEY,
  member_id bigint NOT NULL REFERENCES app.members(id),
  token_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_session_token ON app.sessions (token_digest);

CREATE TABLE IF NOT EXISTS app.api_keys (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES app.organizations(id),
  name text NOT NULL,
  role text NOT NULL,
  prefix text NOT NULL,
  secret_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  scoped boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_key_secret ON app.api_keys (secret_digest);
CREATE INDEX IF NOT EXISTS ix_key_org ON app.api_keys (organization_id, id);


CREATE TABLE IF NOT EXISTS app.databases (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES app.organizations(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  ready_at timestamptz NOT NULL,
  last_lsn bigint NOT NULL DEFAULT 0,
  indexed_lsn bigint NOT NULL DEFAULT 0,
  index_generation bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_db_org_name ON app.databases (organization_id, name);

CREATE TABLE IF NOT EXISTS app.key_databases (
  api_key_id bigint NOT NULL REFERENCES app.api_keys(id) ON DELETE CASCADE,
  database_id bigint NOT NULL REFERENCES app.databases(id) ON DELETE CASCADE,
  PRIMARY KEY (api_key_id, database_id)
);
CREATE TABLE IF NOT EXISTS app.collections (
  id bigserial PRIMARY KEY,
  database_id bigint NOT NULL REFERENCES app.databases(id) ON DELETE CASCADE,
  name text NOT NULL,
  UNIQUE (database_id, name)
);

CREATE TABLE IF NOT EXISTS app.sources (
  id bigserial PRIMARY KEY,
  database_id bigint NOT NULL REFERENCES app.databases(id) ON DELETE CASCADE,
  collection text NOT NULL,
  source_id text NOT NULL,
  title text NOT NULL,
  text text NOT NULL,
  version bigint NOT NULL,
  token_count bigint NOT NULL,
  ingested_at timestamptz NOT NULL,
  lsn bigint NOT NULL,
  live boolean NOT NULL DEFAULT true,
  UNIQUE (database_id, collection, source_id)
);
CREATE INDEX IF NOT EXISTS ix_source_db ON app.sources (database_id, collection, source_id);

CREATE TABLE IF NOT EXISTS app.source_versions (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES app.organizations(id),
  database_id bigint,
  collection text,
  source_id text,
  version bigint NOT NULL,
  lsn bigint NOT NULL,
  token_count bigint NOT NULL,
  ingested_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sv_org_month ON app.source_versions (organization_id, ingested_at);
CREATE INDEX IF NOT EXISTS ix_sv_db ON app.source_versions (database_id);

CREATE TABLE IF NOT EXISTS app.facts (
  id bigserial PRIMARY KEY,
  database_id bigint NOT NULL REFERENCES app.databases(id) ON DELETE CASCADE,
  lsn bigint NOT NULL,
  position bigint NOT NULL,
  source_id text NOT NULL,
  subject text NOT NULL,
  subject_key text NOT NULL,
  object text NOT NULL,
  object_key text NOT NULL,
  predicate text NOT NULL,
  valid_from timestamptz NOT NULL,
  reason text NOT NULL,
  source_live boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ix_fact_subject ON app.facts (database_id, source_live, subject_key, predicate, valid_from DESC, lsn DESC, position DESC);
CREATE INDEX IF NOT EXISTS ix_fact_object ON app.facts (database_id, source_live, object_key);
CREATE INDEX IF NOT EXISTS ix_fact_lsn ON app.facts (database_id, lsn, position);
CREATE INDEX IF NOT EXISTS ix_fact_pred ON app.facts (database_id, predicate, source_live);

CREATE TABLE IF NOT EXISTS app.wal_entries (
  id bigserial PRIMARY KEY,
  database_id bigint NOT NULL REFERENCES app.databases(id) ON DELETE CASCADE,
  lsn bigint NOT NULL,
  kind text NOT NULL,
  source_id text,
  created_at timestamptz NOT NULL,
  UNIQUE (database_id, lsn)
);

CREATE TABLE IF NOT EXISTS app.query_records (
  request_id uuid PRIMARY KEY,
  organization_id bigint NOT NULL,
  database_id bigint REFERENCES app.databases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_query_org ON app.query_records (organization_id, created_at);

CREATE TABLE IF NOT EXISTS app.feedback (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL,
  organization_id bigint NOT NULL,
  rating text,
  feedback text,
  source text,
  ground_truth jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_feedback_org_time ON app.feedback (organization_id, created_at);

CREATE TABLE IF NOT EXISTS app.contact_messages (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_contact_email_time ON app.contact_messages (email, created_at);

CREATE TABLE IF NOT EXISTS app.audit_events (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES app.organizations(id),
  at timestamptz NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  detail text NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_org_at ON app.audit_events (organization_id, at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app.export_jobs (
  id uuid PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES app.organizations(id),
  database_id bigint NOT NULL REFERENCES app.databases(id) ON DELETE CASCADE,
  database_name text NOT NULL,
  lsn bigint NOT NULL,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_org ON app.export_jobs (organization_id, requested_at);

CREATE TABLE IF NOT EXISTS app.idempotency (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  digest text NOT NULL,
  status int NOT NULL,
  data jsonb NOT NULL,
  in_progress boolean NOT NULL DEFAULT true,
  database text,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, route, key)
);
CREATE INDEX IF NOT EXISTS ix_idem_time ON app.idempotency (created_at);

CREATE TABLE IF NOT EXISTS app.reset_tokens (
  id bigserial PRIMARY KEY,
  member_id bigint NOT NULL REFERENCES app.members(id) ON DELETE CASCADE,
  digest text NOT NULL,
  created_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_reset_digest ON app.reset_tokens (digest);

CREATE TABLE IF NOT EXISTS app.recovery_codes (
  id bigserial PRIMARY KEY,
  member_id bigint NOT NULL REFERENCES app.members(id) ON DELETE CASCADE,
  digest text NOT NULL,
  used_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_recovery_digest ON app.recovery_codes (digest);

CREATE TABLE IF NOT EXISTS app.members_totp (
  member_id bigint PRIMARY KEY REFERENCES app.members(id) ON DELETE CASCADE,
  secret text,
  last_step bigint NOT NULL DEFAULT -1,
  recovery_hash text
);

CREATE TABLE IF NOT EXISTS app.signin_attempts (
  email text PRIMARY KEY,
  count int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS app.reset_emails (
  member_id bigint NOT NULL REFERENCES app.members(id) ON DELETE CASCADE,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_reset_emails ON app.reset_emails (member_id, at);

CREATE TABLE IF NOT EXISTS app.query_usage (
  api_key_id bigint PRIMARY KEY REFERENCES app.api_keys(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0
);
"""
