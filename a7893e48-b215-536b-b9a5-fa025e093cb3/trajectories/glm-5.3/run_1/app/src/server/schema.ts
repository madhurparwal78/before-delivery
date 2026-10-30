export const SCHEMA_SQL = `
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
  cleaning_fee_cents integer NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  name text NOT NULL,
  rate_cents integer NOT NULL,
  ordinal integer NOT NULL
);

CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('renter','front_desk','manager')),
  site_ids text[] NOT NULL DEFAULT '{}',
  renter_id text
);

CREATE TABLE IF NOT EXISTS renters (
  id text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  home_site_id text NOT NULL REFERENCES sites(id),
  user_id text NOT NULL REFERENCES app_users(id),
  name text NOT NULL,
  business text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  kb_ensured boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS policy_versions (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  notice_hours integer NOT NULL,
  effective_from date NOT NULL,
  effective_at timestamptz NOT NULL,
  created_by text NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, effective_from)
);

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  station_id text NOT NULL REFERENCES stations(id),
  site_id text NOT NULL REFERENCES sites(id),
  renter_id text NOT NULL REFERENCES renters(id),
  status text NOT NULL CHECK (status IN ('held','expired','confirmed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  expired_email_sent boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hold_occurrences (
  hold_id text NOT NULL REFERENCES holds(id),
  ordinal integer NOT NULL,
  date date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  minutes integer NOT NULL,
  PRIMARY KEY (hold_id, ordinal)
);

CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY,
  renter_id text NOT NULL REFERENCES renters(id),
  minutes integer NOT NULL,
  price_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  hold_id text NOT NULL REFERENCES holds(id),
  site_id text NOT NULL REFERENCES sites(id),
  station_id text NOT NULL REFERENCES stations(id),
  renter_id text NOT NULL REFERENCES renters(id),
  status text NOT NULL CHECK (status IN
    ('confirmed','checked_in','overrun_billed','checked_out','settled',
     'cancelled_refunded','cancelled_forfeit','unpaid_cancelled')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  minutes integer NOT NULL,
  pack_minutes integer NOT NULL DEFAULT 0,
  card_minutes integer NOT NULL DEFAULT 0,
  card_cents integer NOT NULL DEFAULT 0,
  deposit_cents integer NOT NULL DEFAULT 0,
  policy_version_id text NOT NULL REFERENCES policy_versions(id),
  confirmed_at timestamptz NOT NULL,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  overrun_minutes integer NOT NULL DEFAULT 0,
  overrun_cents integer NOT NULL DEFAULT 0,
  cleaning_fee_charged boolean NOT NULL DEFAULT false,
  deposit_refunded boolean NOT NULL DEFAULT false,
  time_refunded boolean NOT NULL DEFAULT false,
  cutoff_run boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pack_movements (
  id text PRIMARY KEY,
  pack_id text NOT NULL REFERENCES packs(id),
  booking_id text REFERENCES bookings(id),
  reason text NOT NULL CHECK (reason IN ('purchase','reserve','release','use','forfeit')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pack_entries (
  id text PRIMARY KEY,
  movement_id text NOT NULL REFERENCES pack_movements(id),
  account text NOT NULL CHECK (account IN ('purchased','available','reserved','used')),
  minutes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  actor_name text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('renter','front_desk','manager','system')),
  action text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason text
);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  renter_id text NOT NULL REFERENCES renters(id),
  kind text NOT NULL CHECK (kind IN ('liability','food_handler')),
  valid_from date NOT NULL,
  expires_on date NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  storage_key text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reminder_sent boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS binder_links (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  token text NOT NULL UNIQUE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  pdf_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS email_queue (
  id text PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  status integer NOT NULL,
  body text NOT NULL,
  request_body text,
  running boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint, key)
);

CREATE INDEX IF NOT EXISTS bookings_station_time ON bookings (station_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS holds_station_time ON holds (station_id, expires_at);
CREATE INDEX IF NOT EXISTS hold_occ_start ON hold_occurrences (start_at, end_at);
CREATE INDEX IF NOT EXISTS bookings_renter ON bookings (renter_id);
CREATE INDEX IF NOT EXISTS pack_entries_movement ON pack_entries (movement_id);
`;
