-- Relayline schema. Applied idempotently at every boot; concurrent starts are tolerated.

CREATE TABLE IF NOT EXISTS schema_lock (
  id integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agencies (
  id text PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL,
  solo_threshold_minutes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS organisations (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organisations(id),
  minimum_minutes integer NOT NULL,
  increment_minutes integer NOT NULL,
  rotation_interval_minutes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_rates (
  contract_id text NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
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
  org_id text REFERENCES organisations(id),
  initials text,
  phone text,
  home_city text,
  pay_rate_cents integer
);

CREATE TABLE IF NOT EXISTS interpreter_credentials (
  interpreter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  expires_on date NOT NULL,
  PRIMARY KEY (interpreter_id, code, expires_on)
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_sequence (
  id integer PRIMARY KEY,
  last_value integer NOT NULL
);

CREATE TABLE IF NOT EXISTS line_sequence (
  id integer PRIMARY KEY,
  last_value integer NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  seq integer NOT NULL UNIQUE,
  org_id text NOT NULL REFERENCES organisations(id),
  requester_id text REFERENCES users(id),
  setting text NOT NULL,
  title text NOT NULL,
  location text NOT NULL,
  onsite_contact_name text NOT NULL,
  onsite_contact_phone text NOT NULL,
  consumer_name text NOT NULL,
  start_instant timestamptz NOT NULL,
  start_wall text NOT NULL,
  end_instant timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  seat_count integer NOT NULL,
  status text NOT NULL,
  requester_notes text NOT NULL DEFAULT '',
  open_call_posted_at timestamptz,
  open_call_closes_at timestamptz,
  checked_in_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_start_idx ON bookings (start_instant);

CREATE TABLE IF NOT EXISTS seats (
  booking_id text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seat integer NOT NULL,
  holder_id text REFERENCES users(id),
  held_since timestamptz,
  PRIMARY KEY (booking_id, seat)
);

CREATE TABLE IF NOT EXISTS audit_trail (
  id bigserial PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id text REFERENCES users(id),
  actor_name text NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text,
  seat integer,
  interpreter_name text
);
CREATE INDEX IF NOT EXISTS audit_booking_idx ON audit_trail (booking_id, id);

CREATE TABLE IF NOT EXISTS materials (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  name text NOT NULL,
  size_bytes bigint NOT NULL,
  content_type text NOT NULL,
  sha256 text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by text REFERENCES users(id),
  seq integer NOT NULL
);
CREATE INDEX IF NOT EXISTS materials_booking_idx ON materials (booking_id, seq);

CREATE SEQUENCE IF NOT EXISTS material_seq START 1;

CREATE TABLE IF NOT EXISTS kb_accounts (
  org_id text PRIMARY KEY REFERENCES organisations(id),
  kb_account_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS prep_links (
  token text PRIMARY KEY,
  material_id text NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  issued_to text NOT NULL REFERENCES users(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL,
  key text NOT NULL,
  state text NOT NULL, -- pending | done
  method text NOT NULL,
  path text NOT NULL,
  body bytea,
  status integer,
  response_body text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idem_gc_idx ON idempotency_keys (claimed_at);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id text PRIMARY KEY,
  line_ref text NOT NULL UNIQUE,
  seq integer NOT NULL UNIQUE,
  booking_id text NOT NULL REFERENCES bookings(id),
  booking_ref text NOT NULL,
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
  billing_amount_cents integer,
  billing_week date NOT NULL,
  sync_status text NOT NULL,
  kb_item_id text,
  kb_post_attempts integer NOT NULL DEFAULT 0,
  kb_last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lines_week_idx ON invoice_lines (org_id, billing_week);
CREATE INDEX IF NOT EXISTS lines_pending_idx ON invoice_lines (sync_status) WHERE sync_status = 'pending_sync';

CREATE TABLE IF NOT EXISTS billing_weeks (
  org_id text NOT NULL REFERENCES organisations(id),
  week_start date NOT NULL,
  status text NOT NULL,
  relayline_total_cents integer NOT NULL,
  billing_total_cents integer,
  closed_at timestamptz,
  PRIMARY KEY (org_id, week_start)
);

CREATE TABLE IF NOT EXISTS email_queue (
  id bigserial PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  booked_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  locked_by text,
  locked_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS email_unsent_idx ON email_queue (sent_at) WHERE sent_at IS NULL;
