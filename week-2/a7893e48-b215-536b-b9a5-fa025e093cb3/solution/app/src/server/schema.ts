/** Applied on every serve (idempotent), under an advisory lock so concurrent instances wait their turn. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE IF NOT EXISTS operators (id text PRIMARY KEY, name text NOT NULL);

CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY, operator_id text NOT NULL REFERENCES operators(id), name text NOT NULL,
  time_zone text NOT NULL, deposit_cents integer NOT NULL, cleaning_fee_cents integer NOT NULL, position integer NOT NULL);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY, site_id text NOT NULL REFERENCES sites(id), name text NOT NULL,
  rate_cents integer NOT NULL, position integer NOT NULL);

CREATE TABLE IF NOT EXISTS renters (
  id text PRIMARY KEY, operator_id text NOT NULL REFERENCES operators(id), home_site_id text NOT NULL REFERENCES sites(id),
  name text NOT NULL, business text NOT NULL, email text NOT NULL UNIQUE, phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS billing_accounts (renter_id text PRIMARY KEY REFERENCES renters(id), account_id text NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, role text NOT NULL,
  operator_id text NOT NULL REFERENCES operators(id), site_id text REFERENCES sites(id),
  renter_id text REFERENCES renters(id), password_hash text NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS policy_versions (
  id text PRIMARY KEY, site_id text NOT NULL REFERENCES sites(id), notice_hours integer NOT NULL,
  effective_from text NOT NULL, effective_at timestamptz NOT NULL, created_by_name text NOT NULL,
  created_at timestamptz NOT NULL, UNIQUE (site_id, effective_from));

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY, site_id text NOT NULL REFERENCES sites(id), station_id text NOT NULL REFERENCES stations(id),
  renter_id text NOT NULL REFERENCES renters(id), status text NOT NULL, created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, quoted_pack_minutes integer NOT NULL DEFAULT 0, ended_at timestamptz);

CREATE TABLE IF NOT EXISTS hold_occurrences (
  hold_id text NOT NULL REFERENCES holds(id), position integer NOT NULL, local_date text NOT NULL,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, PRIMARY KEY (hold_id, position));
CREATE INDEX IF NOT EXISTS hold_occurrences_time ON hold_occurrences (start_at, end_at);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY, hold_id text REFERENCES holds(id), site_id text NOT NULL REFERENCES sites(id),
  station_id text NOT NULL REFERENCES stations(id), renter_id text NOT NULL REFERENCES renters(id),
  status text NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, minutes integer NOT NULL,
  pack_minutes integer NOT NULL, card_minutes integer NOT NULL, card_cents integer NOT NULL, deposit_cents integer NOT NULL,
  cutoff_at timestamptz, deposit_payment_id text, time_payment_id text,
  policy_version_id text NOT NULL REFERENCES policy_versions(id), confirmed_at timestamptz NOT NULL,
  checked_in_at timestamptz, checked_out_at timestamptz, overrun_minutes integer, overrun_cents integer,
  overrun_payment_id text, cleaning_fee_cents integer, cleaning_payment_id text,
  card_refund_cents integer NOT NULL DEFAULT 0, deposit_refund_cents integer NOT NULL DEFAULT 0,
  pack_returned_minutes integer NOT NULL DEFAULT 0, cancelled_at timestamptz);
CREATE INDEX IF NOT EXISTS bookings_time ON bookings (station_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS bookings_renter ON bookings (renter_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY, booking_id text REFERENCES bookings(id), hold_id text REFERENCES holds(id),
  at timestamptz NOT NULL, actor_name text NOT NULL, actor_role text NOT NULL, action text NOT NULL,
  from_status text, to_status text, reason text);
CREATE INDEX IF NOT EXISTS audit_booking ON audit_events (booking_id);

CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY, renter_id text NOT NULL REFERENCES renters(id), minutes integer NOT NULL,
  price_cents integer NOT NULL, kb_payment_id text, created_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS pack_entries (
  id text PRIMARY KEY, movement_id text NOT NULL, renter_id text NOT NULL REFERENCES renters(id),
  account text NOT NULL, minutes integer NOT NULL, reason text NOT NULL, booking_id text REFERENCES bookings(id),
  pack_id text REFERENCES packs(id), created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS pack_entries_renter ON pack_entries (renter_id, created_at);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY, renter_id text NOT NULL REFERENCES renters(id), kind text NOT NULL,
  valid_from text NOT NULL, expires_on text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL,
  uploaded_at timestamptz NOT NULL, reminder_queued_at timestamptz);

CREATE TABLE IF NOT EXISTS binder_links (
  id text PRIMARY KEY, site_id text NOT NULL REFERENCES sites(id), from_date text NOT NULL, to_date text NOT NULL,
  token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL, generated_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS emails (
  id bigserial PRIMARY KEY, to_address text NOT NULL, subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL, sent_at timestamptz, claimed_until timestamptz);
CREATE INDEX IF NOT EXISTS emails_unsent ON emails (id) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL, path text NOT NULL, key text NOT NULL, fingerprint text NOT NULL,
  status_code integer, response text, created_at timestamptz NOT NULL, PRIMARY KEY (user_id, path, key));
`;
