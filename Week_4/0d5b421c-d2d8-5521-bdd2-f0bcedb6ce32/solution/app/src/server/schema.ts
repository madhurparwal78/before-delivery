// The schema, applied idempotently on every serve.

export const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS rooms (
  room_id text PRIMARY KEY,
  name text NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS tables (
  table_id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms (room_id),
  min_seats int NOT NULL,
  max_seats int NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS joinable_pairs (
  pair_id text PRIMARY KEY,
  table_a text NOT NULL REFERENCES tables (table_id),
  table_b text NOT NULL REFERENCES tables (table_id),
  min_seats int NOT NULL,
  max_seats int NOT NULL
);

CREATE TABLE IF NOT EXISTS published_rules (
  id int PRIMARY KEY CHECK (id = 1),
  body jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS host_accounts (
  email text PRIMARY KEY,
  name text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS host_sessions (
  token_hash text PRIMARY KEY,
  email text NOT NULL REFERENCES host_accounts (email),
  signed_in_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_references (
  reference text PRIMARY KEY,
  owner_id text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS holds (
  hold_id text PRIMARY KEY,
  date text NOT NULL,
  time text NOT NULL,
  party_size int NOT NULL,
  target_id text NOT NULL,
  table_ids text[] NOT NULL,
  status text NOT NULL,
  deposit_cents int NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS holds_live ON holds (status, expires_at);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  entry_id text PRIMARY KEY,
  sequence bigserial NOT NULL,
  date text NOT NULL,
  party_size int NOT NULL,
  earliest text NOT NULL,
  latest text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_entry_per_email_and_date
  ON waitlist_entries (lower(email), date) WHERE status IN ('waiting', 'offered');

CREATE TABLE IF NOT EXISTS offers (
  offer_id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  entry_id text NOT NULL REFERENCES waitlist_entries (entry_id),
  date text NOT NULL,
  time text NOT NULL,
  party_size int NOT NULL,
  target_id text NOT NULL,
  table_ids text[] NOT NULL,
  status text NOT NULL,
  deposit_cents int NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offers_live ON offers (status, expires_at);

CREATE TABLE IF NOT EXISTS bookings (
  reference text PRIMARY KEY,
  sequence bigserial NOT NULL,
  token text UNIQUE,
  status text NOT NULL,
  source text NOT NULL,
  date text NOT NULL,
  time text NOT NULL,
  starts_at timestamptz NOT NULL,
  party_size int NOT NULL,
  target_id text NOT NULL,
  table_ids text[] NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  deposit_cents int NOT NULL,
  deposit_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_by_date ON bookings (date, time, sequence);

CREATE TABLE IF NOT EXISTS booking_tables (
  reference text NOT NULL REFERENCES bookings (reference) ON DELETE CASCADE,
  table_id text NOT NULL,
  occupied tstzrange NOT NULL,
  EXCLUDE USING gist (table_id WITH =, occupied WITH &&)
);

CREATE TABLE IF NOT EXISTS payments (
  id bigserial PRIMARY KEY,
  reference text NOT NULL,
  kind text NOT NULL,
  amount_cents int NOT NULL,
  killbill_account_id text NOT NULL,
  killbill_payment_id text NOT NULL,
  killbill_transaction_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reference, kind)
);

CREATE TABLE IF NOT EXISTS emails (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS emails_unsent ON emails (id) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS freed_tables (
  id bigserial PRIMARY KEY,
  date text NOT NULL,
  table_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS freed_tables_unprocessed ON freed_tables (id) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_records (
  key text PRIMARY KEY,
  fingerprint text NOT NULL,
  status int NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
