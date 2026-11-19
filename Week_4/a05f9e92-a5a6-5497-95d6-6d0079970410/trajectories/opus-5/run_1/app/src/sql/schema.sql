-- Switchyard schema. Applied idempotently on every serve.

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS department (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS person (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  department TEXT,
  password_hash TEXT,
  roles JSONB NOT NULL DEFAULT '[]',
  time_zone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  out_of_office BOOLEAN NOT NULL DEFAULT FALSE,
  capacity INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  can_sign_in BOOLEAN NOT NULL DEFAULT FALSE,
  digest TEXT NOT NULL DEFAULT 'immediate',
  delegate TEXT,
  delegate_from TIMESTAMPTZ,
  delegate_to TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS work_group (
  name TEXT PRIMARY KEY,
  members JSONB NOT NULL DEFAULT '[]',
  escalation_policy TEXT,
  last_assigned TEXT
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  impersonating TEXT,
  workspace TEXT NOT NULL DEFAULT 'live',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  target TEXT
);

CREATE TABLE IF NOT EXISTS sequence_counter (
  prefix TEXT PRIMARY KEY,
  next_value BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS record (
  number TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  state TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '{}',
  versions JSONB NOT NULL DEFAULT '{}',
  state_history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  workspace TEXT NOT NULL DEFAULT 'live'
);

CREATE INDEX IF NOT EXISTS record_table_idx ON record (workspace, table_name);

CREATE TABLE IF NOT EXISTS record_activity (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL REFERENCES record (number) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL,
  actor TEXT,
  acting_for TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS record_activity_idx ON record_activity (number, id);

CREATE TABLE IF NOT EXISTS record_audit (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL REFERENCES record (number) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL,
  actor TEXT,
  acting_for TEXT,
  field TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS record_audit_idx ON record_audit (number, id);

CREATE TABLE IF NOT EXISTS record_link (
  parent TEXT NOT NULL,
  child TEXT NOT NULL,
  PRIMARY KEY (parent, child)
);

CREATE TABLE IF NOT EXISTS attachment (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL,
  object_key TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  queued_bytes BYTEA,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS business_schedule (
  name TEXT PRIMARY KEY,
  time_zone TEXT NOT NULL,
  hours JSONB NOT NULL,
  holidays JSONB NOT NULL DEFAULT '[]',
  workspace TEXT NOT NULL DEFAULT 'live'
);

CREATE TABLE IF NOT EXISTS sla_definition (
  name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  start_expr TEXT NOT NULL,
  pause_expr TEXT NOT NULL,
  stop_expr TEXT NOT NULL,
  schedule TEXT NOT NULL,
  targets JSONB NOT NULL,
  workspace TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (workspace, name)
);

CREATE TABLE IF NOT EXISTS sla_instance (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL REFERENCES record (number) ON DELETE CASCADE,
  definition TEXT NOT NULL,
  priority INTEGER NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  target_seconds INTEGER NOT NULL,
  breached BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  thresholds_sent JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS sla_instance_idx ON sla_instance (number);

CREATE TABLE IF NOT EXISTS configuration_item (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  criticality INTEGER NOT NULL DEFAULT 2,
  business_critical BOOLEAN NOT NULL DEFAULT FALSE,
  owner_department TEXT,
  status TEXT NOT NULL DEFAULT 'healthy',
  attributes JSONB NOT NULL DEFAULT '{}',
  used_by_departments JSONB NOT NULL DEFAULT '[]',
  used_by_people JSONB NOT NULL DEFAULT '[]',
  workspace TEXT NOT NULL DEFAULT 'live'
);

CREATE UNIQUE INDEX IF NOT EXISTS configuration_item_name_idx
  ON configuration_item (workspace, lower(name));

CREATE TABLE IF NOT EXISTS ci_relationship (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  rel_type TEXT NOT NULL,
  target TEXT NOT NULL,
  workspace TEXT NOT NULL DEFAULT 'live'
);

CREATE UNIQUE INDEX IF NOT EXISTS ci_relationship_idx
  ON ci_relationship (workspace, lower(source), rel_type, lower(target));

CREATE TABLE IF NOT EXISTS maintenance_window (
  id BIGSERIAL PRIMARY KEY,
  ci TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  workspace TEXT NOT NULL DEFAULT 'live'
);

CREATE TABLE IF NOT EXISTS major_proposal (
  id BIGSERIAL PRIMARY KEY,
  ci TEXT NOT NULL,
  reason TEXT NOT NULL,
  business_critical_affected INTEGER NOT NULL,
  linked_open_incidents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  incident TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS rotation (
  name TEXT PRIMARY KEY,
  time_zone TEXT NOT NULL,
  handover_weekday TEXT NOT NULL DEFAULT 'monday',
  handover_time TEXT NOT NULL DEFAULT '09:00',
  members JSONB NOT NULL DEFAULT '[]',
  anchor_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rotation_override (
  id BIGSERIAL PRIMARY KEY,
  rotation TEXT NOT NULL,
  username TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS escalation_policy (
  name TEXT PRIMARY KEY,
  levels JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS page (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  policy TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paging',
  level INTEGER NOT NULL DEFAULT 1,
  levels JSONB NOT NULL DEFAULT '[]',
  acknowledged_by TEXT,
  acknowledged_level INTEGER,
  late BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS board (
  name TEXT NOT NULL,
  rule TEXT NOT NULL,
  n INTEGER,
  threshold_percent INTEGER,
  window_hours INTEGER NOT NULL DEFAULT 48,
  members JSONB NOT NULL DEFAULT '[]',
  workspace TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (workspace, name)
);

CREATE TABLE IF NOT EXISTS approval_step (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL,
  step INTEGER NOT NULL,
  name TEXT NOT NULL,
  rule TEXT NOT NULL,
  n INTEGER,
  threshold_percent INTEGER,
  window_hours INTEGER NOT NULL DEFAULT 48,
  status TEXT NOT NULL DEFAULT 'not_started',
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  voters JSONB NOT NULL DEFAULT '[]'
);

CREATE UNIQUE INDEX IF NOT EXISTS approval_step_idx ON approval_step (number, step);

CREATE TABLE IF NOT EXISTS approval_vote (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL,
  step INTEGER NOT NULL,
  voter TEXT NOT NULL,
  voted_by TEXT NOT NULL,
  decision TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  at TIMESTAMPTZ NOT NULL,
  opening INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS item_approval (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  run_id TEXT,
  step_id TEXT,
  approvers JSONB NOT NULL DEFAULT '[]',
  rule TEXT NOT NULL DEFAULT 'any',
  decision TEXT,
  decided_by TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS freeze_window (
  name TEXT PRIMARY KEY,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL,
  scope JSONB NOT NULL DEFAULT '"all"'
);

CREATE TABLE IF NOT EXISTS business_rule (
  name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  when_run TEXT NOT NULL,
  run_order INTEGER NOT NULL DEFAULT 100,
  operations JSONB NOT NULL DEFAULT '[]',
  condition_expr TEXT NOT NULL DEFAULT 'true',
  actions JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  workspace TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (workspace, name)
);

CREATE TABLE IF NOT EXISTS access_rule (
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  table_name TEXT NOT NULL,
  field TEXT,
  operation TEXT NOT NULL,
  roles JSONB NOT NULL DEFAULT '[]',
  condition_expr TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  workspace TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (workspace, name)
);

CREATE TABLE IF NOT EXISTS assignment_rule (
  name TEXT NOT NULL,
  run_order INTEGER NOT NULL DEFAULT 100,
  table_name TEXT NOT NULL,
  condition_expr TEXT NOT NULL DEFAULT 'true',
  group_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  workspace TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (workspace, name)
);

CREATE TABLE IF NOT EXISTS form_policy (
  name TEXT NOT NULL,
  table_name TEXT,
  catalog_item TEXT,
  run_order INTEGER NOT NULL DEFAULT 100,
  condition_expr TEXT NOT NULL DEFAULT 'true',
  actions JSONB NOT NULL DEFAULT '[]',
  workspace TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (workspace, name)
);

CREATE TABLE IF NOT EXISTS catalog_item (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]',
  workflow TEXT,
  workspace TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (workspace, id)
);

CREATE TABLE IF NOT EXISTS order_guide (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]',
  rules JSONB NOT NULL DEFAULT '[]',
  workspace TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (workspace, id)
);

CREATE TABLE IF NOT EXISTS cart_line (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  variables JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_record (
  key TEXT NOT NULL,
  username TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key, username, endpoint)
);

CREATE TABLE IF NOT EXISTS workflow (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'flow',
  inputs JSONB NOT NULL DEFAULT '[]',
  outputs JSONB NOT NULL DEFAULT '[]',
  draft JSONB NOT NULL DEFAULT '[]',
  workspace TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (workspace, id)
);

CREATE TABLE IF NOT EXISTS workflow_version (
  id BIGSERIAL PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  withdrawn BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  workspace TEXT NOT NULL DEFAULT 'live'
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_version_idx
  ON workflow_version (workspace, workflow_id, version);

CREATE TABLE IF NOT EXISTS workflow_run (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  number TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  steps JSONB NOT NULL DEFAULT '[]',
  state JSONB NOT NULL DEFAULT '{}',
  simulated BOOLEAN NOT NULL DEFAULT FALSE,
  wake_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_article (
  number TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  keywords JSONB NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'draft',
  valid_until TEXT,
  helpful_yes INTEGER NOT NULL DEFAULT 0,
  helpful_no INTEGER NOT NULL DEFAULT 0,
  audience JSONB NOT NULL DEFAULT '{"roles":[],"departments":[]}',
  author TEXT,
  published_at TIMESTAMPTZ,
  PRIMARY KEY (number, version)
);

CREATE TABLE IF NOT EXISTS knowledge_vote (
  number TEXT NOT NULL,
  version INTEGER NOT NULL,
  username TEXT NOT NULL,
  helpful BOOLEAN NOT NULL,
  PRIMARY KEY (number, version, username)
);

CREATE TABLE IF NOT EXISTS inbox_item (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  event TEXT NOT NULL,
  text TEXT NOT NULL,
  number TEXT,
  at TIMESTAMPTZ NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  pending_digest BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS inbox_item_idx ON inbox_item (username, id);

CREATE TABLE IF NOT EXISTS inbox_rule (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  roles JSONB NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  workspace TEXT NOT NULL DEFAULT 'live'
);

CREATE TABLE IF NOT EXISTS saved_filter (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  filter_text TEXT NOT NULL,
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  owner TEXT,
  queue_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS dashboard (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  widgets JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS export_job (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  table_name TEXT NOT NULL,
  filter_text TEXT NOT NULL DEFAULT '',
  columns JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'queued',
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_done INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  object_key TEXT,
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS import_job (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  table_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  rows JSONB NOT NULL DEFAULT '[]',
  counts JSONB NOT NULL DEFAULT '{}',
  committed BOOLEAN NOT NULL DEFAULT FALSE,
  results JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS config_set (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  items JSONB NOT NULL DEFAULT '[]',
  object_key TEXT,
  exported_at TIMESTAMPTZ,
  committed_at TIMESTAMPTZ,
  snapshots JSONB,
  applied JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS config_item_origin (
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  content JSONB,
  PRIMARY KEY (kind, name)
);

CREATE TABLE IF NOT EXISTS presence (
  number TEXT NOT NULL,
  username TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (number, username)
);

CREATE TABLE IF NOT EXISTS background_state (
  key TEXT PRIMARY KEY,
  ran_through TIMESTAMPTZ NOT NULL
);
