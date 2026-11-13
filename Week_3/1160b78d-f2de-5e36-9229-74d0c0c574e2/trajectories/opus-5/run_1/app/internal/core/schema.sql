CREATE SCHEMA IF NOT EXISTS switchlamp;
SET search_path TO switchlamp;

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS clock_state (
  id int PRIMARY KEY,
  offset_seconds bigint NOT NULL DEFAULT 0,
  frozen boolean NOT NULL DEFAULT false,
  frozen_at timestamptz
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL,
  timezone text NOT NULL,
  quiet_start text,
  quiet_end text,
  notification_delays jsonb NOT NULL DEFAULT '[5,15]',
  low_urgency_delay int NOT NULL DEFAULT 0,
  password_hash text NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS saved_filters (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  status text NOT NULL,
  service_id uuid,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  scope text NOT NULL,
  prefix text NOT NULL,
  hash text NOT NULL,
  old_hash text,
  old_prefix text,
  grace_ends_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  repeats int NOT NULL DEFAULT 0,
  levels jsonb NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  team text NOT NULL,
  policy_id uuid REFERENCES policies(id),
  grouping_mode text NOT NULL DEFAULT 'none',
  grouping_minutes int,
  ack_timeout_minutes int,
  auto_resolve_minutes int,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS service_deps (
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  depends_on_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES services(id),
  name text NOT NULL,
  routing_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  zone text NOT NULL,
  record_format int NOT NULL DEFAULT 2,
  upgraded_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS layers (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  name text NOT NULL,
  ord int NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL
);

-- A layer keeps every form it has had, so an edit changes only the future and a
-- past range reads identically before and after the edit.
CREATE TABLE IF NOT EXISTS layer_versions (
  id uuid PRIMARY KEY,
  layer_id uuid NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  from_at timestamptz NOT NULL,
  to_at timestamptz,
  shift_days int NOT NULL,
  handoff_time text NOT NULL,
  start_date text NOT NULL,
  people jsonb NOT NULL,
  restrictions jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS overrides (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  person_id uuid REFERENCES users(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS incident_numbers START 5;

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY,
  number bigint NOT NULL UNIQUE,
  service_id uuid NOT NULL REFERENCES services(id),
  title text NOT NULL,
  status text NOT NULL,
  urgency text NOT NULL,
  level int NOT NULL DEFAULT 1,
  cycle int NOT NULL DEFAULT 0,
  policy_snapshot jsonb NOT NULL,
  escalation_due_at timestamptz,
  escalation_finished boolean NOT NULL DEFAULT false,
  ack_deadline_at timestamptz,
  snoozed_until timestamptz,
  snoozed_by uuid,
  auto_resolve_minutes int,
  auto_resolve_at timestamptz,
  opened_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by text,
  decided_by text,
  decided_at timestamptz,
  resolved_at timestamptz,
  resolve_reason text,
  resolved_by text,
  merged_into uuid,
  grouping_until timestamptz,
  holders_pinned boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS incident_holders (
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES users(id),
  assignment_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL,
  PRIMARY KEY (incident_id, person_id)
);

CREATE TABLE IF NOT EXISTS incident_impacted (
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id),
  PRIMARY KEY (incident_id, service_id)
);

CREATE TABLE IF NOT EXISTS incident_responders (
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (incident_id, person_id)
);

CREATE TABLE IF NOT EXISTS responder_requests (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES users(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  answered_at timestamptz
);

CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY,
  incident_id uuid REFERENCES incidents(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id),
  routing_key text,
  dedup_key text NOT NULL,
  status text NOT NULL,
  summary text NOT NULL,
  source text NOT NULL,
  severity text NOT NULL,
  event_count int NOT NULL DEFAULT 1,
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS alerts_key ON alerts (routing_key, dedup_key);

CREATE TABLE IF NOT EXISTS timeline (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  seq bigserial,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  actor text NOT NULL,
  text text NOT NULL,
  from_number bigint
);

CREATE TABLE IF NOT EXISTS note_drafts (
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  saved_at timestamptz NOT NULL,
  PRIMARY KEY (incident_id, person_id)
);

CREATE TABLE IF NOT EXISTS notification_steps (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES users(id),
  assignment_id uuid NOT NULL,
  kind text NOT NULL,
  channel text NOT NULL,
  due_at timestamptz NOT NULL,
  held_until timestamptz,
  status text NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ack_link_uses (
  step_id uuid PRIMARY KEY,
  incident_id uuid NOT NULL,
  person_id uuid NOT NULL,
  used_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS event_log (
  id bigserial PRIMARY KEY,
  integration_id uuid,
  event_id uuid,
  at timestamptz NOT NULL,
  action text,
  dedup_key text,
  outcome text NOT NULL,
  reason text,
  incident_number bigint
);

CREATE TABLE IF NOT EXISTS event_seq (
  routing_key text NOT NULL,
  dedup_key text NOT NULL,
  next_seq bigint NOT NULL DEFAULT 1,
  applied_seq bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (routing_key, dedup_key)
);

CREATE TABLE IF NOT EXISTS applied_events (
  event_id uuid PRIMARY KEY,
  applied_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_events (
  event_id uuid PRIMARY KEY,
  routing_key text NOT NULL,
  dedup_key text NOT NULL,
  key_seq bigint NOT NULL,
  body jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  next_try_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS dead_letters (
  id uuid PRIMARY KEY,
  event_id uuid,
  integration_id uuid,
  routing_key text,
  reason text NOT NULL,
  raw text NOT NULL,
  attempts int NOT NULL,
  dead_at timestamptz NOT NULL,
  replayed_at timestamptz,
  replaying boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id uuid PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES services(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  cancelled_at timestamptz
);

CREATE TABLE IF NOT EXISTS status_updates (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  state text NOT NULL,
  service_ids jsonb NOT NULL DEFAULT '[]',
  published_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS subscribers (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  unsubscribed_at timestamptz
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  path text NOT NULL,
  event_types jsonb NOT NULL,
  service_ids jsonb NOT NULL DEFAULT '[]',
  secret text NOT NULL,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY,
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  type text NOT NULL,
  body jsonb NOT NULL,
  status text NOT NULL,
  attempt_count int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_attempts (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  attempt int NOT NULL,
  at timestamptz NOT NULL,
  status_code int,
  body text NOT NULL DEFAULT '',
  outcome text NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_jobs (
  id uuid PRIMARY KEY,
  from_date text NOT NULL,
  to_date text NOT NULL,
  state text NOT NULL,
  done int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  rows jsonb,
  overall jsonb,
  cached boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id uuid PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  step_id uuid,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS live_messages (
  seq bigserial PRIMARY KEY,
  type text NOT NULL,
  at timestamptz NOT NULL,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  route text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  status int NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (route, key)
);
