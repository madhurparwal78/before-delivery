export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('operator','shift_lead','renter')),
  renter_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY DEFAULT encode(gen_random_bytes(32),'hex'),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS renters (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied','documents_review','active','suspended','offboarded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  renter_id text NOT NULL REFERENCES renters(id),
  kind text NOT NULL CHECK (kind IN ('coi','food_handler_card','business_licence')),
  expires_on date,
  status text NOT NULL CHECK (status IN ('pending_review','approved','rejected')),
  object_key text NOT NULL,
  original_name text NOT NULL,
  size_bytes integer NOT NULL,
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS station_settings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  station_id text NOT NULL REFERENCES stations(id),
  effective_from date NOT NULL,
  hour_weight integer NOT NULL CHECK (hour_weight IN (1,2,3)),
  off_peak_percent integer NOT NULL CHECK (off_peak_percent IN (50,60,70,80,90,100)),
  overage_usd_per_hour numeric(10,2) NOT NULL,
  buffer_minutes integer NOT NULL CHECK (buffer_minutes >= 0 AND buffer_minutes <= 120 AND buffer_minutes % 15 = 0),
  UNIQUE (station_id, effective_from)
);

CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  hours integer NOT NULL,
  amount_usd numeric(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS movements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  renter_id text NOT NULL REFERENCES renters(id),
  kind text NOT NULL CHECK (kind IN ('opening_balance','pack_purchase','booking_hold','hold_release','cancellation_credit','displacement_credit','checkout','cancellation_forfeit','adjustment')),
  minutes integer NOT NULL CHECK (minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  note text
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  movement_id text NOT NULL REFERENCES movements(id),
  renter_id text NOT NULL,
  account text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  minutes integer NOT NULL CHECK (minutes > 0),
  booking_id text,
  purchase_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  renter_id text NOT NULL REFERENCES renters(id),
  pack_id text NOT NULL REFERENCES packs(id),
  idempotency_key text NOT NULL,
  killbill_payment_id text NOT NULL,
  balance_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (renter_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS purchase_keys (
  renter_id text NOT NULL REFERENCES renters(id),
  key text NOT NULL,
  body_hash text NOT NULL,
  request_lock text NOT NULL,
  state text NOT NULL CHECK (state IN ('in_progress','done')),
  response jsonb,
  PRIMARY KEY (renter_id, key)
);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  series_id text NOT NULL,
  station_id text NOT NULL REFERENCES stations(id),
  renter_id text NOT NULL REFERENCES renters(id),
  status text NOT NULL CHECK (status IN ('hold','confirmed','checked_in','completed','expired','cancelled','displaced')),
  date date NOT NULL,
  start_min integer NOT NULL CHECK (start_min >= 0 AND start_min < 1440),
  end_min integer NOT NULL CHECK (end_min > 0 AND end_min <= 1440),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  buffer_minutes integer NOT NULL,
  buffer_ends_at timestamptz NOT NULL,
  hour_weight integer NOT NULL,
  off_peak_percent integer NOT NULL,
  overage_usd_per_hour numeric(10,2) NOT NULL,
  minutes_debited integer NOT NULL,
  hold_expires_at timestamptz,
  cancellation_cutoff_at timestamptz NOT NULL,
  actual_start text,
  actual_end text,
  overage_units integer,
  overage_usd numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maintenance_blocks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  station_id text NOT NULL REFERENCES stations(id),

  date date NOT NULL,
  start_min integer NOT NULL,
  end_min integer NOT NULL,
  reason text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  renter_id text NOT NULL REFERENCES renters(id),
  month text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  label text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_in_seconds integer NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind text NOT NULL,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','sent')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS shelf_subscriptions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  renter_id text NOT NULL REFERENCES renters(id),
  shelf_label text NOT NULL,
  external_key text NOT NULL,
  killbill_subscription_id text NOT NULL,
  sequence_no integer NOT NULL,
  state text NOT NULL CHECK (state IN ('active','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

-- One winner per slot: no two live occupancy ranges on a station may overlap.
-- Ranges that touch end-to-start are allowed. The insert into this table is the
-- single serialization point for bookings and maintenance blocks.
CREATE TABLE IF NOT EXISTS station_occupancy (
  station_id text NOT NULL REFERENCES stations(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  booking_id text,
  block_id text,
  CHECK ((booking_id IS NULL) <> (block_id IS NULL)),
  CHECK (ends_at > starts_at)
);

CREATE OR REPLACE FUNCTION occupancy_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'occupancy rows are never edited';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS occupancy_no_delete ON station_occupancy;

CREATE TRIGGER occupancy_no_delete
BEFORE DELETE OR UPDATE ON station_occupancy
FOR EACH ROW
EXECUTE FUNCTION occupancy_guard();

CREATE INDEX IF NOT EXISTS occupancy_station_bounds ON station_occupancy (station_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS bookings_day_station ON bookings (date, station_id, start_min);
CREATE INDEX IF NOT EXISTS ledger_entries_renter_created ON ledger_entries (renter_id, created_at, id);
CREATE INDEX IF NOT EXISTS notifications_pending ON notifications (status, created_at);
`;
