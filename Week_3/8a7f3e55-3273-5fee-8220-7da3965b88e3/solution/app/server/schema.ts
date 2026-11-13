export const SCHEMA = `
CREATE TABLE IF NOT EXISTS organisations (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id text PRIMARY KEY,
  org_id text NOT NULL UNIQUE REFERENCES organisations(id),
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
  org_id text REFERENCES organisations(id)
);

CREATE TABLE IF NOT EXISTS interpreters (
  user_id text PRIMARY KEY REFERENCES users(id),
  initials text NOT NULL,
  phone text NOT NULL,
  home_city text NOT NULL,
  pay_rate_cents integer NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id serial PRIMARY KEY,
  interpreter_id text NOT NULL REFERENCES interpreters(user_id),
  code text NOT NULL,
  expires_on date NOT NULL,
  UNIQUE (interpreter_id, code)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE SEQUENCE IF NOT EXISTS booking_ref_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS line_ref_seq START 5001;

CREATE TABLE IF NOT EXISTS bookings (
  id serial PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  org_id text NOT NULL REFERENCES organisations(id),
  requester_id text NOT NULL REFERENCES users(id),
  setting text NOT NULL,
  title text NOT NULL,
  location text NOT NULL,
  onsite_contact_name text NOT NULL,
  onsite_contact_phone text NOT NULL,
  consumer_name text NOT NULL,
  requester_notes text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  start_date date NOT NULL,
  duration_minutes integer NOT NULL,
  seat_count integer NOT NULL,
  phase text NOT NULL DEFAULT 'active',
  open_call_posted_at timestamptz,
  open_call_closes_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_start_date_idx ON bookings (start_date);
CREATE INDEX IF NOT EXISTS bookings_org_idx ON bookings (org_id, start_date);

CREATE TABLE IF NOT EXISTS seats (
  booking_id integer NOT NULL REFERENCES bookings(id),
  seat integer NOT NULL,
  interpreter_id text REFERENCES interpreters(user_id),
  PRIMARY KEY (booking_id, seat)
);
CREATE INDEX IF NOT EXISTS seats_interpreter_idx ON seats (interpreter_id);
CREATE UNIQUE INDEX IF NOT EXISTS seats_one_seat_per_interpreter ON seats (booking_id, interpreter_id) WHERE interpreter_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS materials (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES bookings(id),
  name text NOT NULL,
  size_bytes integer NOT NULL,
  content_type text NOT NULL,
  sha256 text NOT NULL,
  object_key text NOT NULL UNIQUE,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS materials_booking_idx ON materials (booking_id);

CREATE TABLE IF NOT EXISTS prep_links (
  token_hash text PRIMARY KEY,
  material_id integer NOT NULL REFERENCES materials(id),
  booking_id integer NOT NULL REFERENCES bookings(id),
  interpreter_id text NOT NULL REFERENCES interpreters(user_id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id serial PRIMARY KEY,
  line_ref text NOT NULL UNIQUE,
  booking_id integer NOT NULL UNIQUE REFERENCES bookings(id),
  org_id text NOT NULL REFERENCES organisations(id),
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
  kb_item_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_lines_week_idx ON invoice_lines (org_id, billing_week);

CREATE TABLE IF NOT EXISTS billing_weeks (
  org_id text NOT NULL REFERENCES organisations(id),
  week_start date NOT NULL,
  closed_at timestamptz NOT NULL,
  relayline_total_cents integer NOT NULL,
  billing_total_cents integer NOT NULL,
  PRIMARY KEY (org_id, week_start)
);

CREATE TABLE IF NOT EXISTS emails (
  id serial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS emails_unsent_idx ON emails (id) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_entries (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES bookings(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor_name text NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  seat integer,
  interpreter_name text
);
CREATE INDEX IF NOT EXISTS audit_booking_idx ON audit_entries (booking_id, id);
`;
