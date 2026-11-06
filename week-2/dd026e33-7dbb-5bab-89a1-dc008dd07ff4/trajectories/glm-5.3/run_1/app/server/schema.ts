import type { Db } from './db.ts';

/**
 * Idempotent schema application; safe to run on every serve start.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('concierge','care_technician','workshop_lead','house_manager','owner')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  units_film TEXT NOT NULL DEFAULT 'um',
  units_pressure TEXT NOT NULL DEFAULT 'bar',
  units_distance TEXT NOT NULL DEFAULT 'km'
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  end_reason TEXT CHECK (end_reason IN ('signed_out','revoked'))
);

CREATE TABLE IF NOT EXISTS owners (
  user_id TEXT PRIMARY KEY REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cars (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  registration TEXT NOT NULL,
  colour TEXT NOT NULL,
  length_mm INTEGER NOT NULL,
  width_mm INTEGER NOT NULL,
  odometer_km INTEGER NOT NULL,
  tyre_spec_bar TEXT NOT NULL,
  startup_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('awaiting_intake','stored','released')),
  bay_id TEXT,
  intake_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  bay_subscription_id TEXT,
  bay_billing_charged_through TEXT,
  bay_billing_plan_price TEXT,
  bay_billing_cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  bay_billing_end_date TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bays (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('standard','covered_lift','sealed_capsule')),
  length_mm INTEGER NOT NULL,
  width_mm INTEGER NOT NULL,
  row_index INTEGER NOT NULL,
  column_index INTEGER NOT NULL,
  UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS belongings (
  id TEXT PRIMARY KEY,
  car_id TEXT NOT NULL REFERENCES cars(id),
  kind TEXT NOT NULL CHECK (kind IN ('key_set','cover','spare_wheel','document')),
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY,
  belonging_id TEXT NOT NULL REFERENCES belongings(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  count INTEGER NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  by_user_id TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS stay_claims (
  car_id TEXT PRIMARY KEY REFERENCES cars(id),
  claimed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS condition_reports (
  id TEXT PRIMARY KEY,
  car_id TEXT NOT NULL REFERENCES cars(id),
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL,
  uploaded_by_user_id TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  car_id TEXT NOT NULL REFERENCES cars(id),
  kind TEXT NOT NULL CHECK (kind IN ('intake','stage')),
  job_id TEXT,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  attached BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS care_entries (
  id TEXT PRIMARY KEY,
  car_id TEXT NOT NULL REFERENCES cars(id),
  at TIMESTAMPTZ NOT NULL,
  by_user_id TEXT NOT NULL REFERENCES users(id),
  started BOOLEAN NOT NULL,
  battery_v TEXT,
  tyre_fl TEXT, tyre_fr TEXT, tyre_rl TEXT, tyre_rr TEXT,
  note TEXT NOT NULL DEFAULT '',
  flags TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  car_id TEXT NOT NULL REFERENCES cars(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','sent','approved','declined','expired','in_progress','finished','invoiced','paid')),
  version INTEGER NOT NULL DEFAULT 1,
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS job_lines (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('part','labour','paint_materials')),
  description TEXT NOT NULL,
  quantity TEXT NOT NULL,
  unit_price TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL,
  UNIQUE (job_id, name)
);

CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  panel TEXT NOT NULL,
  film_um INTEGER NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL,
  logged_by_user_id TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_readings_stage ON readings (stage_id, panel, logged_at);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  net_total TEXT NOT NULL,
  vat_total TEXT NOT NULL,
  rounding TEXT NOT NULL,
  total TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  balance TEXT NOT NULL,
  balance_live BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  status_confirmed_at TIMESTAMPTZ,
  killbill_invoice_id TEXT
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity TEXT NOT NULL,
  unit_price TEXT NOT NULL,
  net TEXT NOT NULL,
  vat TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  reference TEXT NOT NULL,
  amount TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
  killbill_payment_id TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount TEXT NOT NULL,
  refunded TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  transfer_id TEXT REFERENCES transfers(id)
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  car_id TEXT NOT NULL REFERENCES cars(id),
  slot TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','booked','staged','released','cancelled')),
  created_at TIMESTAMPTZ NOT NULL,
  bay_code TEXT
);

CREATE TABLE IF NOT EXISTS release_events (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  by_user_id TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS idempotency (
  user_id TEXT NOT NULL,
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, route, key)
);

CREATE TABLE IF NOT EXISTS queue (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('killbill_account','killbill_subscription','killbill_subscription_cancel','email')),
  payload TEXT NOT NULL,
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_queue_pending ON queue (id) WHERE claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cars_owner ON cars (owner_id);
CREATE INDEX IF NOT EXISTS idx_movements_belonging ON movements (belonging_id);
CREATE INDEX IF NOT EXISTS idx_care_entries_car ON care_entries (car_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_job ON readings (job_id, panel);
`;

export async function applySchema(db: Db): Promise<void> {
  await db.pool.query(SCHEMA);
}
