// Schema (brief: Services › Postgres). Applied on every serve start; every statement is idempotent.
// Money is bigint centimes, quantities hundredths, pressures centibar, voltages centivolts,
// film build integer µm and odometer integer km.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  last_sign_in_at timestamptz,
  units_film text NOT NULL DEFAULT 'um',
  units_pressure text NOT NULL DEFAULT 'bar',
  units_distance text NOT NULL DEFAULT 'km',
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  signed_in_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('signed_out', 'revoked'))
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS bays (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  class text NOT NULL,
  length_mm integer NOT NULL,
  width_mm integer NOT NULL,
  row_no integer NOT NULL,
  column_no integer NOT NULL
);

CREATE TABLE IF NOT EXISTS cars (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id),
  year integer NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  registration text NOT NULL,
  colour text NOT NULL,
  length_mm integer NOT NULL,
  width_mm integer NOT NULL,
  odometer_km integer NOT NULL,
  tyre_spec_centibar integer NOT NULL,
  startup_schedule boolean NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_intake',
  bay_id text REFERENCES bays(id),
  intake_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  billing_status text NOT NULL DEFAULT 'none',
  billing_plan text,
  billing_monthly_centimes bigint,
  kb_subscription_id text,
  charged_through_date date,
  billing_end_date date,
  cancel_requested boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS cars_one_per_bay ON cars (bay_id) WHERE bay_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  car_id text NOT NULL REFERENCES cars(id),
  kind text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS items_car ON items (car_id);

CREATE TABLE IF NOT EXISTS movements (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  count integer NOT NULL,
  at timestamptz NOT NULL,
  by_id text NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS movements_item ON movements (item_id, at);

CREATE TABLE IF NOT EXISTS stay_claims (
  car_id text PRIMARY KEY REFERENCES cars(id),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS condition_reports (
  id text PRIMARY KEY,
  car_id text NOT NULL UNIQUE REFERENCES cars(id),
  sha256 text NOT NULL,
  size_bytes integer NOT NULL,
  uploaded_at timestamptz NOT NULL,
  uploaded_by text NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  car_id text NOT NULL REFERENCES cars(id),
  kind text NOT NULL,
  job_id text,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS photos_car ON photos (car_id, created_at);

CREATE TABLE IF NOT EXISTS care_entries (
  id text PRIMARY KEY,
  car_id text NOT NULL REFERENCES cars(id),
  at timestamptz NOT NULL,
  by_id text NOT NULL REFERENCES users(id),
  started boolean NOT NULL,
  battery_centivolts integer,
  tyre_fl integer,
  tyre_fr integer,
  tyre_rl integer,
  tyre_rr integer,
  note text NOT NULL DEFAULT '',
  flags text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS care_entries_car ON care_entries (car_id, at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  number text NOT NULL UNIQUE,
  car_id text NOT NULL REFERENCES cars(id),
  title text NOT NULL,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  sent_at timestamptz,
  expires_at timestamptz,
  approved_at timestamptz,
  declined_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE SEQUENCE IF NOT EXISTS job_number_seq START 1005;

CREATE TABLE IF NOT EXISTS job_lines (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id),
  position integer NOT NULL,
  kind text NOT NULL,
  description text NOT NULL,
  quantity_hundredths bigint NOT NULL,
  unit_price_centimes bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS job_lines_job ON job_lines (job_id, position);

CREATE TABLE IF NOT EXISTS stages (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id),
  stage_order integer NOT NULL,
  name text NOT NULL,
  logged_at timestamptz NOT NULL,
  logged_by text NOT NULL REFERENCES users(id),
  UNIQUE (job_id, stage_order)
);

CREATE TABLE IF NOT EXISTS readings (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id),
  stage_id text NOT NULL REFERENCES stages(id),
  panel text NOT NULL,
  film_um integer NOT NULL,
  logged_at timestamptz NOT NULL,
  logged_by text NOT NULL REFERENCES users(id),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS readings_job_panel ON readings (job_id, panel, logged_at);

CREATE TABLE IF NOT EXISTS invoice_numbers (
  year integer PRIMARY KEY,
  last integer NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  number text NOT NULL UNIQUE,
  job_id text NOT NULL UNIQUE REFERENCES jobs(id),
  car_id text NOT NULL REFERENCES cars(id),
  owner_id text NOT NULL REFERENCES users(id),
  killbill_invoice_id text NOT NULL,
  lines jsonb NOT NULL,
  net_centimes bigint NOT NULL,
  vat_centimes bigint NOT NULL,
  rounding_centimes bigint NOT NULL,
  total_centimes bigint NOT NULL,
  issued_at timestamptz NOT NULL,
  balance_centimes bigint NOT NULL,
  paid_at timestamptz,
  payments jsonb NOT NULL DEFAULT '[]',
  status_confirmed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_transfers (
  id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES invoices(id),
  killbill_payment_id text NOT NULL UNIQUE,
  reference text NOT NULL,
  amount_centimes bigint NOT NULL,
  recorded_by text NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
  id text PRIMARY KEY,
  car_id text NOT NULL REFERENCES cars(id),
  owner_id text NOT NULL REFERENCES users(id),
  slot text NOT NULL,
  status text NOT NULL,
  bay_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS releases_one_open_per_car ON releases (car_id) WHERE status IN ('requested', 'booked', 'staged');
CREATE UNIQUE INDEX IF NOT EXISTS releases_one_open_per_slot ON releases (slot) WHERE status IN ('requested', 'booked', 'staged');

CREATE TABLE IF NOT EXISTS release_events (
  id bigserial PRIMARY KEY,
  release_id text NOT NULL REFERENCES releases(id),
  status text NOT NULL,
  at timestamptz NOT NULL,
  by_id text NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id text NOT NULL REFERENCES users(id),
  route text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, route, key)
);

CREATE TABLE IF NOT EXISTS killbill_accounts (
  owner_id text PRIMARY KEY REFERENCES users(id),
  account_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_effects (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('subscription_create', 'subscription_cancel', 'email')),
  car_id text REFERENCES cars(id),
  payload jsonb NOT NULL DEFAULT '{}',
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS provider_effects_due ON provider_effects (available_at) WHERE done_at IS NULL;
`;
