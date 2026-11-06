-- Clinchline schema. Postgres is the system of record and the coordination layer.

CREATE TABLE practice (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name          text NOT NULL,
  time_zone     text NOT NULL
);

CREATE TABLE users (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL,
  email_folded  text NOT NULL UNIQUE,
  phone         text,
  role          text NOT NULL CHECK (role IN ('farrier','apprentice','owner','barn_manager')),
  password_hash text NOT NULL,
  barn_id       text,
  card_token    text,
  card_last4    text,
  created_at    timestamptz NOT NULL
);

CREATE TABLE sessions (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL
);

CREATE TABLE barns (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  name_folded    text NOT NULL UNIQUE,
  trip_fee_cents integer NOT NULL
);

ALTER TABLE users ADD CONSTRAINT users_barn_fk FOREIGN KEY (barn_id) REFERENCES barns(id);

CREATE TABLE horses (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  name_folded  text NOT NULL,
  owner_id     text NOT NULL REFERENCES users(id),
  barn_id      text NOT NULL REFERENCES barns(id),
  stall        text NOT NULL,
  cycle_weeks  integer NOT NULL CHECK (cycle_weeks BETWEEN 5 AND 8),
  created_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX horses_owner_name_uq ON horses (owner_id, name_folded);
CREATE UNIQUE INDEX horses_barn_stall_uq ON horses (barn_id, stall);

CREATE TABLE price_lists (
  id              text PRIMARY KEY,
  effective_from  date NOT NULL UNIQUE,
  deposit_cents   integer NOT NULL CHECK (deposit_cents BETWEEN 0 AND 100000),
  trim_cents      integer NOT NULL,
  front_reset_cents integer NOT NULL,
  full_reset_cents  integer NOT NULL,
  front_new_cents   integer NOT NULL,
  full_new_cents    integer NOT NULL,
  created_at      timestamptz NOT NULL
);

CREATE TABLE barn_days (
  id             text PRIMARY KEY,
  barn_id        text NOT NULL REFERENCES barns(id),
  business_date  date NOT NULL,
  start_time     text NOT NULL,
  starts_at      timestamptz NOT NULL,
  cancellation_cutoff_at timestamptz NOT NULL,
  slot_count     integer NOT NULL CHECK (slot_count BETWEEN 1 AND 12),
  slot_minutes   integer NOT NULL CHECK (slot_minutes BETWEEN 15 AND 120),
  trip_fee_cents integer NOT NULL CHECK (trip_fee_cents BETWEEN 0 AND 100000),
  status         text NOT NULL CHECK (status IN ('draft','published','in_progress','closed','cancelled')),
  started_at     timestamptz,
  closed_at      timestamptz,
  stream_seq     bigint NOT NULL DEFAULT 0,
  adjustment_seq integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL
);

CREATE TABLE slots (
  id           text PRIMARY KEY,
  barn_day_id  text NOT NULL REFERENCES barn_days(id),
  position     integer NOT NULL,
  slot_time    text NOT NULL
);
CREATE UNIQUE INDEX slots_day_position_uq ON slots (barn_day_id, position);

-- The one practice-wide booking number sequence. A counter row, not a Postgres
-- sequence, so a rolled-back claim leaves no gap.
CREATE TABLE counters (
  name  text PRIMARY KEY,
  value bigint NOT NULL
);

CREATE TABLE bookings (
  id              text PRIMARY KEY,
  number          bigint NOT NULL UNIQUE,
  barn_day_id     text NOT NULL REFERENCES barn_days(id),
  slot_id         text NOT NULL REFERENCES slots(id),
  horse_id        text NOT NULL REFERENCES horses(id),
  owner_id        text NOT NULL REFERENCES users(id),
  -- 'released', 'lapsed' and 'removed' holds are gone: they appear in no list.
  status          text NOT NULL CHECK (status IN (
                    'held','confirmed','cancelled_in_time','cancelled_late','worked','no_show',
                    'excused','released','lapsed','removed')),
  is_offer        boolean NOT NULL DEFAULT false,
  hold_expires_at timestamptz,
  deposit_cents   integer NOT NULL,
  counts_for_trip boolean NOT NULL DEFAULT false,
  initial_share_cents integer,
  share_cents     integer,
  decided_at      timestamptz,
  lapse_recorded  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL
);
CREATE INDEX bookings_day_idx ON bookings (barn_day_id);
CREATE INDEX bookings_slot_idx ON bookings (slot_id);
CREATE INDEX bookings_horse_idx ON bookings (horse_id);
CREATE INDEX bookings_owner_idx ON bookings (owner_id);

-- A slot never holds two live bookings.
CREATE UNIQUE INDEX bookings_live_slot_uq ON bookings (slot_id)
  WHERE status IN ('held','confirmed','worked','no_show');
-- A horse has at most one live booking on a day.
CREATE UNIQUE INDEX bookings_live_horse_day_uq ON bookings (barn_day_id, horse_id)
  WHERE status IN ('held','confirmed','worked','no_show');

CREATE TABLE waitlist_entries (
  id           text PRIMARY KEY,
  barn_day_id  text NOT NULL REFERENCES barn_days(id),
  horse_id     text NOT NULL REFERENCES horses(id),
  owner_id     text NOT NULL REFERENCES users(id),
  position     integer NOT NULL,
  joined_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX waitlist_day_horse_uq ON waitlist_entries (barn_day_id, horse_id);
-- Positions are kept contiguous under the barn day's row lock, which serialises every
-- join, offer and removal, so the index orders rather than constrains them.
CREATE INDEX waitlist_day_position_idx ON waitlist_entries (barn_day_id, position);

CREATE TABLE trip_share_adjustments (
  id              text PRIMARY KEY,
  barn_day_id     text NOT NULL REFERENCES barn_days(id),
  seq             integer NOT NULL,
  booking_id      text NOT NULL REFERENCES bookings(id),
  delta_cents     integer NOT NULL,
  cause_booking_id text NOT NULL REFERENCES bookings(id),
  at              timestamptz NOT NULL
);
CREATE UNIQUE INDEX trip_share_adjustments_seq_uq ON trip_share_adjustments (barn_day_id, seq);

CREATE TABLE visits (
  id             text PRIMARY KEY,
  horse_id       text NOT NULL REFERENCES horses(id),
  booking_id     text UNIQUE REFERENCES bookings(id),
  barn_day_id    text REFERENCES barn_days(id),
  business_date  date NOT NULL,
  status         text NOT NULL CHECK (status IN ('open','closed','invoice_pending','invoiced')),
  note           text,
  work_codes     text[],
  seeded_history boolean NOT NULL DEFAULT false,
  closed_at      timestamptz,
  close_lease_expires_at timestamptz,
  created_at     timestamptz NOT NULL
);
CREATE INDEX visits_horse_idx ON visits (horse_id);

CREATE TABLE photos (
  id            text PRIMARY KEY,
  visit_id      text NOT NULL REFERENCES visits(id),
  hoof          text NOT NULL CHECK (hoof IN ('LF','RF','LH','RH')),
  phase         text NOT NULL CHECK (phase IN ('before','after')),
  content_type  text NOT NULL,
  extension     text NOT NULL,
  width         integer NOT NULL,
  height        integer NOT NULL,
  stored_bytes  integer NOT NULL,
  object_key    text NOT NULL,
  thumbnail_status text NOT NULL CHECK (thumbnail_status IN ('pending','ready','failed')),
  thumbnail_key text,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX photos_visit_hoof_phase_uq ON photos (visit_id, hoof, phase) WHERE deleted_at IS NULL;

CREATE TABLE upload_sessions (
  id           text PRIMARY KEY,
  visit_id     text NOT NULL REFERENCES visits(id),
  hoof         text NOT NULL,
  phase        text NOT NULL,
  size_bytes   integer NOT NULL,
  chunk_bytes  integer NOT NULL,
  upload_offset integer NOT NULL DEFAULT 0,
  chunk_count  integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  ended_reason text CHECK (ended_reason IN ('completed','deleted','visit_closed','refused')),
  reserved_bytes integer NOT NULL,
  created_at   timestamptz NOT NULL
);
CREATE INDEX upload_sessions_visit_idx ON upload_sessions (visit_id);

CREATE TABLE hoof_marks (
  id            text PRIMARY KEY,
  visit_id      text NOT NULL REFERENCES visits(id),
  hoof          text NOT NULL,
  version       integer NOT NULL,
  wall_x1 integer NOT NULL, wall_y1 integer NOT NULL, wall_x2 integer NOT NULL, wall_y2 integer NOT NULL,
  past_x1 integer NOT NULL, past_y1 integer NOT NULL, past_x2 integer NOT NULL, past_y2 integer NOT NULL,
  wall_angle    numeric(5,1) NOT NULL,
  past_angle    numeric(5,1) NOT NULL,
  alignment     text NOT NULL CHECK (alignment IN ('aligned','broken-back','broken-forward')),
  saved_by      text NOT NULL REFERENCES users(id),
  saved_at      timestamptz NOT NULL,
  restored_from integer,
  current       boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX hoof_marks_version_uq ON hoof_marks (visit_id, hoof, version);
CREATE UNIQUE INDEX hoof_marks_current_uq ON hoof_marks (visit_id, hoof) WHERE current;

CREATE TABLE invoices (
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('visit','trip','deposit')),
  status        text NOT NULL CHECK (status IN ('pending','unpaid','paid')),
  owner_id      text NOT NULL REFERENCES users(id),
  horse_id      text NOT NULL REFERENCES horses(id),
  visit_id      text REFERENCES visits(id),
  booking_id    text REFERENCES bookings(id),
  barn_day_id   text REFERENCES barn_days(id),
  business_date date NOT NULL,
  items         jsonb NOT NULL,
  total_cents   integer NOT NULL,
  balance_cents integer NOT NULL,
  killbill_invoice_id text,
  killbill_charges_done boolean NOT NULL DEFAULT false,
  deposit_transfer_done boolean NOT NULL DEFAULT false,
  dunning_state text NOT NULL DEFAULT 'none'
                CHECK (dunning_state IN ('none','past_due','retry_1','retry_2','blocked','cleared')),
  first_declined_at timestamptz,
  reconciliation text NOT NULL DEFAULT 'unchecked'
                CHECK (reconciliation IN ('unchecked','matched','mismatch','unavailable')),
  pending_since timestamptz,
  next_attempt_at timestamptz,
  lease_expires_at timestamptz,
  created_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX invoices_visit_uq ON invoices (visit_id) WHERE visit_id IS NOT NULL AND kind = 'visit';
CREATE UNIQUE INDEX invoices_trip_booking_uq ON invoices (booking_id) WHERE kind = 'trip';
CREATE INDEX invoices_owner_idx ON invoices (owner_id);
CREATE INDEX invoices_pending_idx ON invoices (status) WHERE status = 'pending';

CREATE TABLE payments (
  id              text PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('deposit','invoice')),
  status          text NOT NULL CHECK (status IN
                    ('authorized','captured','partially_refunded','refunded','voided','declined')),
  owner_id        text NOT NULL REFERENCES users(id),
  booking_id      text REFERENCES bookings(id),
  invoice_id      text REFERENCES invoices(id),
  amount_cents    integer NOT NULL,
  captured_cents  integer NOT NULL DEFAULT 0,
  refunded_cents  integer NOT NULL DEFAULT 0,
  applied_cents   integer NOT NULL DEFAULT 0,
  disposition     text CHECK (disposition IN ('held','forfeited','applied')),
  card_token      text NOT NULL,
  card_last4      text NOT NULL,
  decline_code    text,
  killbill_status text NOT NULL DEFAULT 'not_recorded'
                  CHECK (killbill_status IN ('not_recorded','pending','recorded')),
  killbill_invoice_id text,
  killbill_payment_id text,
  pending_since   timestamptz,
  next_attempt_at timestamptz,
  lease_expires_at timestamptz,
  created_at      timestamptz NOT NULL
);
CREATE INDEX payments_booking_idx ON payments (booking_id);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
CREATE INDEX payments_owner_idx ON payments (owner_id);

CREATE TABLE refunds (
  id            text PRIMARY KEY,
  payment_id    text NOT NULL REFERENCES payments(id),
  amount_cents  integer NOT NULL,
  reason        text NOT NULL,
  killbill_key  text NOT NULL,
  killbill_status text NOT NULL CHECK (killbill_status IN ('not_recorded','pending','recorded')),
  at            timestamptz NOT NULL,
  created_at    timestamptz NOT NULL
);

CREATE TABLE ledger_entries (
  id          text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN
                ('billed','deposit_captured','invoice_payment','refund',
                 'deposit_transfer_out','deposit_transfer_in')),
  amount_cents integer NOT NULL,
  at          timestamptz NOT NULL,
  owner_id    text NOT NULL REFERENCES users(id),
  horse_id    text NOT NULL REFERENCES horses(id),
  business_date date NOT NULL,
  invoice_id  text REFERENCES invoices(id),
  payment_id  text REFERENCES payments(id),
  refund_id   text REFERENCES refunds(id),
  created_at  timestamptz NOT NULL
);
CREATE INDEX ledger_at_idx ON ledger_entries (at);

CREATE TABLE idempotency_claims (
  id             text PRIMARY KEY,
  actor_key      text NOT NULL,
  route_key      text NOT NULL,
  idem_key       text NOT NULL,
  body_hash      text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  response_status integer,
  response_body  jsonb,
  created_at     timestamptz NOT NULL
);
CREATE UNIQUE INDEX idempotency_uq ON idempotency_claims (actor_key, route_key, idem_key);

CREATE TABLE rate_limit_buckets (
  bucket_key  text PRIMARY KEY,
  tokens      double precision NOT NULL,
  updated_at  timestamptz NOT NULL
);

CREATE TABLE stream_events (
  id          bigserial PRIMARY KEY,
  channel     text NOT NULL,
  seq         bigint NOT NULL,
  event       text NOT NULL,
  data        jsonb NOT NULL,
  at          timestamptz NOT NULL
);
CREATE UNIQUE INDEX stream_events_channel_seq_uq ON stream_events (channel, seq);

CREATE TABLE jobs (
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN
                  ('thumbnail','dunning_retry','due_reminder','offer_pass','csv_export')),
  status        text NOT NULL CHECK (status IN ('queued','running','succeeded','dead')),
  payload       jsonb NOT NULL,
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL,
  run_at        timestamptz NOT NULL,
  lease_expires_at timestamptz,
  lease_holder  text,
  last_error    text,
  result        jsonb,
  dedupe_key    text,
  request_id    text,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX jobs_dedupe_uq ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX jobs_due_idx ON jobs (status, run_at);

CREATE TABLE email_outbox (
  id            text PRIMARY KEY,
  to_address    text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  queue_kind    text NOT NULL CHECK (queue_kind IN ('request','background')),
  status        text NOT NULL CHECK (status IN ('queued','sent','dead')),
  attempts      integer NOT NULL DEFAULT 0,
  claimed_by    text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  first_attempt_pending boolean NOT NULL DEFAULT false,
  dedupe_key    text,
  last_error    text,
  last_attempt_by text,
  last_attempt_at timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX email_outbox_dedupe_uq ON email_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE api_tokens (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  scope       text NOT NULL CHECK (scope IN ('read_only','billing')),
  token_hash  text NOT NULL UNIQUE,
  user_id     text NOT NULL REFERENCES users(id),
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL
);

CREATE TABLE photo_signing_keys (
  id          text PRIMARY KEY,
  secret      bytea NOT NULL,
  created_at  timestamptz NOT NULL,
  retired_at  timestamptz
);

CREATE TABLE vet_links (
  id              text PRIMARY KEY,
  horse_id        text NOT NULL REFERENCES horses(id),
  vet_name        text NOT NULL,
  vet_email       text NOT NULL,
  token_hash      text NOT NULL,
  issued_previous_visit_id text NOT NULL REFERENCES visits(id),
  issued_current_visit_id  text NOT NULL REFERENCES visits(id),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL
);
CREATE INDEX vet_links_token_idx ON vet_links (token_hash);

CREATE TABLE vet_link_views (
  id              text PRIMARY KEY,
  vet_link_id     text NOT NULL REFERENCES vet_links(id),
  at              timestamptz NOT NULL,
  address         text NOT NULL,
  outcome         text NOT NULL CHECK (outcome IN ('viewed','expired','revoked')),
  user_agent      text NOT NULL,
  previous_visit_id text REFERENCES visits(id),
  current_visit_id  text REFERENCES visits(id)
);
CREATE INDEX vet_link_views_link_idx ON vet_link_views (vet_link_id, at DESC);

CREATE TABLE vet_link_misses (
  id       bigserial PRIMARY KEY,
  address  text NOT NULL,
  at       timestamptz NOT NULL
);
CREATE INDEX vet_link_misses_idx ON vet_link_misses (address, at);

CREATE TABLE imports (
  id              text PRIMARY KEY,
  created_owners  integer NOT NULL,
  matched_owners  integer NOT NULL,
  created_horses  integer NOT NULL,
  updated_horses  integer NOT NULL,
  rows            integer NOT NULL,
  at              timestamptz NOT NULL
);

CREATE TABLE alert_states (
  threshold_cents integer PRIMARY KEY,
  armed           boolean NOT NULL
);

CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  at          timestamptz NOT NULL,
  actor_type  text NOT NULL CHECK (actor_type IN ('user','token','system')),
  actor_id    text,
  action      text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN
                ('barn_day','booking','visit','invoice','payment','vet_link','price_list',
                 'api_token','import','dunning')),
  entity_id   text NOT NULL,
  from_state  text,
  to_state    text,
  request_id  text
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- The audit log is append-only; the database itself refuses any edit.
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TABLE due_reminders_sent (
  horse_id      text NOT NULL REFERENCES horses(id),
  next_due_date date NOT NULL,
  PRIMARY KEY (horse_id, next_due_date)
);

CREATE TABLE seed_state (
  id        integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seeded_at timestamptz NOT NULL,
  seed_date date NOT NULL
);
