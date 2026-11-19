-- Switchyard schema. Applied idempotently on every serve.

CREATE TABLE IF NOT EXISTS settings (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequences (
  name  TEXT PRIMARY KEY,
  next  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS people (
  username      TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  department    TEXT REFERENCES departments(name),
  roles         TEXT[],
  password_hash TEXT,
  time_zone     TEXT NOT NULL DEFAULT 'Europe/Berlin',
  out_of_office BOOLEAN NOT NULL DEFAULT FALSE,
  capacity      INTEGER,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  digest        TEXT NOT NULL DEFAULT 'immediate',
  delegate      TEXT,
  delegate_from TIMESTAMPTZ,
  delegate_to   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  name              TEXT PRIMARY KEY,
  members           TEXT[] NOT NULL DEFAULT '{}',
  escalation_policy TEXT,
  rr_pointer        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedules (
  name      TEXT PRIMARY KEY,
  time_zone TEXT NOT NULL,
  hours     JSONB NOT NULL,
  holidays  TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sla_definitions (
  name       TEXT PRIMARY KEY,
  "table"    TEXT NOT NULL,
  start_expr TEXT NOT NULL,
  pause_expr TEXT NOT NULL,
  stop_expr  TEXT NOT NULL,
  schedule   TEXT NOT NULL REFERENCES schedules(name),
  targets    JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  number        TEXT PRIMARY KEY,
  "table"       TEXT NOT NULL,
  state         TEXT NOT NULL,
  workspace     TEXT NOT NULL DEFAULT 'live',
  fields        JSONB NOT NULL DEFAULT '{}',
  priority_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL,
  created_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS records_table_idx ON records("table", workspace);
CREATE INDEX IF NOT EXISTS records_state_idx ON records(state);

CREATE TABLE IF NOT EXISTS field_versions (
  record  TEXT NOT NULL REFERENCES records(number) ON DELETE CASCADE,
  field   TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (record, field)
);

CREATE TABLE IF NOT EXISTS state_history (
  record  TEXT NOT NULL REFERENCES records(number) ON DELETE CASCADE,
  state   TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS state_history_record_idx ON state_history(record);

CREATE TABLE IF NOT EXISTS record_links (
  kind   TEXT NOT NULL,          -- parent | problem | fix_change | incident
  parent TEXT NOT NULL REFERENCES records(number) ON DELETE CASCADE,
  child  TEXT NOT NULL REFERENCES records(number) ON DELETE CASCADE,
  PRIMARY KEY (kind, parent, child)
);

CREATE TABLE IF NOT EXISTS activity (
  id          BIGSERIAL PRIMARY KEY,
  record      TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL,
  actor       TEXT NOT NULL,
  acting_for  TEXT,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_record_idx ON activity(record);

CREATE TABLE IF NOT EXISTS audit (
  id          BIGSERIAL PRIMARY KEY,
  record      TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL,
  actor       TEXT NOT NULL,
  acting_for  TEXT,
  field       TEXT NOT NULL,
  before      TEXT,
  after       TEXT,
  reason      TEXT
);
CREATE INDEX IF NOT EXISTS audit_record_idx ON audit(record);

CREATE TABLE IF NOT EXISTS slas (
  id           TEXT PRIMARY KEY,
  record       TEXT NOT NULL REFERENCES records(number) ON DELETE CASCADE,
  definition   TEXT NOT NULL,
  priority     INTEGER NOT NULL,
  stage        TEXT NOT NULL,
  start_at     TIMESTAMPTZ NOT NULL,
  target_secs  INTEGER NOT NULL,
  paused_secs  INTEGER NOT NULL DEFAULT 0,
  breached     BOOLEAN NOT NULL DEFAULT FALSE,
  thresholds   JSONB NOT NULL DEFAULT '{}',
  stop_elapsed INTEGER,
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS slas_record_idx ON slas(record);

CREATE TABLE IF NOT EXISTS cis (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  "class"           TEXT NOT NULL,
  criticality       INTEGER NOT NULL,
  business_critical BOOLEAN NOT NULL DEFAULT FALSE,
  owner_department  TEXT,
  status            TEXT NOT NULL DEFAULT 'healthy',
  attributes        JSONB NOT NULL DEFAULT '{}',
  used_by_departments TEXT[] NOT NULL DEFAULT '{}',
  used_by_people    TEXT[] NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cis_name_ci_idx ON cis(lower(name));

CREATE TABLE IF NOT EXISTS relationships (
  source TEXT NOT NULL REFERENCES cis(name) ON DELETE CASCADE,
  type   TEXT NOT NULL,
  target TEXT NOT NULL REFERENCES cis(name) ON DELETE CASCADE,
  PRIMARY KEY (source, type, target)
);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id   BIGSERIAL PRIMARY KEY,
  ci   TEXT NOT NULL REFERENCES cis(name) ON DELETE CASCADE,
  start TIMESTAMPTZ NOT NULL,
  "end" TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS major_proposals (
  id BIGSERIAL PRIMARY KEY,
  ci TEXT NOT NULL,
  reason TEXT NOT NULL,
  business_critical_affected INTEGER NOT NULL,
  linked_open_incidents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  incident TEXT
);

CREATE TABLE IF NOT EXISTS freeze_windows (
  name TEXT PRIMARY KEY,
  start TIMESTAMPTZ NOT NULL,
  "end" TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL,
  scope_kind TEXT NOT NULL DEFAULT 'all',
  scope_items TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS boards (
  name TEXT PRIMARY KEY,
  rule TEXT NOT NULL,
  n INTEGER,
  threshold_percent INTEGER,
  window_hours INTEGER NOT NULL DEFAULT 48,
  members JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_steps (
  id BIGSERIAL PRIMARY KEY,
  change TEXT NOT NULL REFERENCES records(number) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  name TEXT NOT NULL,
  rule TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  voters JSONB NOT NULL,
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS votes (
  id BIGSERIAL PRIMARY KEY,
  step_id BIGINT NOT NULL REFERENCES approval_steps(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  voted_by TEXT NOT NULL,
  decision TEXT NOT NULL,
  comment TEXT,
  at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS delegations (
  id BIGSERIAL PRIMARY KEY,
  member TEXT NOT NULL,
  delegate TEXT NOT NULL,
  from_t TIMESTAMPTZ NOT NULL,
  to_t TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS rotations (
  name TEXT PRIMARY KEY,
  time_zone TEXT NOT NULL,
  handover_weekday TEXT NOT NULL,
  handover_time TEXT NOT NULL,
  members TEXT[] NOT NULL,
  anchor_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rotation_overrides (
  id BIGSERIAL PRIMARY KEY,
  rotation TEXT NOT NULL REFERENCES rotations(name) ON DELETE CASCADE,
  username TEXT NOT NULL,
  start TIMESTAMPTZ NOT NULL,
  "end" TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escalation_policies (
  name TEXT PRIMARY KEY,
  levels JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  record TEXT NOT NULL REFERENCES records(number) ON DELETE CASCADE,
  policy TEXT NOT NULL,
  status TEXT NOT NULL,
  level INTEGER NOT NULL,
  levels JSONB NOT NULL,
  acknowledged_by TEXT,
  acknowledged_level INTEGER,
  late BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS business_rules (
  name TEXT,
  "table" TEXT NOT NULL,
  "when" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 100,
  operations TEXT[] NOT NULL DEFAULT '{insert,update}',
  condition TEXT NOT NULL,
  actions JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  workspace TEXT NOT NULL DEFAULT 'live',
  UNIQUE (name, workspace)
);

CREATE TABLE IF NOT EXISTS access_rules (
  name TEXT,
  type TEXT NOT NULL,
  "table" TEXT NOT NULL,
  field TEXT,
  operation TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  condition TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  workspace TEXT NOT NULL DEFAULT 'live',
  UNIQUE (name, workspace)
);

CREATE TABLE IF NOT EXISTS form_policies (
  name TEXT,
  "table" TEXT,
  catalog_item TEXT,
  "order" INTEGER NOT NULL DEFAULT 100,
  condition TEXT NOT NULL,
  actions JSONB NOT NULL,
  workspace TEXT NOT NULL DEFAULT 'live',
  UNIQUE (name, workspace)
);

CREATE TABLE IF NOT EXISTS assignment_rules (
  name TEXT,
  "order" INTEGER NOT NULL DEFAULT 100,
  "table" TEXT NOT NULL,
  condition TEXT NOT NULL,
  "group" TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  workspace TEXT NOT NULL DEFAULT 'live',
  UNIQUE (name, workspace)
);

CREATE TABLE IF NOT EXISTS workflows (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'flow',
  inputs JSONB NOT NULL DEFAULT '[]',
  outputs JSONB NOT NULL DEFAULT '[]',
  draft JSONB NOT NULL DEFAULT '[]',
  workspace TEXT NOT NULL DEFAULT 'live'
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  workflow BIGINT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  steps JSONB NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  withdrawn BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (workflow, version)
);

CREATE TABLE IF NOT EXISTS runs (
  id BIGSERIAL PRIMARY KEY,
  workflow BIGINT NOT NULL REFERENCES workflows(id),
  version INTEGER NOT NULL,
  record TEXT,
  status TEXT NOT NULL,
  steps JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  current JSONB,
  simulated BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  event TEXT NOT NULL,
  text TEXT NOT NULL,
  record TEXT,
  at TIMESTAMPTZ NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  held BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS inbox_user_idx ON inbox_items(username, at DESC);

CREATE TABLE IF NOT EXISTS inbox_rules (
  seq BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  impersonating TEXT,
  workspace TEXT NOT NULL DEFAULT 'live',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS impersonation_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT,
  name TEXT NOT NULL,
  variables JSONB NOT NULL,
  workflow TEXT NOT NULL,
  workspace TEXT NOT NULL DEFAULT 'live',
  UNIQUE (id, workspace)
);

CREATE TABLE IF NOT EXISTS guides (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  questions JSONB NOT NULL,
  rules JSONB NOT NULL,
  workspace TEXT NOT NULL DEFAULT 'live'
);

CREATE TABLE IF NOT EXISTS cart_lines (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  variables JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  record TEXT NOT NULL,
  name TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  uploader TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  stored_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS attachments_record_idx ON attachments(record);

CREATE TABLE IF NOT EXISTS attachment_blobs (
  id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  data BYTEA NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  number TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  state TEXT NOT NULL,
  valid_until TEXT,
  helpful_yes INTEGER NOT NULL DEFAULT 0,
  helpful_no INTEGER NOT NULL DEFAULT 0,
  audience_roles TEXT[] NOT NULL DEFAULT '{}',
  audience_departments TEXT[] NOT NULL DEFAULT '{}',
  author TEXT,
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS article_votes (
  article TEXT NOT NULL REFERENCES articles(number) ON DELETE CASCADE,
  username TEXT NOT NULL,
  helpful BOOLEAN NOT NULL,
  PRIMARY KEY (article, username)
);

CREATE TABLE IF NOT EXISTS filters (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  "table" TEXT NOT NULL,
  filter TEXT NOT NULL,
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  owner TEXT
);

CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  widgets JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id BIGSERIAL PRIMARY KEY,
  owner TEXT NOT NULL,
  "table" TEXT NOT NULL,
  filter TEXT NOT NULL DEFAULT '',
  columns TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_done INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imports (
  id BIGSERIAL PRIMARY KEY,
  "table" TEXT NOT NULL,
  key TEXT NOT NULL,
  filename TEXT,
  mapping JSONB,
  rows JSONB NOT NULL DEFAULT '[]',
  counts JSONB NOT NULL,
  committed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_sets (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  items JSONB NOT NULL DEFAULT '[]',
  key TEXT,
  snapshots JSONB NOT NULL DEFAULT '[]',
  applied_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS config_promotions (
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  set_id BIGINT NOT NULL REFERENCES config_sets(id),
  at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (kind, name)
);

CREATE TABLE IF NOT EXISTS presence (
  record TEXT NOT NULL,
  username TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (record, username)
);

CREATE TABLE IF NOT EXISTS rate_events (
  bucket TEXT NOT NULL,
  at_ms BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_idx ON rate_events(bucket, at_ms);

CREATE TABLE IF NOT EXISTS request_items_meta (
  number TEXT PRIMARY KEY REFERENCES records(number) ON DELETE CASCADE,
  request TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  variables JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS requests_meta (
  number TEXT PRIMARY KEY REFERENCES records(number) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'open',
  requested_by TEXT NOT NULL,
  requested_for TEXT
);

CREATE TABLE IF NOT EXISTS import_ids (
  id BIGSERIAL PRIMARY KEY
);
