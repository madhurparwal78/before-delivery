// The schema, applied idempotently on serve under one advisory lock.

import { inTransaction } from "./db";

const MIGRATION_LOCK = 71260411;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  role text NOT NULL,
  name text NOT NULL,
  email text,
  password_hash text
);
CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY REFERENCES people ON DELETE CASCADE,
  phone text,
  date_of_birth text,
  sex text,
  state text,
  time_zone text,
  address_line1 text,
  address_line2 text,
  city text,
  postal_code text,
  gate_notes text,
  account_state text NOT NULL DEFAULT 'active',
  erases_at timestamptz,
  membership_state text NOT NULL DEFAULT 'free',
  cadence text,
  renewal_date text,
  plus_until text,
  pending_cadence text,
  pending_from text,
  killbill_account_id text,
  killbill_subscription_id text,
  join_started_at timestamptz,
  membership_before_closure jsonb,
  seed_receipt_number integer,
  thread_state text NOT NULL DEFAULT 'open',
  killbill_scrub_needed boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS request_keys (
  member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
  key text NOT NULL,
  body_hash text NOT NULL,
  status integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key)
);

CREATE TABLE IF NOT EXISTS phlebotomists (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  states text[] NOT NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS draws (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
  phlebotomist_id text NOT NULL REFERENCES phlebotomists,
  state text NOT NULL,
  starts_at timestamptz NOT NULL,
  local_date text NOT NULL,
  local_time text NOT NULL,
  collected_at timestamptz,
  kit_codes text[] NOT NULL DEFAULT '{}',
  booked_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS one_booking_per_slot ON draws (phlebotomist_id, starts_at) WHERE state <> 'cancelled';
CREATE INDEX IF NOT EXISTS draws_member ON draws (member_id);

CREATE TABLE IF NOT EXISTS visit_pages (
  token text PRIMARY KEY,
  draw_id text NOT NULL REFERENCES draws ON DELETE CASCADE,
  sent_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS visit_pages_draw ON visit_pages (draw_id);

CREATE TABLE IF NOT EXISTS results (
  id text PRIMARY KEY,
  draw_id text NOT NULL REFERENCES draws ON DELETE CASCADE,
  marker text NOT NULL,
  value text NOT NULL,
  note text,
  corrected_by text,
  corrected_at timestamptz,
  UNIQUE (draw_id, marker)
);

CREATE TABLE IF NOT EXISTS result_history (
  seq bigserial PRIMARY KEY,
  result_id text NOT NULL REFERENCES results ON DELETE CASCADE,
  value text NOT NULL,
  note text,
  by_name text NOT NULL,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  draw_id text PRIMARY KEY REFERENCES draws ON DELETE CASCADE,
  sha256 text NOT NULL
);

CREATE TABLE IF NOT EXISTS range_tables (
  id text PRIMARY KEY,
  marker text NOT NULL,
  effective_from text NOT NULL,
  rows jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL,
  UNIQUE (marker, effective_from)
);

CREATE TABLE IF NOT EXISTS blends (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
  items jsonb NOT NULL,
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
  state text NOT NULL,
  based_on_plan_id text,
  nutrition text NOT NULL,
  movement text NOT NULL,
  sleep text NOT NULL,
  supplements text NOT NULL,
  published_at timestamptz,
  published_by text,
  blend_id text REFERENCES blends (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
  from_role text NOT NULL,
  from_name text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  message_id text NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
  kind text NOT NULL,
  bytes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_events (
  seq bigserial PRIMARY KEY,
  person_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  kind text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_person ON rate_events (person_id, kind, at);

CREATE TABLE IF NOT EXISTS receipts (
  id text PRIMARY KEY,
  number integer NOT NULL UNIQUE,
  invoice_id text NOT NULL UNIQUE,
  member_id text NOT NULL REFERENCES members,
  paid_at timestamptz NOT NULL,
  paid_date text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL,
  items jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_month ON receipts (paid_date, number);

CREATE TABLE IF NOT EXISTS pending_mail (
  seq bigserial PRIMARY KEY,
  member_id text REFERENCES members ON DELETE CASCADE,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL
);

CREATE TABLE IF NOT EXISTS erasure_objects (
  member_id text NOT NULL REFERENCES members,
  object_key text NOT NULL,
  PRIMARY KEY (member_id, object_key)
);
`;

export async function applySchema(): Promise<void> {
  await inTransaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await db.query(SCHEMA);
  });
}
