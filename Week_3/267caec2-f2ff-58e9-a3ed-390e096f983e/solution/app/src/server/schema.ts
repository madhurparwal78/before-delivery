// Applied idempotently every time the app serves (brief: Services, Postgres).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS studios (
  id text PRIMARY KEY,
  name text NOT NULL,
  contact_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS studios_name_key ON studios (lower(name));

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('director', 'juror', 'studio')),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  studio_id text REFERENCES studios (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS programs (
  id text PRIMARY KEY,
  seq bigserial,
  name text NOT NULL,
  year integer NOT NULL,
  time_zone text NOT NULL,
  early_bird_date date NOT NULL,
  deadline_date date NOT NULL,
  early_bird_fee_cents integer NOT NULL,
  standard_fee_cents integer NOT NULL,
  last_entry_number integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY,
  seq bigserial,
  program_id text NOT NULL REFERENCES programs (id),
  name text NOT NULL,
  shortlist_size integer NOT NULL,
  finalist_count integer NOT NULL,
  embargo_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_key ON categories (program_id, lower(name));

CREATE TABLE IF NOT EXISTS rounds (
  id text PRIMARY KEY,
  category_id text NOT NULL REFERENCES categories (id),
  kind text NOT NULL CHECK (kind IN ('round_1', 'final')),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'scheduled',
  ballot_deadline date,
  opened_at timestamptz,
  closed_at timestamptz,
  packet_pending boolean NOT NULL DEFAULT false,
  packet_version integer NOT NULL DEFAULT 0,
  UNIQUE (category_id, kind)
);
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS packet_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS entries (
  id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES programs (id),
  category_id text NOT NULL REFERENCES categories (id),
  studio_id text NOT NULL REFERENCES studios (id),
  entry_number integer NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  site_url text NOT NULL,
  credits text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'draft',
  award text,
  disqualify_reason text,
  fee_tier text,
  fee_cents integer,
  invoice_id text,
  invoice_item_id text,
  payment_id text,
  paid_at timestamptz,
  refund_cents integer,
  refunded_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (program_id, entry_number)
);
CREATE INDEX IF NOT EXISTS entries_studio_idx ON entries (studio_id);
CREATE INDEX IF NOT EXISTS entries_category_idx ON entries (category_id);
CREATE UNIQUE INDEX IF NOT EXISTS entries_invoice_key ON entries (invoice_id);

CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  entry_id text NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
  seq bigserial,
  name text NOT NULL,
  type text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  bytes integer NOT NULL,
  storage_key text NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_entry_idx ON assets (entry_id);

CREATE TABLE IF NOT EXISTS conflicts (
  juror_id text NOT NULL REFERENCES users (id),
  studio_id text NOT NULL REFERENCES studios (id),
  note text NOT NULL DEFAULT '',
  declared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (juror_id, studio_id)
);

CREATE TABLE IF NOT EXISTS panel_members (
  round_id text NOT NULL REFERENCES rounds (id),
  juror_id text NOT NULL REFERENCES users (id),
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (round_id, juror_id)
);

CREATE TABLE IF NOT EXISTS round_entries (
  round_id text NOT NULL REFERENCES rounds (id),
  entry_id text NOT NULL REFERENCES entries (id),
  PRIMARY KEY (round_id, entry_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  round_id text NOT NULL REFERENCES rounds (id),
  juror_id text NOT NULL REFERENCES users (id),
  entry_id text NOT NULL REFERENCES entries (id),
  PRIMARY KEY (round_id, juror_id, entry_id)
);

CREATE TABLE IF NOT EXISTS recusals (
  round_id text NOT NULL REFERENCES rounds (id),
  juror_id text NOT NULL REFERENCES users (id),
  entry_id text NOT NULL REFERENCES entries (id),
  note text NOT NULL DEFAULT '',
  recused_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, juror_id, entry_id)
);

CREATE TABLE IF NOT EXISTS scores (
  round_id text NOT NULL REFERENCES rounds (id),
  juror_id text NOT NULL REFERENCES users (id),
  entry_id text NOT NULL REFERENCES entries (id),
  craft integer NOT NULL,
  clarity integer NOT NULL,
  idea integer NOT NULL,
  story integer NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, juror_id, entry_id)
);

CREATE TABLE IF NOT EXISTS ballots (
  round_id text NOT NULL REFERENCES rounds (id),
  juror_id text NOT NULL REFERENCES users (id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, juror_id)
);

CREATE TABLE IF NOT EXISTS round_results (
  round_id text NOT NULL REFERENCES rounds (id),
  entry_id text NOT NULL REFERENCES entries (id),
  rank integer NOT NULL,
  score text,
  idea_mean numeric(12, 4),
  ballots_counted integer NOT NULL,
  cut text NOT NULL,
  award text,
  PRIMARY KEY (round_id, entry_id)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  studio_id text NOT NULL REFERENCES studios (id),
  key text NOT NULL,
  entry_id text NOT NULL REFERENCES entries (id),
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (studio_id, key)
);

CREATE TABLE IF NOT EXISTS emails (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  due_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emails_unsent_idx ON emails (next_attempt_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  seq bigserial,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  detail jsonb NOT NULL DEFAULT '{}'
);
`;
