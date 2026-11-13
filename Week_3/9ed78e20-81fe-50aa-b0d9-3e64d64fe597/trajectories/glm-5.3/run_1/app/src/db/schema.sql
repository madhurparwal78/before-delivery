-- Open Record schema. PostgreSQL is the only system of record.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS staff (
  email text PRIMARY KEY,
  name text NOT NULL,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_email text NOT NULL REFERENCES staff(email),
  role text NOT NULL CHECK (role IN ('editor','approver','recruiter','administrator')),
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS grants_staff_idx ON grants(staff_email, role);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  staff_email text NOT NULL REFERENCES staff(email),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('model','news')),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  subject text CHECK (subject IS NULL OR subject IN ('research','safety','policy','company')),
  tags jsonb,
  claims jsonb,
  linked_news_slug text,
  status text NOT NULL CHECK (status IN ('draft','in_review','returned','approved','scheduled','published','withdrawn')),
  author_email text NOT NULL REFERENCES staff(email),
  release_at timestamptz,
  published_at timestamptz,
  read_time_minutes integer,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_status_idx ON content_items(status);
CREATE INDEX IF NOT EXISTS content_published_idx ON content_items(published_at) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS publication_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_items(id),
  published_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  UNIQUE (content_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_items(id),
  author_email text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_content_idx ON comments(content_id, created_at);

CREATE TABLE IF NOT EXISTS release_records (
  content_id uuid PRIMARY KEY REFERENCES content_items(id),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','safety_signed','legal_signed','signed','claims_validated','cleared')),
  safety_by text,
  safety_at timestamptz,
  safety_note text,
  safety_grant_id uuid,
  legal_by text,
  legal_at timestamptz,
  legal_note text,
  legal_grant_id uuid,
  claims_validated_at timestamptz,
  last_validation jsonb,
  cleared_by text,
  cleared_at timestamptz
);

CREATE TABLE IF NOT EXISTS comparators (
  slug text PRIMARY KEY,
  name text NOT NULL,
  organisation text NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  subject_name text NOT NULL,
  organisation text NOT NULL,
  benchmark text NOT NULL,
  eval_date text NOT NULL,
  score text NOT NULL,
  source_note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject, benchmark, eval_date)
);
CREATE INDEX IF NOT EXISTS benchmark_rows_subject_idx ON benchmark_rows(benchmark, eval_date);

CREATE TABLE IF NOT EXISTS search_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('model','news','role')),
  ref_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  published_at timestamptz,
  live boolean NOT NULL DEFAULT true,
  UNIQUE (kind, ref_id)
);
CREATE INDEX IF NOT EXISTS search_index_live_idx ON search_index(live);

CREATE TABLE IF NOT EXISTS theses (
  number integer PRIMARY KEY,
  heading text NOT NULL,
  body text NOT NULL
);

CREATE TABLE IF NOT EXISTS offices (
  slug text PRIMARY KEY,
  label text NOT NULL,
  region text NOT NULL
);

CREATE TABLE IF NOT EXISTS regions (
  slug text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  discipline text NOT NULL CHECK (discipline IN ('research','engineering','policy','operations')),
  office text NOT NULL REFERENCES offices(slug),
  description text NOT NULL,
  opened_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  retention_deadline timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requisition_recruiters (
  requisition_id uuid NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  email text NOT NULL,
  PRIMARY KEY (requisition_id, email)
);

CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES requisitions(id),
  reference text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  stage text NOT NULL DEFAULT 'submitted'
    CHECK (stage IN ('submitted','screening','interview','final_review','offer','declined','withdrawn')),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  resume_key text,
  token_digest text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (requisition_id, email)
);
CREATE INDEX IF NOT EXISTS applications_email_idx ON applications(email);

CREATE TABLE IF NOT EXISTS stage_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id),
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  rationale text NOT NULL,
  by_email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stage_decisions_app_idx ON stage_decisions(application_id, at);

CREATE TABLE IF NOT EXISTS application_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id),
  body text NOT NULL,
  by_email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_notes_app_idx ON application_notes(application_id, at);

CREATE TABLE IF NOT EXISTS benefits_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL REFERENCES regions(slug),
  effective_from text NOT NULL,
  summary text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (region, effective_from)
);

CREATE TABLE IF NOT EXISTS samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_slug text NOT NULL,
  sample_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('audio','image_sequence')),
  title text NOT NULL,
  files jsonb NOT NULL,
  UNIQUE (model_slug, sample_id)
);

CREATE TABLE IF NOT EXISTS audit_entries (
  seq bigint PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  detail jsonb NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('mail','resume_erase','sample_upload','scheduled','retention','grant_notice','signoff_void','resend')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','done','dead')),
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  refusals integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_owner text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs(state, next_attempt_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket text NOT NULL,
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

CREATE TABLE IF NOT EXISTS signin_lockouts (
  email text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  lockout_seconds integer
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text NOT NULL,
  scope text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body jsonb,
  in_progress boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS resend_counts (
  email text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expiry_notices (
  grant_id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embargo_releases (
  content_id uuid PRIMARY KEY,
  release_at timestamptz NOT NULL,
  released boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS embargo_due_idx ON embargo_releases(release_at) WHERE released = false;

CREATE OR REPLACE FUNCTION audit_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_entries are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_entries_immutable ON audit_entries;
CREATE TRIGGER audit_entries_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_immutable();
