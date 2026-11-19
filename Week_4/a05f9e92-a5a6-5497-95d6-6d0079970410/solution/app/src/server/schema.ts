export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS sequences (name text PRIMARY KEY, value bigint NOT NULL);
CREATE TABLE IF NOT EXISTS departments (name text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS people (
  username text PRIMARY KEY, display_name text NOT NULL, department text NOT NULL, active boolean NOT NULL DEFAULT true, seq bigserial);
CREATE TABLE IF NOT EXISTS users (
  username text PRIMARY KEY REFERENCES people(username) ON DELETE CASCADE, password_hash text NOT NULL,
  roles text[] NOT NULL, time_zone text NOT NULL, out_of_office boolean NOT NULL DEFAULT false, capacity integer,
  digest text NOT NULL DEFAULT 'immediate', delegate jsonb, last_digest_at timestamptz);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY, username text NOT NULL, workspace text NOT NULL DEFAULT 'live', impersonating text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log (id bigserial PRIMARY KEY, at timestamptz NOT NULL, kind text NOT NULL, actor text NOT NULL, target text NOT NULL);
CREATE TABLE IF NOT EXISTS groups (name text PRIMARY KEY, members text[] NOT NULL DEFAULT '{}', escalation_policy text, rr_pointer text, seq bigserial);
CREATE TABLE IF NOT EXISTS config_items (
  id bigserial PRIMARY KEY, workspace text NOT NULL, kind text NOT NULL, name text NOT NULL, content jsonb NOT NULL,
  promoted jsonb, UNIQUE (workspace, kind, name));
CREATE TABLE IF NOT EXISTS workflow_versions (
  workflow_id bigint NOT NULL, version integer NOT NULL, steps jsonb NOT NULL, withdrawn boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workflow_id, version));
CREATE TABLE IF NOT EXISTS runs (
  id bigserial PRIMARY KEY, workflow_id bigint NOT NULL, workflow_name text NOT NULL, version integer NOT NULL, record text,
  status text NOT NULL, steps jsonb NOT NULL, state jsonb NOT NULL, test boolean NOT NULL DEFAULT false, wake_at timestamptz,
  parent_run bigint, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS records (
  id bigserial PRIMARY KEY, number text NOT NULL UNIQUE, table_name text NOT NULL, fields jsonb NOT NULL, versions jsonb NOT NULL,
  state_history jsonb NOT NULL, created_by text, close_at timestamptz, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS records_table ON records (table_name);
CREATE TABLE IF NOT EXISTS activity (
  id bigserial PRIMARY KEY, record_number text NOT NULL, at timestamptz NOT NULL, actor text, acting_for text, kind text NOT NULL,
  text text NOT NULL, field text);
CREATE INDEX IF NOT EXISTS activity_record ON activity (record_number);
CREATE TABLE IF NOT EXISTS audit (
  id bigserial PRIMARY KEY, record_number text NOT NULL, at timestamptz NOT NULL, actor text, acting_for text, field text NOT NULL,
  before jsonb, after jsonb, reason text);
CREATE INDEX IF NOT EXISTS audit_record ON audit (record_number);
CREATE TABLE IF NOT EXISTS attachments (
  id bigserial PRIMARY KEY, record_number text NOT NULL, name text NOT NULL, bytes integer NOT NULL, type text NOT NULL,
  status text NOT NULL, uploader text NOT NULL, data bytea);
CREATE TABLE IF NOT EXISTS slas (
  id bigserial PRIMARY KEY, record_number text NOT NULL, definition text NOT NULL, priority integer NOT NULL, start_at timestamptz NOT NULL,
  cancelled boolean NOT NULL DEFAULT false, thresholds integer[] NOT NULL DEFAULT '{}', breached boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS slas_record ON slas (record_number);
CREATE TABLE IF NOT EXISTS inbox (
  id bigserial PRIMARY KEY, username text NOT NULL, event text NOT NULL, text text NOT NULL, record text, at timestamptz NOT NULL,
  read boolean NOT NULL DEFAULT false, delivered boolean NOT NULL DEFAULT true, digested boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS inbox_user ON inbox (username);
CREATE TABLE IF NOT EXISTS cis (
  id bigserial PRIMARY KEY, name text NOT NULL, class text NOT NULL, criticality integer NOT NULL, business_critical boolean NOT NULL,
  owner_department text NOT NULL, status text NOT NULL DEFAULT 'healthy', attributes jsonb NOT NULL DEFAULT '{}', used_by jsonb);
CREATE UNIQUE INDEX IF NOT EXISTS cis_name ON cis (lower(name));
CREATE TABLE IF NOT EXISTS relationships (source text NOT NULL, type text NOT NULL, target text NOT NULL, PRIMARY KEY (source, type, target));
CREATE TABLE IF NOT EXISTS maintenance (id bigserial PRIMARY KEY, ci text NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (
  id bigserial PRIMARY KEY, ci text NOT NULL, reason text NOT NULL, business_critical_affected integer NOT NULL,
  linked_open_incidents jsonb NOT NULL, status text NOT NULL DEFAULT 'open', incident text, reject_reason text, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS boards (
  name text PRIMARY KEY, rule text NOT NULL, n integer, threshold_percent integer, window_hours integer NOT NULL, members jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS freeze_windows (
  name text PRIMARY KEY, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, time_zone text NOT NULL, scope jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS change_steps (
  change_number text NOT NULL, step_no integer NOT NULL, name text NOT NULL, status text NOT NULL, opens_at timestamptz, closes_at timestamptz,
  spec jsonb NOT NULL, PRIMARY KEY (change_number, step_no));
CREATE TABLE IF NOT EXISTS votes (
  id bigserial PRIMARY KEY, change_number text NOT NULL, step_no integer NOT NULL, voter text NOT NULL, voted_by text NOT NULL,
  decision text NOT NULL, at timestamptz NOT NULL, voided boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS votes_change ON votes (change_number);
CREATE TABLE IF NOT EXISTS item_approvals (
  id bigserial PRIMARY KEY, request_item text NOT NULL, run_id bigint, step_id text, approvers text[] NOT NULL, rule text NOT NULL,
  decisions jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS rotations (
  name text PRIMARY KEY, time_zone text NOT NULL, handover_weekday text NOT NULL, handover_time text NOT NULL, members text[] NOT NULL, anchor_date text NOT NULL);
CREATE TABLE IF NOT EXISTS overrides (
  id bigserial PRIMARY KEY, rotation text NOT NULL, username text NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS escalation_policies (name text PRIMARY KEY, levels jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS pages (
  id bigserial PRIMARY KEY, record_number text NOT NULL, policy text NOT NULL, status text NOT NULL, level integer NOT NULL,
  levels jsonb NOT NULL, acknowledged_by text, acknowledged_level integer, late boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS requests (
  number text PRIMARY KEY, requester text NOT NULL, requested_for text, created_at timestamptz NOT NULL, closed boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS cart_lines (
  id bigserial PRIMARY KEY, username text NOT NULL, item text NOT NULL, quantity integer NOT NULL, variables jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS guides (id text PRIMARY KEY, name text NOT NULL, questions jsonb NOT NULL, rules jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status integer NOT NULL, body jsonb NOT NULL,
  created_at timestamptz NOT NULL, PRIMARY KEY (scope, key));
CREATE TABLE IF NOT EXISTS articles (
  id bigserial PRIMARY KEY, number text NOT NULL, version integer NOT NULL, title text NOT NULL, body text NOT NULL, keywords text[] NOT NULL,
  state text NOT NULL, valid_until text, audience jsonb NOT NULL, author text NOT NULL, published_at timestamptz,
  helpful_yes integer NOT NULL DEFAULT 0, helpful_no integer NOT NULL DEFAULT 0, UNIQUE (number, version));
CREATE TABLE IF NOT EXISTS article_votes (
  number text NOT NULL, version integer NOT NULL, username text NOT NULL, helpful boolean NOT NULL, PRIMARY KEY (number, version, username));
CREATE TABLE IF NOT EXISTS filters (
  id bigserial PRIMARY KEY, name text NOT NULL, table_name text NOT NULL, filter text NOT NULL, shared boolean NOT NULL, owner text NOT NULL);
CREATE TABLE IF NOT EXISTS dashboards (id text PRIMARY KEY, name text NOT NULL, roles text[] NOT NULL, widgets jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS exports (
  id bigserial PRIMARY KEY, owner text NOT NULL, table_name text NOT NULL, filter text NOT NULL, columns jsonb NOT NULL, status text NOT NULL,
  rows_total integer NOT NULL DEFAULT 0, rows_done integer NOT NULL DEFAULT 0, error text, key text, csv text, impersonating text);
CREATE TABLE IF NOT EXISTS imports (
  id bigserial PRIMARY KEY, table_name text NOT NULL, key text NOT NULL, rows jsonb NOT NULL, counts jsonb NOT NULL,
  committed boolean NOT NULL DEFAULT false, results jsonb);
CREATE TABLE IF NOT EXISTS config_sets (
  id bigserial PRIMARY KEY, number text NOT NULL UNIQUE, name text NOT NULL, state text NOT NULL, owner text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]', key text, snapshots jsonb, committed_seq bigint);
`;
