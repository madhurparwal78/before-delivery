-- Clinchline schema, version 0001. Postgres holds every record (brief: Services, Postgres).

CREATE TABLE app_secrets (
  name text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE practice (
  id smallint PRIMARY KEY CHECK (id = 1),
  name text NOT NULL,
  time_zone text NOT NULL,
  seed_date date NOT NULL
);

CREATE TABLE barns (
  id text PRIMARY KEY,
  name text NOT NULL,
  trip_fee_cents integer NOT NULL CHECK (trip_fee_cents >= 0)
);
CREATE UNIQUE INDEX barns_name ON barns (lower(name));

CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('farrier', 'apprentice', 'owner', 'barn_manager')),
  password_hash text NOT NULL,
  phone text,
  barn_id text REFERENCES barns (id),
  killbill_account_id text,
  killbill_payment_method_id text,
  card_token text,
  card_last4 text,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX users_email ON users (lower(email));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE api_tokens (
  id text PRIMARY KEY,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('read_only', 'billing')),
  token_hash text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE horses (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL REFERENCES users (id),
  barn_id text NOT NULL REFERENCES barns (id),
  stall text NOT NULL,
  cycle_weeks integer NOT NULL CHECK (cycle_weeks > 0),
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX horses_owner_name ON horses (owner_id, lower(name));
CREATE UNIQUE INDEX horses_barn_stall ON horses (barn_id, stall);

CREATE TABLE price_lists (
  id text PRIMARY KEY,
  effective_from date NOT NULL UNIQUE,
  deposit_cents integer NOT NULL CHECK (deposit_cents BETWEEN 0 AND 100000),
  prices jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE imports (
  id text PRIMARY KEY,
  counts jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE barn_days (
  id text PRIMARY KEY,
  barn_id text NOT NULL REFERENCES barns (id),
  business_date date NOT NULL,
  start_time text NOT NULL,
  slot_count integer NOT NULL,
  slot_minutes integer NOT NULL,
  trip_fee_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'in_progress', 'closed', 'cancelled')),
  created_at timestamptz NOT NULL
);

CREATE TABLE slots (
  id text PRIMARY KEY,
  barn_day_id text NOT NULL REFERENCES barn_days (id) ON DELETE CASCADE,
  position integer NOT NULL,
  time text NOT NULL,
  UNIQUE (barn_day_id, position)
);

CREATE SEQUENCE booking_number_seq;

CREATE TABLE bookings (
  id text PRIMARY KEY,
  number bigint NOT NULL UNIQUE,
  barn_day_id text NOT NULL REFERENCES barn_days (id),
  slot_id text NOT NULL REFERENCES slots (id),
  horse_id text NOT NULL REFERENCES horses (id),
  owner_id text NOT NULL REFERENCES users (id),
  status text NOT NULL CHECK (status IN ('held', 'confirmed', 'cancelled_in_time', 'cancelled_late', 'worked', 'no_show',
                                         'released', 'lapsed', 'removed')),
  hold_expires_at timestamptz,
  trip_share_cents integer,
  offer boolean NOT NULL DEFAULT false,
  deposit_cents integer NOT NULL,
  payment_id text,
  created_at timestamptz NOT NULL
);
-- No slot ever has two live bookings, and a horse has at most one per day (brief: One barn day at a time).
CREATE UNIQUE INDEX bookings_one_per_slot ON bookings (slot_id) WHERE status IN ('held', 'confirmed', 'worked', 'no_show');
CREATE UNIQUE INDEX bookings_one_per_horse_day ON bookings (barn_day_id, horse_id)
  WHERE status IN ('held', 'confirmed', 'worked', 'no_show');
CREATE INDEX bookings_day ON bookings (barn_day_id);
CREATE INDEX bookings_owner ON bookings (owner_id);

CREATE TABLE waitlist_entries (
  id text PRIMARY KEY,
  barn_day_id text NOT NULL REFERENCES barn_days (id),
  horse_id text NOT NULL REFERENCES horses (id),
  owner_id text NOT NULL REFERENCES users (id),
  join_seq bigserial NOT NULL,
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  left_reason text
);
CREATE UNIQUE INDEX waitlist_one_active ON waitlist_entries (barn_day_id, horse_id) WHERE left_at IS NULL;

CREATE TABLE visits (
  id text PRIMARY KEY,
  booking_id text UNIQUE REFERENCES bookings (id),
  horse_id text NOT NULL REFERENCES horses (id),
  business_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'closed', 'invoice_pending', 'invoiced')),
  note text NOT NULL DEFAULT '',
  work jsonb NOT NULL DEFAULT '[]',
  close_key text,
  created_at timestamptz NOT NULL,
  closed_at timestamptz
);
CREATE INDEX visits_horse ON visits (horse_id);

CREATE TABLE photos (
  id text PRIMARY KEY,
  visit_id text NOT NULL REFERENCES visits (id),
  hoof text NOT NULL,
  phase text NOT NULL,
  content_type text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  size_bytes bigint NOT NULL,
  object_key text NOT NULL,
  thumbnail_status text NOT NULL CHECK (thumbnail_status IN ('pending', 'ready', 'failed')),
  thumbnail_key text,
  created_at timestamptz NOT NULL,
  UNIQUE (visit_id, hoof, phase)
);

CREATE TABLE upload_sessions (
  id text PRIMARY KEY,
  visit_id text NOT NULL REFERENCES visits (id),
  hoof text NOT NULL,
  phase text NOT NULL,
  size_bytes bigint NOT NULL,
  chunk_bytes integer NOT NULL,
  upload_offset bigint NOT NULL DEFAULT 0,
  resumable boolean NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'stored', 'released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX upload_sessions_visit ON upload_sessions (visit_id) WHERE state = 'active';

CREATE TABLE hoof_marks (
  visit_id text NOT NULL REFERENCES visits (id),
  hoof text NOT NULL,
  version integer NOT NULL,
  hoof_wall jsonb NOT NULL,
  pastern jsonb NOT NULL,
  wall_tenths integer NOT NULL,
  pastern_tenths integer NOT NULL,
  alignment text NOT NULL,
  saved_by text NOT NULL REFERENCES users (id),
  saved_at timestamptz NOT NULL,
  restored_from integer,
  PRIMARY KEY (visit_id, hoof, version)
);

CREATE TABLE invoices (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('visit', 'trip')),
  status text NOT NULL CHECK (status IN ('pending', 'unpaid', 'paid')),
  horse_id text NOT NULL REFERENCES horses (id),
  owner_id text NOT NULL REFERENCES users (id),
  visit_id text UNIQUE REFERENCES visits (id),
  booking_id text REFERENCES bookings (id),
  barn_day_id text REFERENCES barn_days (id),
  business_date date NOT NULL,
  items jsonb NOT NULL,
  gross_cents integer NOT NULL,
  credit_cents integer NOT NULL,
  total_cents integer NOT NULL,
  balance_cents integer NOT NULL,
  deposit_payment_id text,
  killbill_invoice_id text,
  next_attempt_at timestamptz,
  failed_at timestamptz,
  dunning_state text NOT NULL DEFAULT 'none'
    CHECK (dunning_state IN ('none', 'past_due', 'retry_1', 'retry_2', 'blocked', 'cleared')),
  first_declined_at timestamptz,
  retry_at timestamptz[],
  reconciliation text NOT NULL DEFAULT 'unchecked' CHECK (reconciliation IN ('unchecked', 'matched', 'mismatch', 'unavailable')),
  mismatch_audited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX invoices_trip_booking ON invoices (booking_id) WHERE kind = 'trip';
CREATE INDEX invoices_owner ON invoices (owner_id);
CREATE INDEX invoices_pending ON invoices (next_attempt_at) WHERE status = 'pending';

CREATE TABLE payments (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('deposit', 'invoice')),
  status text NOT NULL CHECK (status IN ('authorized', 'captured', 'partially_refunded', 'refunded', 'voided', 'declined')),
  owner_id text NOT NULL REFERENCES users (id),
  booking_id text REFERENCES bookings (id),
  invoice_id text REFERENCES invoices (id),
  amount_cents integer NOT NULL,
  captured_cents integer NOT NULL DEFAULT 0,
  refunded_cents integer NOT NULL DEFAULT 0,
  applied_cents integer NOT NULL DEFAULT 0,
  disposition text CHECK (disposition IN ('held', 'forfeited', 'applied')),
  card_last4 text NOT NULL,
  decline_code text,
  created_at timestamptz NOT NULL,
  captured_at timestamptz
);
CREATE INDEX payments_owner ON payments (owner_id);
CREATE INDEX payments_invoice ON payments (invoice_id);

CREATE TABLE refunds (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments (id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  purpose text NOT NULL CHECK (purpose IN ('refund', 'deposit_out')),
  external_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

-- Kill Bill work for one payment, run in the order it happened (brief: Billing outage).
CREATE TABLE billing_ops (
  id bigserial PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments (id),
  kind text NOT NULL CHECK (kind IN ('capture', 'refund')),
  refund_id text REFERENCES refunds (id),
  next_attempt_at timestamptz NOT NULL,
  done_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX billing_ops_open ON billing_ops (payment_id, id) WHERE done_at IS NULL;

CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('billed', 'deposit_captured', 'invoice_payment', 'refund', 'deposit_transfer_out',
                                     'deposit_transfer_in')),
  amount_cents integer NOT NULL,
  at timestamptz NOT NULL,
  owner_id text NOT NULL REFERENCES users (id),
  horse_id text NOT NULL REFERENCES horses (id),
  business_date date NOT NULL
);
CREATE INDEX ledger_at ON ledger_entries (at);

CREATE TABLE idempotency_keys (
  actor text NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status_code integer,
  response_body text,
  lease_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (actor, route, key)
);

CREATE TABLE vet_links (
  id text PRIMARY KEY,
  horse_id text NOT NULL REFERENCES horses (id),
  vet_name text NOT NULL,
  vet_email text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  previous_visit_id text NOT NULL REFERENCES visits (id),
  current_visit_id text NOT NULL REFERENCES visits (id),
  created_at timestamptz NOT NULL
);

CREATE TABLE vet_link_tokens (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  link_id text NOT NULL REFERENCES vet_links (id),
  issued_at timestamptz NOT NULL,
  superseded_at timestamptz
);

CREATE TABLE vet_link_views (
  id bigserial PRIMARY KEY,
  link_id text NOT NULL REFERENCES vet_links (id),
  at timestamptz NOT NULL,
  address text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('viewed', 'expired', 'revoked')),
  user_agent text NOT NULL
);

CREATE TABLE vet_link_misses (
  id bigserial PRIMARY KEY,
  address text NOT NULL,
  missed_at timestamptz NOT NULL
);
CREATE INDEX vet_link_misses_address ON vet_link_misses (address, missed_at);

CREATE TABLE allowances (
  bucket text NOT NULL,
  scope text NOT NULL,
  key text NOT NULL,
  tokens double precision NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (bucket, scope, key)
);

CREATE TABLE outbox (
  id text PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'sent')),
  origin text NOT NULL CHECK (origin IN ('request', 'background')),
  claimed_by text,
  claim_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  failed_by text,
  failed_at timestamptz,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE INDEX outbox_pending ON outbox (next_attempt_at) WHERE status = 'pending';

CREATE TABLE jobs (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('thumbnail', 'dunning_retry', 'due_reminder', 'offer_pass', 'csv_export')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  run_at timestamptz NOT NULL,
  lease_expires_at timestamptz,
  lease_token text,
  lease_instance text,
  last_error text,
  result jsonb,
  payload jsonb NOT NULL,
  active_key text,
  once_key text UNIQUE,
  request_id text,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX jobs_active_key ON jobs (active_key) WHERE status IN ('queued', 'running');
CREATE INDEX jobs_due ON jobs (run_at) WHERE status IN ('queued', 'running');
CREATE INDEX jobs_created ON jobs (created_at DESC);

CREATE TABLE stream_events (
  stream text NOT NULL,
  seq integer NOT NULL,
  event text NOT NULL,
  data jsonb NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (stream, seq)
);

CREATE TABLE alert_state (
  threshold_cents bigint PRIMARY KEY,
  armed boolean NOT NULL
);

CREATE TABLE outstanding_alerts (
  id bigserial PRIMARY KEY,
  threshold_cents bigint NOT NULL,
  outstanding_cents bigint NOT NULL,
  at timestamptz NOT NULL
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'token', 'system')),
  actor_id text,
  action text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('barn_day', 'booking', 'visit', 'invoice', 'payment', 'vet_link',
                                                   'price_list', 'api_token', 'import', 'dunning')),
  entity_id text NOT NULL,
  from_state text,
  to_state text,
  request_id text
);
CREATE INDEX audit_log_entity ON audit_log (entity_type, entity_id, at DESC);

-- The audit log is append-only: the database refuses any edit (brief: Business rules, Audit log).
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
