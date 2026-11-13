-- Aldermoor Open Record schema. Applied idempotently on every boot.

CREATE TABLE IF NOT EXISTS staff (
  email text PRIMARY KEY,
  name text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS role_grants (
  id text PRIMARY KEY,
  staff_email text NOT NULL REFERENCES staff(email),
  role text NOT NULL,
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  expiry_notice_queued_at timestamptz,
  lapse_swept_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS role_grants_staff_idx ON role_grants (staff_email, role);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  staff_email text NOT NULL REFERENCES staff(email),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS signin_attempts (
  email text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  lock_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  bucket text NOT NULL,
  client_key text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL,
  PRIMARY KEY (bucket, client_key)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  idem_key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL,
  status integer,
  body text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, idem_key)
);

CREATE TABLE IF NOT EXISTS content_items (
  id text PRIMARY KEY,
  kind text NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  subject text,
  tags text[],
  claims jsonb,
  linked_news_slug text,
  status text NOT NULL,
  author text NOT NULL REFERENCES staff(email),
  release_at timestamptz,
  release_at_local text,
  scheduled_by text,
  published_at timestamptz,
  read_time_minutes integer,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS content_items_kind_slug_idx ON content_items (kind, slug);
CREATE INDEX IF NOT EXISTS content_items_status_idx ON content_items (status);

CREATE TABLE IF NOT EXISTS content_comments (
  id text PRIMARY KEY,
  content_id text NOT NULL REFERENCES content_items(id),
  author text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS content_comments_item_idx ON content_comments (content_id, created_at);

CREATE TABLE IF NOT EXISTS release_records (
  content_id text PRIMARY KEY REFERENCES content_items(id),
  status text NOT NULL,
  safety_by text,
  safety_at timestamptz,
  safety_note text,
  legal_by text,
  legal_at timestamptz,
  legal_note text,
  claims_validated_at timestamptz,
  last_validation jsonb,
  cleared_by text,
  cleared_at timestamptz
);

CREATE TABLE IF NOT EXISTS benchmark_rows (
  id text PRIMARY KEY,
  subject text NOT NULL,
  benchmark text NOT NULL,
  eval_date date NOT NULL,
  score_text text NOT NULL,
  score numeric NOT NULL,
  source_note text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS benchmark_rows_unique_idx
  ON benchmark_rows (subject, benchmark, eval_date);

CREATE TABLE IF NOT EXISTS publication_events (
  content_id text PRIMARY KEY REFERENCES content_items(id),
  published_at timestamptz NOT NULL,
  withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS model_samples (
  id text NOT NULL,
  model_slug text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  frames integer NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (model_slug, id)
);

CREATE TABLE IF NOT EXISTS requisitions (
  id text PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  discipline text NOT NULL,
  office text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  recruiters text[] NOT NULL,
  opened_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  retention_deadline timestamptz,
  retention_swept_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id text PRIMARY KEY,
  requisition_id text NOT NULL REFERENCES requisitions(id),
  reference text UNIQUE NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  stage text NOT NULL,
  resume_key text,
  submitted_at timestamptz NOT NULL,
  stage_changed_at timestamptz NOT NULL,
  erased_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS applications_role_email_idx
  ON applications (requisition_id, email) WHERE erased_at IS NULL;
CREATE INDEX IF NOT EXISTS applications_email_idx ON applications (email);

CREATE TABLE IF NOT EXISTS stage_decisions (
  id text PRIMARY KEY,
  application_id text NOT NULL REFERENCES applications(id),
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  rationale text NOT NULL,
  actor text NOT NULL,
  at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS stage_decisions_app_idx ON stage_decisions (application_id, at);

CREATE TABLE IF NOT EXISTS application_notes (
  id text PRIMARY KEY,
  application_id text NOT NULL REFERENCES applications(id),
  body text NOT NULL,
  author text NOT NULL,
  at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS application_notes_app_idx ON application_notes (application_id, at);

CREATE TABLE IF NOT EXISTS tracking_links (
  token_digest text PRIMARY KEY,
  token text NOT NULL,
  application_id text NOT NULL REFERENCES applications(id),
  created_at timestamptz NOT NULL,
  retired_at timestamptz
);

CREATE INDEX IF NOT EXISTS tracking_links_app_idx ON tracking_links (application_id);

CREATE TABLE IF NOT EXISTS resend_events (
  id text PRIMARY KEY,
  email text NOT NULL,
  at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS resend_events_email_idx ON resend_events (email, at);

CREATE TABLE IF NOT EXISTS benefits_entries (
  id text PRIMARY KEY,
  region text NOT NULL,
  effective_from date NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS benefits_entries_unique_idx
  ON benefits_entries (region, effective_from);

CREATE TABLE IF NOT EXISTS search_index (
  kind text NOT NULL,
  slug text NOT NULL,
  ref_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  published_at timestamptz NOT NULL,
  tsv tsvector NOT NULL,
  PRIMARY KEY (kind, slug)
);

CREATE INDEX IF NOT EXISTS search_index_tsv_idx ON search_index USING gin (tsv);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  dedupe_key text UNIQUE,
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  refusals integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL,
  lease_until timestamptz,
  created_at timestamptz NOT NULL,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (kind, state, next_attempt_at);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS audit_entries (
  seq bigint PRIMARY KEY,
  id text UNIQUE NOT NULL,
  at timestamptz NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  detail jsonb NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_entries_action_idx ON audit_entries (action);
CREATE INDEX IF NOT EXISTS audit_entries_target_idx ON audit_entries (target_id);

CREATE OR REPLACE FUNCTION audit_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_entries is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_entries_no_update ON audit_entries;
CREATE TRIGGER audit_entries_no_update BEFORE UPDATE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only();

DROP TRIGGER IF EXISTS audit_entries_no_delete ON audit_entries;
CREATE TRIGGER audit_entries_no_delete BEFORE DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only();

DROP TRIGGER IF EXISTS audit_entries_no_truncate ON audit_entries;
CREATE TRIGGER audit_entries_no_truncate BEFORE TRUNCATE ON audit_entries
  EXECUTE FUNCTION audit_entries_append_only();

CREATE TABLE IF NOT EXISTS seed_state (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL
);
