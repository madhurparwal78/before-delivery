// The database schema, applied idempotently at every start. Occupancy lives in one table whose
// exclusion constraint guarantees that no two holds, bookings or maintenance blocks on a station
// overlap: concurrent claims race on the constraint, never on application code.

export const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS kitchen (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  name text NOT NULL,
  address text NOT NULL,
  seeded_on date NOT NULL
);

CREATE TABLE IF NOT EXISTS renters (
  id uuid PRIMARY KEY,
  business_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied', 'documents_review', 'active', 'suspended', 'offboarded')),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('operator', 'shift_lead', 'renter')),
  password_hash text NOT NULL,
  renter_id uuid UNIQUE REFERENCES renters (id),
  CHECK ((role = 'renter') = (renter_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  renter_id uuid NOT NULL REFERENCES renters (id),
  kind text NOT NULL CHECK (kind IN ('coi', 'food_handler_card', 'business_licence')),
  expires_on date,
  status text NOT NULL CHECK (status IN ('pending_review', 'approved', 'rejected')),
  original_name text NOT NULL,
  size_bytes integer NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL,
  review_note text,
  created_at timestamptz NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS documents_renter ON documents (renter_id, kind, seq);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS station_settings (
  station_id text NOT NULL REFERENCES stations (id),
  effective_from date NOT NULL,
  hour_weight integer NOT NULL CHECK (hour_weight IN (1, 2, 3)),
  off_peak_percent integer NOT NULL CHECK (off_peak_percent IN (50, 60, 70, 80, 90, 100)),
  overage_cents_per_hour integer NOT NULL CHECK (overage_cents_per_hour BETWEEN 0 AND 50000),
  buffer_minutes integer NOT NULL CHECK (buffer_minutes BETWEEN 0 AND 120 AND buffer_minutes % 15 = 0),
  PRIMARY KEY (station_id, effective_from)
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY,
  series_id uuid NOT NULL,
  week_index integer NOT NULL,
  station_id text NOT NULL REFERENCES stations (id),
  renter_id uuid NOT NULL REFERENCES renters (id),
  status text NOT NULL CHECK (status IN ('hold', 'confirmed', 'checked_in', 'completed', 'expired', 'cancelled', 'displaced')),
  date date NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  buffer_minutes integer NOT NULL,
  hour_weight integer NOT NULL,
  off_peak_percent integer NOT NULL,
  overage_cents_per_hour integer NOT NULL,
  minutes_debited integer NOT NULL,
  hold_expires_at timestamptz NOT NULL,
  cancellation_cutoff_at timestamptz NOT NULL,
  actual_start integer,
  actual_end integer,
  overage_units integer,
  overage_cents integer,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_series ON bookings (series_id, week_index);
CREATE INDEX IF NOT EXISTS bookings_renter ON bookings (renter_id, date);
CREATE INDEX IF NOT EXISTS bookings_station_day ON bookings (station_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_live_holds ON bookings (hold_expires_at) WHERE status = 'hold';

CREATE TABLE IF NOT EXISTS maintenance_blocks (
  id uuid PRIMARY KEY,
  station_id text NOT NULL REFERENCES stations (id),
  date date NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS station_occupancy (
  station_id text NOT NULL REFERENCES stations (id),
  occupied tstzrange NOT NULL,
  booking_id uuid UNIQUE REFERENCES bookings (id),
  maintenance_block_id uuid UNIQUE REFERENCES maintenance_blocks (id) ON DELETE CASCADE,
  CHECK ((booking_id IS NULL) <> (maintenance_block_id IS NULL)),
  CONSTRAINT station_occupancy_no_overlap EXCLUDE USING gist (station_id WITH =, occupied WITH &&)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  movement_id uuid NOT NULL,
  kind text NOT NULL,
  account text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  minutes integer NOT NULL CHECK (minutes > 0),
  booking_id uuid REFERENCES bookings (id),
  purchase_id uuid,
  note text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries (account, id);
CREATE INDEX IF NOT EXISTS ledger_entries_movement ON ledger_entries (movement_id);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY,
  renter_id uuid NOT NULL REFERENCES renters (id),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  pack_id text NOT NULL,
  killbill_payment_id text NOT NULL,
  response_status integer NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (renter_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'sent')),
  attempts integer NOT NULL DEFAULT 0,
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS notifications_queued ON notifications (seq) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS statements (
  id uuid PRIMARY KEY,
  renter_id uuid NOT NULL REFERENCES renters (id),
  month text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS compliance_links (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_in_seconds integer NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS shelf_subscriptions (
  id uuid PRIMARY KEY,
  renter_id uuid NOT NULL REFERENCES renters (id),
  shelf_label text NOT NULL,
  external_key text NOT NULL UNIQUE,
  killbill_subscription_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'cancelled')),
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS shelf_one_active ON shelf_subscriptions (renter_id) WHERE state = 'active';
`;
