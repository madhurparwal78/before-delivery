/**
 * The Postgres schema. Applied idempotently every time `serve` starts.
 *
 * `station_occupancy` is the one place a station's time is claimed, and its
 * exclusion constraint is what makes "one winner per slot" a database
 * guarantee rather than an application check.
 */

export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS kitchen (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  name text NOT NULL,
  address text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('operator','shift_lead','renter')),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied','documents_review','active','suspended','offboarded')),
  killbill_account_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  name text NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS station_settings (
  station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  hour_weight integer NOT NULL CHECK (hour_weight IN (1,2,3)),
  off_peak_percent integer NOT NULL CHECK (off_peak_percent IN (50,60,70,80,90,100)),
  overage_usd_per_hour numeric(6,2) NOT NULL CHECK (overage_usd_per_hour >= 0 AND overage_usd_per_hour <= 500),
  buffer_minutes integer NOT NULL CHECK (buffer_minutes >= 0 AND buffer_minutes <= 120 AND buffer_minutes % 15 = 0),
  PRIMARY KEY (station_id, effective_from)
);

CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  hours integer NOT NULL,
  amount_usd numeric(10,2) NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('coi','food_handler_card','business_licence')),
  expires_on date,
  status text NOT NULL CHECK (status IN ('pending_review','approved','rejected')),
  original_name text NOT NULL,
  size_bytes integer NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_renter_idx ON documents(renter_id, kind, seq DESC);

CREATE TABLE IF NOT EXISTS document_notices (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  notice text NOT NULL CHECK (notice IN ('expiring','expired')),
  PRIMARY KEY (document_id, notice)
);

CREATE TABLE IF NOT EXISTS maintenance_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_hhmm text NOT NULL,
  end_hhmm text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL,
  station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('hold','confirmed','expired','displaced','cancelled','checked_in','completed')),
  date date NOT NULL,
  start_hhmm text NOT NULL,
  end_hhmm text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  buffer_minutes integer NOT NULL,
  hour_weight integer NOT NULL,
  off_peak_percent integer NOT NULL,
  overage_usd_per_hour numeric(6,2) NOT NULL,
  minutes_debited integer NOT NULL,
  hold_expires_at timestamptz,
  cancellation_cutoff_at timestamptz NOT NULL,
  actual_start text,
  actual_end text,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  overage_units integer,
  overage_usd numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_renter_idx ON bookings(renter_id, status);
CREATE INDEX IF NOT EXISTS bookings_station_day_idx ON bookings(station_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_series_idx ON bookings(series_id);
CREATE INDEX IF NOT EXISTS bookings_hold_expiry_idx ON bookings(hold_expires_at) WHERE status = 'hold';

CREATE TABLE IF NOT EXISTS station_occupancy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('booking','maintenance')),
  booking_id uuid UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  block_id uuid UNIQUE REFERENCES maintenance_blocks(id) ON DELETE CASCADE,
  occupied tstzrange NOT NULL,
  CONSTRAINT station_occupancy_owner CHECK (
    (kind = 'booking' AND booking_id IS NOT NULL AND block_id IS NULL) OR
    (kind = 'maintenance' AND block_id IS NOT NULL AND booking_id IS NULL)
  ),
  CONSTRAINT station_occupancy_no_overlap
    EXCLUDE USING gist (station_id WITH =, occupied WITH &&)
);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  pack_id text NOT NULL REFERENCES packs(id),
  pack_name text NOT NULL,
  hours integer NOT NULL,
  amount_usd numeric(10,2) NOT NULL,
  killbill_payment_id text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (renter_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS purchase_keys (
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('in_progress','completed')),
  status_code integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (renter_id, key)
);

CREATE TABLE IF NOT EXISTS movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'opening_balance','pack_purchase','booking_hold','hold_release','cancellation_credit',
    'displacement_credit','checkout','cancellation_forfeit','adjustment')),
  minutes integer NOT NULL CHECK (minutes > 0),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_renter_idx ON movements(renter_id, seq);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id uuid NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  account text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  minutes integer NOT NULL CHECK (minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries(account);
CREATE INDEX IF NOT EXISTS ledger_entries_renter_idx ON ledger_entries(renter_id, seq);

CREATE TABLE IF NOT EXISTS statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  month text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS statements_renter_idx ON statements(renter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shelf_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  shelf_label text NOT NULL,
  plan text NOT NULL,
  external_key text NOT NULL,
  killbill_subscription_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active','cancelled')),
  ordinal integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (renter_id, ordinal)
);
CREATE UNIQUE INDEX IF NOT EXISTS shelf_one_active_per_renter
  ON shelf_subscriptions(renter_id) WHERE state = 'active';

CREATE TABLE IF NOT EXISTS compliance_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_in_seconds integer NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  cause text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','sent')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_queue_idx
  ON notifications(next_attempt_at) WHERE status = 'queued';
`;
