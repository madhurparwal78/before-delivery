export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS orgs (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  minimum_minutes integer NOT NULL,
  increment_minutes integer NOT NULL,
  rotation_interval_minutes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_rates (
  contract_id text NOT NULL REFERENCES contracts(id),
  effective_from date NOT NULL,
  hourly_rate_cents integer NOT NULL,
  team_surcharge_bp integer NOT NULL,
  mileage_cents_per_mile integer NOT NULL,
  PRIMARY KEY (contract_id, effective_from)
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  org_id text REFERENCES orgs(id),
  initials text,
  phone text,
  home_city text,
  pay_rate_cents integer
);

CREATE TABLE IF NOT EXISTS credentials (
  user_id text NOT NULL REFERENCES users(id),
  code text NOT NULL,
  expires_on date NOT NULL,
  PRIMARY KEY (user_id, code)
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  org_id text NOT NULL REFERENCES orgs(id),
  requester_id text NOT NULL REFERENCES users(id),
  setting text NOT NULL,
  title text NOT NULL,
  location text NOT NULL,
  onsite_contact_name text NOT NULL,
  onsite_contact_phone text NOT NULL,
  consumer_name text NOT NULL,
  start_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  assignment_date date NOT NULL,
  status text NOT NULL,
  seat_count integer NOT NULL,
  open_call_closes_at timestamptz,
  requester_notes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS bookings_assignment_date_idx ON bookings (assignment_date);

CREATE TABLE IF NOT EXISTS seats (
  booking_id text NOT NULL REFERENCES bookings(id),
  seat integer NOT NULL,
  holder_id text REFERENCES users(id),
  held_at timestamptz,
  PRIMARY KEY (booking_id, seat)
);

CREATE INDEX IF NOT EXISTS seats_holder_idx ON seats (holder_id);

CREATE TABLE IF NOT EXISTS materials (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id),
  name text NOT NULL,
  size_bytes integer NOT NULL,
  content_type text NOT NULL,
  sha256 text NOT NULL,
  object_key text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS materials_booking_idx ON materials (booking_id);

CREATE TABLE IF NOT EXISTS prep_links (
  token text PRIMARY KEY,
  material_id text NOT NULL REFERENCES materials(id),
  booking_id text NOT NULL REFERENCES bookings(id),
  interpreter_id text NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  line_ref text PRIMARY KEY,
  booking_id text NOT NULL UNIQUE REFERENCES bookings(id),
  org_id text NOT NULL REFERENCES orgs(id),
  kind text NOT NULL,
  assignment_date date NOT NULL,
  rate_effective_from date NOT NULL,
  hourly_rate_cents integer NOT NULL,
  team_surcharge_bp integer NOT NULL,
  basis_minutes integer NOT NULL,
  billable_minutes integer NOT NULL,
  interpreter_count integer NOT NULL,
  time_amount_cents integer NOT NULL,
  mileage_miles integer NOT NULL,
  mileage_cents_per_mile integer NOT NULL,
  mileage_amount_cents integer NOT NULL,
  amount_cents integer NOT NULL,
  billing_week date NOT NULL,
  sync_status text NOT NULL,
  killbill_item_id text,
  sync_locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_lines_week_idx ON invoice_lines (org_id, billing_week);

CREATE TABLE IF NOT EXISTS billing_weeks (
  org_id text NOT NULL REFERENCES orgs(id),
  week_start date NOT NULL,
  closed_at timestamptz NOT NULL,
  relayline_total_cents integer NOT NULL,
  billing_total_cents integer NOT NULL,
  PRIMARY KEY (org_id, week_start)
);

CREATE TABLE IF NOT EXISTS killbill_accounts (
  org_id text PRIMARY KEY REFERENCES orgs(id),
  account_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS email_queue (
  id text PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id bigserial PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor_name text NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  seat integer,
  interpreter_name text
);

CREATE INDEX IF NOT EXISTS audit_booking_idx ON audit_entries (booking_id, id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body_sha text NOT NULL,
  state text NOT NULL,
  status integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
`;
