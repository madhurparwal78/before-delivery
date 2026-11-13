export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  removed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  date_of_birth DATE,
  sex TEXT,
  state TEXT,
  time_zone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  postal_code TEXT,
  gate_notes TEXT,
  account_state TEXT NOT NULL DEFAULT 'active',
  erases_at TIMESTAMPTZ,
  erased_at TIMESTAMPTZ,
  minio_deletions_pending INTEGER NOT NULL DEFAULT 0,
  closure_requested_at TIMESTAMPTZ,
  kb_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  person_kind TEXT NOT NULL,
  person_id TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS phlebotomists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  states TEXT[] NOT NULL
);

CREATE TABLE IF NOT EXISTS draws (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  phlebotomist_id TEXT NOT NULL,
  state TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  collected_at TIMESTAMPTZ,
  kit_codes TEXT[] NOT NULL DEFAULT '{}',
  released_at TIMESTAMPTZ,
  released_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS visit_pages (
  token TEXT PRIMARY KEY,
  draw_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'live',
  ends_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  draw_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  marker TEXT NOT NULL,
  value TEXT NOT NULL,
  flag TEXT NOT NULL,
  age_band TEXT NOT NULL,
  range_low TEXT NOT NULL,
  range_high TEXT NOT NULL,
  range_optimal_low TEXT NOT NULL,
  range_optimal_high TEXT NOT NULL,
  range_effective_from TEXT NOT NULL,
  note TEXT,
  corrected_by TEXT,
  corrected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draw_id, marker)
);

CREATE TABLE IF NOT EXISTS result_history (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL,
  value TEXT NOT NULL,
  note TEXT,
  by TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS draw_reports (
  draw_id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS range_versions (
  id TEXT PRIMARY KEY,
  marker TEXT NOT NULL,
  effective_from DATE NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (marker, effective_from)
);

CREATE TABLE IF NOT EXISTS range_rows (
  version_id TEXT NOT NULL,
  sex TEXT NOT NULL,
  age_band TEXT NOT NULL,
  low TEXT NOT NULL,
  high TEXT NOT NULL,
  optimal_low TEXT NOT NULL,
  optimal_high TEXT NOT NULL,
  PRIMARY KEY (version_id, sex, age_band)
);

CREATE TABLE IF NOT EXISTS longevity_plans (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  state TEXT NOT NULL,
  based_on_plan_id TEXT,
  nutrition TEXT NOT NULL,
  movement TEXT NOT NULL,
  sleep TEXT NOT NULL,
  supplements TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  published_by TEXT,
  blend_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blends (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  items JSONB NOT NULL,
  morning_capsules INTEGER NOT NULL,
  evening_capsules INTEGER NOT NULL,
  list_price_cents INTEGER NOT NULL,
  member_price_cents INTEGER NOT NULL,
  saved_by TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  from_name TEXT NOT NULL,
  staff_id TEXT,
  body TEXT NOT NULL,
  attachment_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_threads (
  member_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  object_key_original TEXT NOT NULL,
  object_key_clean TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  member_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'free',
  cadence TEXT,
  renewal_date DATE,
  plus_until DATE,
  pending_cadence TEXT,
  pending_from DATE,
  kb_subscription_id TEXT,
  kb_plan_name TEXT,
  kb_charged_through DATE,
  join_requested_at TIMESTAMPTZ,
  last_kb_check_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  invoice_id TEXT NOT NULL UNIQUE,
  paid_at TIMESTAMPTZ NOT NULL,
  paid_date DATE NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  items JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_mail (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  member_id TEXT
);

CREATE TABLE IF NOT EXISTS request_keys (
  member_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key)
);

CREATE TABLE IF NOT EXISTS rate_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS seeding_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  done BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_draws_member ON draws(member_id);
CREATE INDEX IF NOT EXISTS idx_draws_starts ON draws(starts_at);
CREATE INDEX IF NOT EXISTS idx_draws_state ON draws(state);
CREATE INDEX IF NOT EXISTS idx_draws_phleb_slot ON draws(phlebotomist_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_results_member_marker ON results(member_id, marker);
CREATE INDEX IF NOT EXISTS idx_results_draw ON results(draw_id);
CREATE INDEX IF NOT EXISTS idx_messages_member ON messages(member_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_receipts_paid_date ON receipts(paid_date);
CREATE INDEX IF NOT EXISTS idx_pending_mail_unsent ON pending_mail(sent_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rate_events_member ON rate_events(member_id, kind, at);
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_visit_pages_draw_live ON visit_pages(draw_id) WHERE state = 'live';
`;
