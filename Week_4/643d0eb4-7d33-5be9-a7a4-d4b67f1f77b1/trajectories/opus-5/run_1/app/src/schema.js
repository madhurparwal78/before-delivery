'use strict';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS seed_state (
  id integer PRIMARY KEY DEFAULT 1,
  version text NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id bigserial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  tier text NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  department text NOT NULL,
  tier text NOT NULL,
  password_hash text NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS role_grants (
  id bigserial PRIMARY KEY,
  account text NOT NULL,
  department text NOT NULL,
  role text NOT NULL,
  authorises_from text NOT NULL,
  created_at text NOT NULL,
  CONSTRAINT role_grants_unique UNIQUE (account, department)
);

CREATE TABLE IF NOT EXISTS tiers (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  grant_order integer NOT NULL,
  audience text NOT NULL,
  row_allowance integer NOT NULL,
  stored_megabytes integer NOT NULL,
  content_allowance_kilobytes integer NOT NULL,
  view_allowance integer NOT NULL,
  retention text NOT NULL,
  most_chosen boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS department_grants (
  id bigserial PRIMARY KEY,
  department text NOT NULL,
  tier text NOT NULL,
  effective_at text NOT NULL,
  CONSTRAINT department_grants_unique UNIQUE (department, effective_at)
);

CREATE TABLE IF NOT EXISTS tables (
  id bigserial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  department text NOT NULL,
  tier text NOT NULL,
  locked_period text
);

CREATE TABLE IF NOT EXISTS columns (
  id bigserial PRIMARY KEY,
  table_slug text NOT NULL,
  caption text NOT NULL,
  position integer NOT NULL,
  type text NOT NULL,
  options jsonb
);
CREATE INDEX IF NOT EXISTS columns_table_idx ON columns (table_slug, position);

CREATE TABLE IF NOT EXISTS rows (
  id bigserial PRIMARY KEY,
  table_slug text NOT NULL,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  inserted_position bigint NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS rows_table_idx ON rows (table_slug, inserted_position);

CREATE TABLE IF NOT EXISTS views (
  id bigserial PRIMARY KEY,
  table_slug text NOT NULL,
  name text NOT NULL,
  owner text NOT NULL,
  visibility text NOT NULL,
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  sorts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS views_table_idx ON views (table_slug);

CREATE TABLE IF NOT EXISTS log_entries (
  id bigserial PRIMARY KEY,
  table_slug text NOT NULL,
  ordinal integer NOT NULL,
  action text NOT NULL,
  account text NOT NULL,
  recorded_at text NOT NULL,
  business_day text NOT NULL,
  column_caption text,
  before jsonb,
  after jsonb,
  subject text,
  previous_hash text NOT NULL,
  entry_hash text NOT NULL,
  row_id bigint,
  CONSTRAINT log_entries_unique UNIQUE (table_slug, ordinal)
);
CREATE INDEX IF NOT EXISTS log_entries_stream_idx ON log_entries (table_slug, ordinal DESC);

CREATE TABLE IF NOT EXISTS snapshots (
  id bigserial PRIMARY KEY,
  table_slug text NOT NULL,
  department text NOT NULL,
  period text NOT NULL,
  account text NOT NULL,
  published_at text NOT NULL,
  business_day text NOT NULL,
  sequence integer NOT NULL,
  tier text NOT NULL,
  row_allowance integer NOT NULL,
  content_allowance_kilobytes integer NOT NULL,
  retention text NOT NULL,
  row_count integer NOT NULL,
  content_bytes integer NOT NULL,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT snapshots_table_period_unique UNIQUE (table_slug, period),
  CONSTRAINT snapshots_department_sequence_unique UNIQUE (department, sequence)
);

CREATE TABLE IF NOT EXISTS requests (
  id bigserial PRIMARY KEY,
  account text NOT NULL,
  department text NOT NULL,
  role text NOT NULL,
  state text NOT NULL,
  reason text,
  raised_at text NOT NULL,
  decided_at text,
  decided_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS requests_one_open
  ON requests (account, department) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS sessions (
  id bigserial PRIMARY KEY,
  value text NOT NULL UNIQUE,
  account text NOT NULL,
  created_at text NOT NULL,
  expires_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  attempted_at text NOT NULL,
  outcome text NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (email, attempted_at DESC);

CREATE TABLE IF NOT EXISTS subscribers (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS enquiries (
  id bigserial PRIMARY KEY,
  full_name text NOT NULL,
  work_email text NOT NULL,
  phone text,
  company text NOT NULL,
  role text,
  message text NOT NULL,
  recorded_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id bigserial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  scope text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body text NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS form_tokens (
  id bigserial PRIMARY KEY,
  value text NOT NULL UNIQUE,
  created_at text NOT NULL
);
`;

module.exports = { SCHEMA_SQL };
