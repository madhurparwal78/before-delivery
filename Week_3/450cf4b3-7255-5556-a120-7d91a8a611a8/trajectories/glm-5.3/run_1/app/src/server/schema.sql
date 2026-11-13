-- Idempotent schema: a second process starting against a seeded database adds nothing.

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','shift_lead','tenant')),
  display_name text NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  contact_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied','documents_pending','approved','suspended')),
  suspended_reason text,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  confirmed_at bigint,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  at bigint NOT NULL,
  success boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_attempts_email_at ON sign_in_attempts (email, at);

CREATE TABLE IF NOT EXISTS counted_claims (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS counted_claims_tenant_at ON counted_claims (tenant_id, at);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('range','prep_table','mixer','cooler_shelf')),
  cleanup_minutes integer NOT NULL,
  col integer NOT NULL,
  row integer NOT NULL,
  seed_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  station_id text NOT NULL REFERENCES stations(id),
  shelf_id text REFERENCES stations(id),
  start bigint NOT NULL,
  "end" bigint NOT NULL,
  buffer_end bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('held','confirmed','checked_in','completed','cancelled','no_show')),
  cancel_reason text CHECK (cancel_reason IN ('tenant','hold_expired')),
  hold_expires_at bigint,
  pack_id text,
  debited_minutes integer,
  refunded_minutes integer,
  move_count integer NOT NULL DEFAULT 0,
  cleanup_note text,
  created_at bigint NOT NULL,
  live integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bookings_tenant ON bookings (tenant_id);
CREATE INDEX IF NOT EXISTS bookings_start ON bookings (start);

-- Occupancy with the no-overlap rule enforced inside Postgres, for single and
-- paired bookings: one occupancy row per station a booking occupies, and an
-- exclusion constraint that refuses any overlapping live occupancy. Rows exist
-- exactly while the booking is live, so cancelled bookings and expired holds
-- free their stations in the same transaction that ends them.
CREATE TABLE IF NOT EXISTS booking_occupancies (
  booking_id text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  station_id text NOT NULL REFERENCES stations(id),
  start bigint NOT NULL,
  buffer_end bigint NOT NULL,
  PRIMARY KEY (booking_id, station_id)
);
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'occupancy_no_overlap'
  ) THEN
    ALTER TABLE booking_occupancies
      ADD CONSTRAINT occupancy_no_overlap
      EXCLUDE USING gist (station_id WITH =, int8range(start, buffer_end) WITH &&);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS occupancy_station ON booking_occupancies (station_id);

CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  hours integer NOT NULL,
  price_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('active','refunded')) DEFAULT 'active',
  invoice_id text,
  refunded_cents integer,
  purchased_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS packs_tenant ON packs (tenant_id);

CREATE TABLE IF NOT EXISTS movements (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('purchase','booking_debit','move_adjustment','cancellation_credit','refund')),
  pack_id text NOT NULL REFERENCES packs(id),
  booking_id text,
  at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  movement_id text NOT NULL REFERENCES movements(id),
  side text NOT NULL CHECK (side IN ('pack','kitchen')),
  minutes integer NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_pack ON ledger_entries (movement_id);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK (kind IN ('insurance_certificate','food_handler_card')),
  expires_on text NOT NULL,
  per_occurrence_limit integer,
  additional_insured boolean,
  content_type text,
  size_bytes integer,
  sha256 text,
  has_file boolean NOT NULL DEFAULT false,
  uploaded_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_tenant_kind ON documents (tenant_id, kind, uploaded_at);

CREATE TABLE IF NOT EXISTS purchase_attempts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  created_at bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('open','complete')) DEFAULT 'open',
  invoice_id text,
  payment_id text,
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS door_log (
  id bigserial PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id),
  action text NOT NULL CHECK (action IN ('check_in','check_out','no_show')),
  at bigint NOT NULL,
  staff_by text NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','done')) DEFAULT 'running',
  response_status integer,
  response_body jsonb,
  created_at bigint NOT NULL,
  UNIQUE (user_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS mail_queue (
  id text PRIMARY KEY,
  kind text NOT NULL,
  record_id text NOT NULL,
  tenant_id text NOT NULL,
  to_name text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','claimed','sent')) DEFAULT 'queued',
  claimed_by text,
  claimed_at bigint,
  sent_at bigint,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_queue_status ON mail_queue (status, created_at);

CREATE TABLE IF NOT EXISTS notice_claims (
  document_id text NOT NULL REFERENCES documents(id),
  point text NOT NULL CHECK (point IN ('seven_days','today')),
  claimed_at bigint NOT NULL,
  PRIMARY KEY (document_id, point)
);
