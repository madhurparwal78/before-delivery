/**
 * Schema, the append-only rules on the audit log and the seed are declared once here and
 * applied idempotently on every serve.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL,
  created_seq bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS user_role_history (
  user_id text NOT NULL REFERENCES users (id),
  from_seq bigint NOT NULL,
  role text NOT NULL,
  PRIMARY KEY (user_id, from_seq)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  kind text NOT NULL,
  description text NOT NULL,
  owner_id text NOT NULL REFERENCES users (id),
  created_seq bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_columns (
  id text PRIMARY KEY,
  asset_id text NOT NULL REFERENCES assets (id),
  name text NOT NULL,
  data_type text NOT NULL,
  ordinal integer NOT NULL,
  samples jsonb NOT NULL,
  created_seq bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS asset_columns_asset_idx ON asset_columns (asset_id);

CREATE TABLE IF NOT EXISTS lineage_edges (
  id uuid PRIMARY KEY,
  from_column text NOT NULL REFERENCES asset_columns (id),
  to_column text NOT NULL REFERENCES asset_columns (id),
  transform text NOT NULL,
  added_seq bigint NOT NULL,
  removed_seq bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS lineage_edges_live_pair
  ON lineage_edges (from_column, to_column) WHERE removed_seq IS NULL;

CREATE TABLE IF NOT EXISTS column_tags (
  id bigserial PRIMARY KEY,
  column_id text NOT NULL REFERENCES asset_columns (id),
  tag text NOT NULL,
  added_seq bigint NOT NULL,
  removed_seq bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS column_tags_live
  ON column_tags (column_id, tag) WHERE removed_seq IS NULL;

CREATE TABLE IF NOT EXISTS suppressions (
  id bigserial PRIMARY KEY,
  column_id text NOT NULL REFERENCES asset_columns (id),
  tag text NOT NULL,
  justification text NOT NULL,
  actor_id text NOT NULL REFERENCES users (id),
  at text NOT NULL,
  created_seq bigint NOT NULL,
  lifted_seq bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS suppressions_live
  ON suppressions (column_id, tag) WHERE lifted_seq IS NULL;

CREATE TABLE IF NOT EXISTS tag_batches (
  id uuid PRIMARY KEY,
  asset_id text NOT NULL REFERENCES assets (id),
  tag text NOT NULL,
  applied_seq bigint NOT NULL,
  before_direct_tags jsonb NOT NULL,
  undone_seq bigint
);

CREATE TABLE IF NOT EXISTS evidence_records (
  id uuid PRIMARY KEY,
  asset_id text NOT NULL REFERENCES assets (id),
  storage_key text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  note text NOT NULL,
  uploaded_at text NOT NULL,
  uploaded_by text NOT NULL REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS asset_certification (
  asset_id text NOT NULL REFERENCES assets (id),
  from_seq bigint NOT NULL,
  state text NOT NULL,
  verified_at text,
  evidence_id uuid REFERENCES evidence_records (id),
  deprecation jsonb,
  PRIMARY KEY (asset_id, from_seq)
);

CREATE TABLE IF NOT EXISTS deprecation_events (
  id uuid PRIMARY KEY,
  asset_id text NOT NULL REFERENCES assets (id),
  at_seq bigint NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL REFERENCES users (id),
  at text NOT NULL
);

CREATE TABLE IF NOT EXISTS notices (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES deprecation_events (id),
  asset_id text NOT NULL REFERENCES assets (id),
  owner_id text NOT NULL REFERENCES users (id),
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL,
  claim_expires_at timestamptz,
  queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notices_state_idx ON notices (state);

CREATE TABLE IF NOT EXISTS terms (
  id text PRIMARY KEY,
  created_seq bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS term_revisions (
  term_id text NOT NULL REFERENCES terms (id),
  revision integer NOT NULL,
  name text NOT NULL,
  definition text NOT NULL,
  from_seq bigint NOT NULL,
  PRIMARY KEY (term_id, revision)
);

CREATE TABLE IF NOT EXISTS asset_terms (
  id bigserial PRIMARY KEY,
  asset_id text NOT NULL REFERENCES assets (id),
  term_id text NOT NULL REFERENCES terms (id),
  linked_seq bigint NOT NULL,
  unlinked_seq bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_terms_live
  ON asset_terms (asset_id, term_id) WHERE unlinked_seq IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_records (
  actor_id text NOT NULL,
  route text NOT NULL,
  asset_id text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL,
  status integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, route, asset_id, key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq bigint PRIMARY KEY,
  at text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before jsonb,
  after jsonb,
  prev_hash text NOT NULL,
  hash text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_prev_hash_key ON audit_log (prev_hash);

CREATE TABLE IF NOT EXISTS seed_state (
  id integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_no_row_change') THEN
    CREATE TRIGGER audit_log_no_row_change
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_no_truncate') THEN
    CREATE TRIGGER audit_log_no_truncate
      BEFORE TRUNCATE ON audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
  END IF;
END;
$$;
`;
