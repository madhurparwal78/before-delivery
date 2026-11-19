-- Fio Contado Desk schema. Exact decimals as TEXT, instants as TEXT whole-second Z.

CREATE TABLE IF NOT EXISTS desks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  ends_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  closed_at TEXT,
  erase_at TEXT,
  erasure_started_at TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  town TEXT NOT NULL,
  language TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  first_sent_at TEXT,
  UNIQUE (label_id, name)
);

CREATE TABLE IF NOT EXISTS styles (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  style_code TEXT,
  name TEXT NOT NULL,
  season TEXT NOT NULL,
  gtin TEXT NOT NULL,
  garment TEXT NOT NULL DEFAULT 'tshirt',
  washes INT NOT NULL DEFAULT 30,
  repair_service BOOLEAN,
  range_size INT,
  notes TEXT,
  state TEXT NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  changed_at TEXT NOT NULL,
  changed_by TEXT
);

CREATE TABLE IF NOT EXISTS lines (
  id TEXT PRIMARY KEY,
  style_id TEXT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  position INT NOT NULL,
  material_id TEXT NOT NULL,
  fabric_weight_gsm TEXT,
  area_m2 TEXT,
  mass_grams TEXT NOT NULL,
  tier1_factory TEXT, tier1_town TEXT, tier1_country TEXT,
  tier2_factory TEXT, tier2_town TEXT, tier2_country TEXT,
  tier3_factory TEXT, tier3_town TEXT, tier3_country TEXT,
  answered_energy_mj TEXT,
  answered_water_l TEXT,
  answered_fibre_origin TEXT
);

CREATE TABLE IF NOT EXISTS line_fibres (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  position INT NOT NULL,
  name TEXT NOT NULL,
  share_percent TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legs (
  id TEXT PRIMARY KEY,
  style_id TEXT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  position INT NOT NULL,
  mode TEXT NOT NULL,
  km TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  style_id TEXT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  line_id TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  town TEXT NOT NULL,
  language TEXT NOT NULL,
  questions TEXT[] NOT NULL,
  due_date TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'sent',
  sent_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reminded_at TEXT,
  answered_at TEXT,
  token TEXT UNIQUE,
  token_ends_at TEXT
);

CREATE TABLE IF NOT EXISTS answers (
  request_id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  energy_value TEXT,
  energy_unit TEXT,
  energy_mj TEXT,
  water_l TEXT,
  fibre_origin TEXT,
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  answered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INT NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  factory_name TEXT NOT NULL,
  town TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  meter INT NOT NULL,
  value TEXT NOT NULL,
  unit TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  keep_mine BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS reading_keys (
  request_key TEXT PRIMARY KEY,
  status INT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  style_id TEXT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  desk_id TEXT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  edition TEXT NOT NULL,
  worked_out_at TEXT NOT NULL,
  data_quality_percent INT NOT NULL,
  data_quality_grade TEXT NOT NULL,
  factor_rows JSONB NOT NULL,
  measures JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  style_id TEXT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  changes JSONB NOT NULL,
  measures JSONB NOT NULL,
  differences JSONB NOT NULL,
  saved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  style_id TEXT PRIMARY KEY REFERENCES styles(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  score INT,
  per_100g INT,
  run_id TEXT,
  shown TEXT,
  worst_case_facts TEXT[] NOT NULL DEFAULT '{}',
  busy_until TEXT,
  inputs_hash TEXT,
  inputs_body JSONB,
  asked_at TEXT
);

CREATE TABLE IF NOT EXISTS passports (
  id TEXT PRIMARY KEY,
  style_id TEXT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  gtin TEXT NOT NULL,
  edition INT NOT NULL,
  state TEXT NOT NULL DEFAULT 'published',
  published_at TEXT NOT NULL,
  snapshot JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS passports_gtin_active ON passports (gtin) WHERE state = 'published';

CREATE TABLE IF NOT EXISTS dossiers (
  id TEXT PRIMARY KEY,
  style_id TEXT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  result_id TEXT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  desk_id TEXT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  edition TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'making',
  made_at TEXT NOT NULL,
  signed_off_by TEXT,
  signed_off_at TEXT,
  pdf_key TEXT
);

CREATE TABLE IF NOT EXISTS sign_off_pages (
  token TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_requests (
  desk_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_requests_idx ON rate_requests (desk_id, kind, at);

CREATE TABLE IF NOT EXISTS factor_reads (
  id SERIAL PRIMARY KEY,
  desk_id TEXT NOT NULL,
  editions JSONB NOT NULL,
  read_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_queue (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS seed_flag (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
