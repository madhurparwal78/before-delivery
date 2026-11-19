export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS desks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_folded TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  public BOOL NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS desks_email_folded ON desks(email_folded);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  generation INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  telephone TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  notes TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  closed_at TIMESTAMPTZ,
  erase_at TIMESTAMPTZ,
  email_folded TEXT,
  telephone_folded TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customers_desk ON customers(desk_id);
CREATE INDEX IF NOT EXISTS customers_folded ON customers(desk_id, email_folded, telephone_folded);

CREATE TABLE IF NOT EXISTS rate_tables (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  effective_from DATE NOT NULL,
  default_margin_percent TEXT NOT NULL,
  waiting_rate_pennies BIGINT NOT NULL,
  second_driver_pennies BIGINT NOT NULL,
  deposit_minibus BIGINT NOT NULL,
  deposit_minibus_higher BIGINT NOT NULL,
  deposit_coach BIGINT NOT NULL,
  deposit_coach_higher BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS operators (
  desk_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  town TEXT,
  email TEXT,
  telephone TEXT,
  sizes INT[] NOT NULL DEFAULT '{}',
  listed BOOL NOT NULL DEFAULT TRUE,
  dbs_checked_on DATE,
  PRIMARY KEY (desk_id, id)
);

CREATE TABLE IF NOT EXISTS papers (
  desk_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ends_on DATE NOT NULL,
  stored BOOL NOT NULL DEFAULT FALSE,
  object_key TEXT,
  stored_type TEXT,
  paper_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  PRIMARY KEY (desk_id, operator_id, kind)
);

CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  customer_id TEXT,
  reference TEXT NOT NULL,
  occasion TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  journey_type TEXT NOT NULL DEFAULT 'oneWay',
  depart_date DATE NOT NULL,
  depart_time TEXT NOT NULL,
  depart_instant TIMESTAMPTZ NOT NULL,
  depart_repeated_hour TEXT,
  return_date DATE,
  return_time TEXT,
  return_instant TIMESTAMPTZ,
  return_repeated_hour TEXT,
  details TEXT,
  people INT NOT NULL DEFAULT 1,
  large INT NOT NULL DEFAULT 0,
  medium INT NOT NULL DEFAULT 0,
  hand INT NOT NULL DEFAULT 0,
  wheelchairs INT NOT NULL DEFAULT 0,
  name TEXT,
  email TEXT,
  telephone TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  submitted_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  merged_references TEXT[] NOT NULL DEFAULT '{}',
  duplicated TEXT,
  desk_notified_paper TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS enquiries_desk_state ON enquiries(desk_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS enquiries_desk_ref ON enquiries(desk_id, reference);

CREATE TABLE IF NOT EXISTS enquiry_stops (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL,
  desk_id TEXT NOT NULL,
  position INT NOT NULL,
  text TEXT NOT NULL,
  checked BOOL NOT NULL DEFAULT FALSE,
  flight_code TEXT
);
CREATE INDEX IF NOT EXISTS enquiry_stops_enquiry ON enquiry_stops(enquiry_id);

CREATE TABLE IF NOT EXISTS enquiry_rate_limit (
  desk_id TEXT NOT NULL,
  email_folded TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS enquiry_rate_idx ON enquiry_rate_limit(email_folded, created_at);

CREATE TABLE IF NOT EXISTS hires (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  occasion TEXT NOT NULL,
  stage TEXT NOT NULL,
  enquiry_state TEXT NOT NULL DEFAULT 'new',
  depart_date DATE NOT NULL,
  depart_time TEXT NOT NULL,
  depart_instant TIMESTAMPTZ NOT NULL,
  return_date DATE,
  return_time TEXT,
  return_instant TIMESTAMPTZ,
  quote_version INT NOT NULL DEFAULT 1,
  quote_sent_at TIMESTAMPTZ,
  quote_ends_at TIMESTAMPTZ,
  quote_path TEXT,
  quote_mailed BOOLEAN NOT NULL DEFAULT FALSE,
  rate_table_id TEXT,
  cancelled BOOL NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS hires_desk_ref ON hires(desk_id, reference);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  seats INT NOT NULL,
  position INT NOT NULL,
  operator_id TEXT,
  bought_pennies BIGINT,
  margin_percent TEXT,
  selling_pennies BIGINT NOT NULL DEFAULT 0,
  vat_pennies BIGINT NOT NULL DEFAULT 0,
  total_pennies BIGINT NOT NULL DEFAULT 0,
  deposit_pennies BIGINT NOT NULL DEFAULT 0,
  deposit_fixed BOOL NOT NULL DEFAULT FALSE,
  depart_date DATE,
  depart_time TEXT,
  depart_instant TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  number INT NOT NULL,
  hire_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  driver_name TEXT,
  driver_telephone TEXT,
  driver_folded TEXT,
  told_at TIMESTAMPTZ,
  confirmed BOOL NOT NULL DEFAULT FALSE,
  sheet_path TEXT,
  second_driver BOOL NOT NULL DEFAULT FALSE,
  depart_date DATE NOT NULL,
  depart_time TEXT NOT NULL,
  depart_instant TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_desk_number ON runs(desk_id, number);

CREATE TABLE IF NOT EXISTS duty_blocks (
  run_id TEXT NOT NULL,
  desk_id TEXT NOT NULL,
  position INT NOT NULL,
  kind TEXT NOT NULL,
  minutes INT NOT NULL,
  PRIMARY KEY (run_id, position)
);

CREATE TABLE IF NOT EXISTS bids (
  desk_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  ask_path TEXT NOT NULL,
  asked_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  prices TEXT[] NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  PRIMARY KEY (desk_id, enquiry_id, operator_id)
);

CREATE TABLE IF NOT EXISTS awards (
  desk_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL PRIMARY KEY,
  operator_id TEXT NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL,
  mailed INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plan_saves (
  desk_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  sizes INT[] NOT NULL,
  suggested INT[] NOT NULL,
  larger_than_needed BOOL NOT NULL DEFAULT FALSE,
  PRIMARY KEY (desk_id, enquiry_id)
);

CREATE TABLE IF NOT EXISTS legs (
  enquiry_id TEXT NOT NULL,
  desk_id TEXT NOT NULL,
  position INT NOT NULL,
  km TEXT NOT NULL,
  miles TEXT NOT NULL,
  minutes INT NOT NULL,
  PRIMARY KEY (enquiry_id, position)
);

CREATE TABLE IF NOT EXISTS ledger_lines (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  movement_id TEXT NOT NULL,
  movement_kind TEXT NOT NULL DEFAULT 'payment',
  vehicle_id TEXT,
  account TEXT NOT NULL,
  amount_pennies BIGINT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  description TEXT
);
CREATE INDEX IF NOT EXISTS ledger_desk ON ledger_lines(desk_id);
CREATE INDEX IF NOT EXISTS ledger_hire ON ledger_lines(hire_id);

CREATE TABLE IF NOT EXISTS statements (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  brought_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS statements_desk_fingerprint ON statements(desk_id, fingerprint);

CREATE TABLE IF NOT EXISTS statement_rows (
  desk_id TEXT NOT NULL,
  statement_id TEXT NOT NULL,
  row_number INT NOT NULL,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount_pennies BIGINT NOT NULL,
  balance_pennies BIGINT,
  reference TEXT,
  already_seen BOOL NOT NULL DEFAULT FALSE,
  PRIMARY KEY (statement_id, row_number)
);

CREATE TABLE IF NOT EXISTS quote_tokens (
  token TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  replaced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bid_tokens (
  token TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS run_tokens (
  token TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS run_presses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  repeat_key TEXT NOT NULL,
  status_code INT NOT NULL DEFAULT 201
);
CREATE UNIQUE INDEX IF NOT EXISTS run_presses_repeat ON run_presses(run_id, stop_id, kind, repeat_key);

CREATE TABLE IF NOT EXISTS run_charges (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stop_id TEXT,
  kind TEXT NOT NULL,
  minutes INT NOT NULL,
  amount_pennies BIGINT NOT NULL,
  accepted BOOL NOT NULL DEFAULT FALSE,
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS passengers (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  name TEXT NOT NULL,
  "group" TEXT,
  needs TEXT,
  listed_twice BOOL NOT NULL DEFAULT FALSE,
  wheelchair BOOL NOT NULL DEFAULT FALSE,
  position INT NOT NULL,
  seat TEXT,
  vehicle_id TEXT
);

CREATE TABLE IF NOT EXISTS passenger_files (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'waiting',
  number TEXT,
  object_key TEXT,
  customer_name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  history JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS documents_desk ON documents(desk_id);

CREATE TABLE IF NOT EXISTS document_numbers (
  desk_id TEXT NOT NULL,
  kind_prefix TEXT NOT NULL,
  year INT NOT NULL,
  last_number INT NOT NULL,
  PRIMARY KEY (desk_id, kind_prefix, year)
);

CREATE TABLE IF NOT EXISTS file_rate (
  desk_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (desk_id, hire_id, vehicle_id)
);

CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  reply_due DATE NOT NULL,
  holiday_line TEXT
);

CREATE TABLE IF NOT EXISTS lost_items (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  description TEXT NOT NULL,
  found_on DATE NOT NULL,
  held_to DATE NOT NULL,
  state TEXT NOT NULL DEFAULT 'held',
  owner_details TEXT,
  returned_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS holiday_cache (
  desk_id TEXT PRIMARY KEY,
  dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL,
  ok BOOL NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_runs (
  desk_id TEXT NOT NULL,
  day TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  done BOOL NOT NULL DEFAULT FALSE,
  PRIMARY KEY (desk_id, day, hire_id, kind)
);

CREATE TABLE IF NOT EXISTS sheet_review (
  desk_id TEXT NOT NULL,
  row_number INT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (desk_id, row_number, created_at)
);

CREATE TABLE IF NOT EXISTS statement_previews (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS statement_previews_desk ON statement_previews(desk_id);

CREATE TABLE IF NOT EXISTS hire_changes (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_data JSONB,
  new_data JSONB,
  price_moved BOOL NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS cancellations (
  id TEXT PRIMARY KEY,
  desk_id TEXT NOT NULL,
  hire_id TEXT NOT NULL,
  notice_at TIMESTAMPTZ NOT NULL,
  by TEXT NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]'
);

ALTER TABLE hires ADD COLUMN IF NOT EXISTS deposit_said_sent TIMESTAMPTZ;
ALTER TABLE hires ADD COLUMN IF NOT EXISTS quote_version_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS desks_generation (
  desk_id TEXT PRIMARY KEY,
  generation INT NOT NULL DEFAULT 0
);
`;
