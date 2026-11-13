-- Twohouse schema, applied idempotently on every serve.

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  planning_name TEXT NOT NULL,
  planning_email TEXT NOT NULL,
  planning_password_hash TEXT NOT NULL,
  other_name TEXT NOT NULL,
  other_email TEXT NOT NULL,
  other_password_hash TEXT,
  other_joined_at TIMESTAMPTZ,
  log_seq BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS households_planning_email_key
  ON households (lower(planning_email));
CREATE UNIQUE INDEX IF NOT EXISTS households_other_email_key
  ON households (lower(other_email));

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('planning','other')),
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sign_in_failures (
  email TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sign_in_failures_email_at_key
  ON sign_in_failures (email, at);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invites_household_key ON invites (household_id);

CREATE TABLE IF NOT EXISTS plan_versions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  number INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','adopted')),
  effective_from DATE NOT NULL,
  exchange_zone TEXT NOT NULL,
  first_exchange_at TEXT NOT NULL,
  base_pattern TEXT NOT NULL,
  base_anchor DATE NOT NULL,
  split_planning_bp INT NOT NULL,
  split_other_bp INT NOT NULL,
  max_consecutive_nights INT,
  body JSONB NOT NULL,
  etag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, number)
);
CREATE INDEX IF NOT EXISTS plan_versions_household_key ON plan_versions (household_id);

CREATE TABLE IF NOT EXISTS swaps (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  nights_start DATE NOT NULL,
  nights_end DATE NOT NULL,
  makeup_start DATE,
  makeup_end DATE,
  to_parent TEXT NOT NULL CHECK (to_parent IN ('planning','other')),
  created_by TEXT NOT NULL CHECK (created_by IN ('planning','other')),
  note TEXT,
  state TEXT NOT NULL CHECK (state IN ('draft','sent','accepted','declined','lapsed','withdrawn','settled')),
  sent_at TIMESTAMPTZ,
  answer_by TIMESTAMPTZ,
  answer_zone TEXT,
  answered_at TIMESTAMPTZ,
  decline_reason TEXT,
  reminder_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ,
  etag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS swaps_household_key ON swaps (household_id);

CREATE TABLE IF NOT EXISTS costs (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('medical','school','activities','child_care','clothing','other')),
  note TEXT,
  amount_minor BIGINT NOT NULL,
  incurred_at TEXT NOT NULL,
  custody_day DATE NOT NULL,
  paid_by TEXT NOT NULL CHECK (paid_by IN ('planning','other')),
  version_id TEXT NOT NULL REFERENCES plan_versions(id),
  agreed_split_bp INT,
  split_planning_bp INT NOT NULL,
  split_other_bp INT NOT NULL,
  share_planning BIGINT NOT NULL,
  share_other BIGINT NOT NULL,
  owed_minor BIGINT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft','sent','accepted','declined','lapsed','withdrawn','settled')),
  sent_at TIMESTAMPTZ,
  answer_by TIMESTAMPTZ,
  answer_zone TEXT,
  answered_at TIMESTAMPTZ,
  decline_reason TEXT,
  reminder_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ,
  etag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS costs_household_key ON costs (household_id);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  cost_id TEXT NOT NULL REFERENCES costs(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_cost_key ON receipts (cost_id);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  year INT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('requested','rendering','stored','failed','cancelled')),
  attempts INT NOT NULL DEFAULT 0,
  steps_done INT NOT NULL DEFAULT 0 CHECK (steps_done BETWEEN 0 AND 3),
  waiting_on TEXT CHECK (waiting_on IN ('renderer','storage')),
  failure TEXT CHECK (failure IN ('renderer_unavailable','storage_unavailable')),
  year_digest TEXT,
  pdf_bytes BIGINT,
  pdf_sha256 TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stored_at TIMESTAMPTZ,
  worker_lease_until TIMESTAMPTZ,
  worker_fence BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS records_household_key ON records (household_id);

CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS share_links_household_key ON share_links (household_id);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  link TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','superseded')),
  attempts INT NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  attempt_failed_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  claim_fence BIGINT NOT NULL DEFAULT 0,
  linked_id TEXT
);
CREATE INDEX IF NOT EXISTS notices_household_key ON notices (household_id);
CREATE INDEX IF NOT EXISTS notices_status_key ON notices (status);

CREATE TABLE IF NOT EXISTS log_entries (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL CHECK (actor IN ('planning','other','system')),
  type TEXT NOT NULL,
  subject_id TEXT,
  PRIMARY KEY (household_id, seq)
);

CREATE TABLE IF NOT EXISTS idempotency (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  status INT NOT NULL,
  response_body TEXT NOT NULL,
  response_headers JSONB NOT NULL,
  in_flight BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key, method, path)
);

CREATE TABLE IF NOT EXISTS statements (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  body JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS year_docs (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  year INT NOT NULL,
  body TEXT NOT NULL,
  digest TEXT NOT NULL,
  PRIMARY KEY (household_id, year)
);
