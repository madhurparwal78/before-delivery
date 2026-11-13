export const schemaSql = `
CREATE SEQUENCE IF NOT EXISTS entity_ids START 9007199254742001;

CREATE TABLE IF NOT EXISTS households (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parents (
  id bigint PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households(id),
  role text NOT NULL CHECK (role IN ('planning','other')),
  name text NOT NULL,
  email text NOT NULL,
  email_lower text NOT NULL UNIQUE,
  password_hash text,
  joined boolean NOT NULL DEFAULT false,
  UNIQUE (household_id, role)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  parent_id bigint NOT NULL REFERENCES parents(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signin_failures (
  id bigserial PRIMARY KEY,
  email_lower text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signin_failures_email_at ON signin_failures (email_lower, at DESC);

CREATE TABLE IF NOT EXISTS invites (
  id bigint PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  dead boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_versions (
  id bigint PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households(id),
  number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','adopted')),
  effective_from date NOT NULL,
  body text NOT NULL,
  rev integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS plan_versions_one_draft ON plan_versions (household_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS swaps (
  id bigint PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households(id),
  nights_start date NOT NULL,
  nights_end date NOT NULL,
  makeup_start date,
  makeup_end date,
  to_parent text NOT NULL CHECK (to_parent IN ('planning','other')),
  created_by text NOT NULL CHECK (created_by IN ('planning','other')),
  note text,
  state text NOT NULL,
  sent_at timestamptz,
  answer_by timestamptz,
  answer_zone text,
  answered_at timestamptz,
  decline_reason text,
  reminder_at timestamptz,
  reminded boolean NOT NULL DEFAULT false,
  settle_at timestamptz,
  rev integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS costs (
  id bigint PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households(id),
  description text NOT NULL,
  category text NOT NULL,
  note text,
  amount_minor bigint NOT NULL,
  incurred_at timestamptz NOT NULL,
  custody_day date NOT NULL,
  paid_by text NOT NULL CHECK (paid_by IN ('planning','other')),
  version_id bigint,
  agreed_split_planning_bp integer,
  split_planning_bp integer NOT NULL,
  share_planning bigint NOT NULL,
  share_other bigint NOT NULL,
  state text NOT NULL,
  sent_at timestamptz,
  answer_by timestamptz,
  answer_zone text,
  answered_at timestamptz,
  decline_reason text,
  reminder_at timestamptz,
  reminded boolean NOT NULL DEFAULT false,
  rev integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipts (
  id bigint PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households(id),
  cost_id bigint NOT NULL REFERENCES costs(id),
  content_type text NOT NULL,
  bytes bigint NOT NULL,
  sha256 text NOT NULL,
  filename text NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS year_records (
  id bigint PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households(id),
  year integer NOT NULL,
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  steps_done integer NOT NULL DEFAULT 0,
  waiting_on text,
  failure text,
  year_digest text NOT NULL,
  year_doc text NOT NULL,
  pdf bytea,
  bytes bigint,
  sha256 text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  stored_at timestamptz,
  lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  object_removed boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS share_links (
  id bigint PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households(id),
  label text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dead_at timestamptz
);

CREATE TABLE IF NOT EXISTS notices (
  id bigint PRIMARY KEY,
  household_id bigint NOT NULL REFERENCES households(id),
  kind text NOT NULL,
  to_email text NOT NULL,
  to_role text NOT NULL,
  subject text NOT NULL,
  link text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  request_table text,
  request_id bigint
);
CREATE INDEX IF NOT EXISTS notices_household_queued ON notices (household_id, queued_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS mail_health (
  household_id bigint PRIMARY KEY REFERENCES households(id),
  last_attempt_failed boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS record_log (
  household_id bigint NOT NULL REFERENCES households(id),
  seq bigint NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  type text NOT NULL,
  subject_id bigint,
  PRIMARY KEY (household_id, seq)
);

CREATE TABLE IF NOT EXISTS statements (
  household_id bigint PRIMARY KEY REFERENCES households(id),
  doc text NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  parent_id bigint NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  key text NOT NULL,
  body_sha text NOT NULL,
  status integer,
  response_body text,
  response_etag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_id, method, path, key)
);
`;
