CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS operators (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  name text NOT NULL,
  time_zone text NOT NULL,
  deposit_cents integer NOT NULL,
  cleaning_fee_cents integer NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  name text NOT NULL,
  rate_cents integer NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS renters (
  id text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  name text NOT NULL,
  business text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  home_site_id text NOT NULL REFERENCES sites(id)
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  site_id text REFERENCES sites(id),
  renter_id text REFERENCES renters(id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_versions (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  notice_hours integer NOT NULL,
  effective_from date NOT NULL,
  effective_at timestamptz NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, effective_from)
);

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  station_id text NOT NULL REFERENCES stations(id),
  renter_id text NOT NULL REFERENCES renters(id),
  status text NOT NULL,
  repeat_weeks integer NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  expiry_notified boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hold_occurrences (
  id bigserial PRIMARY KEY,
  hold_id text NOT NULL REFERENCES holds(id),
  seq integer NOT NULL,
  local_date date NOT NULL,
  local_start text NOT NULL,
  local_end text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  minutes integer NOT NULL
);
CREATE INDEX IF NOT EXISTS hold_occurrences_hold_idx ON hold_occurrences (hold_id);
CREATE INDEX IF NOT EXISTS hold_occurrences_span_idx ON hold_occurrences (start_at, end_at);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  hold_id text REFERENCES holds(id),
  site_id text NOT NULL REFERENCES sites(id),
  station_id text NOT NULL REFERENCES stations(id),
  renter_id text NOT NULL REFERENCES renters(id),
  status text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  minutes integer NOT NULL,
  pack_minutes integer NOT NULL,
  card_minutes integer NOT NULL,
  card_cents integer NOT NULL,
  deposit_cents integer NOT NULL,
  time_paid boolean NOT NULL DEFAULT false,
  balance_due_by timestamptz,
  policy_version_id text NOT NULL REFERENCES policy_versions(id),
  confirmed_at timestamptz NOT NULL,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  overrun_minutes integer NOT NULL DEFAULT 0,
  overrun_cents integer NOT NULL DEFAULT 0,
  cleaning_fee_cents integer NOT NULL DEFAULT 0,
  card_refund_cents integer NOT NULL DEFAULT 0,
  deposit_refund_cents integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bookings_station_idx ON bookings (station_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS bookings_renter_idx ON bookings (renter_id);
CREATE INDEX IF NOT EXISTS bookings_site_idx ON bookings (site_id, start_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  booking_id text REFERENCES bookings(id),
  hold_id text REFERENCES holds(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason text
);
CREATE INDEX IF NOT EXISTS audit_booking_idx ON audit_events (booking_id, id);

CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY,
  renter_id text NOT NULL REFERENCES renters(id),
  product text NOT NULL,
  minutes integer NOT NULL,
  price_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pack_movements (
  id text PRIMARY KEY,
  renter_id text NOT NULL REFERENCES renters(id),
  reason text NOT NULL,
  booking_id text REFERENCES bookings(id),
  pack_id text REFERENCES packs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pack_entries (
  id bigserial PRIMARY KEY,
  movement_id text NOT NULL REFERENCES pack_movements(id),
  renter_id text NOT NULL REFERENCES renters(id),
  account text NOT NULL,
  minutes integer NOT NULL,
  reason text NOT NULL,
  booking_id text REFERENCES bookings(id),
  pack_id text REFERENCES packs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pack_entries_renter_idx ON pack_entries (renter_id, id);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  renter_id text NOT NULL REFERENCES renters(id),
  kind text NOT NULL,
  valid_from date NOT NULL,
  expires_on date NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  storage_key text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reminder_queued_at timestamptz
);
CREATE INDEX IF NOT EXISTS documents_renter_idx ON documents (renter_id);

CREATE TABLE IF NOT EXISTS binder_links (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  from_date date NOT NULL,
  to_date date NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz NOT NULL,
  pdf_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id text NOT NULL,
  path text NOT NULL,
  idempotency_key text NOT NULL,
  body_hash text NOT NULL,
  state text NOT NULL,
  response_status integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path, idempotency_key)
);

CREATE TABLE IF NOT EXISTS email_queue (
  id bigserial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_queue_status_idx ON email_queue (status, id);
