export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('director','juror','studio')),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  studio_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS studios (
  id text PRIMARY KEY,
  name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS studios_name_lower ON studios (lower(name));

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS programs (
  id text PRIMARY KEY,
  name text NOT NULL,
  year int NOT NULL,
  time_zone text NOT NULL,
  early_bird_date date NOT NULL,
  deadline_date date NOT NULL,
  early_bird_fee_cents int NOT NULL,
  standard_fee_cents int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS program_counters (
  program_id text PRIMARY KEY REFERENCES programs(id) ON DELETE CASCADE,
  next_entry_number int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name text NOT NULL,
  shortlist_size int NOT NULL,
  finalist_count int NOT NULL,
  embargo_at timestamptz,
  results_email_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_program_name ON categories (program_id, lower(name));

CREATE TABLE IF NOT EXISTS rounds (
  id text PRIMARY KEY,
  category_id text NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('round_1','final')),
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','open','closed','normalised','published')),
  seq int NOT NULL,
  ballot_deadline date,
  opened_at timestamptz,
  closed_at timestamptz,
  packet_dirty boolean NOT NULL DEFAULT false,
  UNIQUE (category_id, seq)
);

CREATE TABLE IF NOT EXISTS entries (
  id text PRIMARY KEY,
  program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  studio_id text NOT NULL REFERENCES studios(id),
  entry_number int NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  site_url text NOT NULL,
  credits text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','submitted','screened','disqualified','withdrawn','round_1','shortlisted','eliminated','final_round','winner','finalist','honourable_mention','published')),
  submitted_at timestamptz,
  paid_fee_cents int,
  fee_tier text,
  invoice_id text,
  payment_id text,
  paid_at timestamptz,
  refunded_at timestamptz,
  refund_amount_cents int,
  disqualify_reason text,
  award text,
  r1_score numeric(6,2),
  r1_idea_mean numeric(8,4),
  r1_rank int,
  final_score numeric(6,2),
  final_idea_mean numeric(8,4),
  final_rank int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, entry_number)
);
CREATE INDEX IF NOT EXISTS entries_category ON entries (category_id);
CREATE INDEX IF NOT EXISTS entries_studio_idx ON entries (studio_id);

CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  entry_id text NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('image/png','image/jpeg')),
  width int NOT NULL,
  height int NOT NULL,
  bytes int NOT NULL,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_entry_idx ON assets (entry_id);

CREATE TABLE IF NOT EXISTS panel (
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  juror_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, juror_id)
);

CREATE TABLE IF NOT EXISTS conflicts (
  id text PRIMARY KEY,
  juror_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  studio_id text NOT NULL REFERENCES studios(id),
  note text,
  declared_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (juror_id, studio_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id text PRIMARY KEY,
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  juror_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id text NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  note text,
  recused_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, juror_id, entry_id)
);
CREATE INDEX IF NOT EXISTS assignments_juror ON assignments (juror_id, round_id);

CREATE TABLE IF NOT EXISTS scores (
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  juror_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id text NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  craft int NOT NULL,
  clarity int NOT NULL,
  idea int NOT NULL,
  story int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, juror_id, entry_id)
);

CREATE TABLE IF NOT EXISTS ballots (
  round_id text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  juror_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counted int NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, juror_id)
);

CREATE TABLE IF NOT EXISTS round_results (
  round_id text PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
  provisional boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  rows jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  studio_id text NOT NULL REFERENCES studios(id),
  key text NOT NULL,
  entry_id text,
  status int,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (studio_id, key)
);

CREATE TABLE IF NOT EXISTS email_queue (
  id text PRIMARY KEY,
  kind text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS email_queue_pending ON email_queue (queued_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  director_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  detail text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS killbill_mirror (
  invoice_id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id),
  entry_id text NOT NULL REFERENCES entries(id),
  entry_number int NOT NULL,
  amount_cents int NOT NULL,
  currency text NOT NULL,
  tier text NOT NULL,
  status text NOT NULL DEFAULT 'paid',
  paid_at timestamptz NOT NULL
);
`;
