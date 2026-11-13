CREATE TABLE IF NOT EXISTS studios (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  contact_name text NOT NULL,
  email        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS studios_name_unique ON studios (lower(name));

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  role          text NOT NULL,
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,
  studio_id     text REFERENCES studios (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS programs (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  year                  integer NOT NULL,
  time_zone             text NOT NULL,
  early_bird_date       date NOT NULL,
  deadline_date         date NOT NULL,
  early_bird_fee_cents  integer NOT NULL,
  standard_fee_cents    integer NOT NULL,
  next_entry_number     integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  seq                   bigserial
);

CREATE TABLE IF NOT EXISTS categories (
  id             text PRIMARY KEY,
  program_id     text NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  name           text NOT NULL,
  shortlist_size integer NOT NULL,
  finalist_count integer NOT NULL,
  published      boolean NOT NULL DEFAULT false,
  embargo_at     timestamptz,
  results_queued boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  seq            bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique ON categories (program_id, lower(name));

CREATE TABLE IF NOT EXISTS rounds (
  id              text PRIMARY KEY,
  category_id     text NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  name            text NOT NULL,
  kind            text NOT NULL,
  state           text NOT NULL DEFAULT 'scheduled',
  ballot_deadline date,
  opened_at       timestamptz,
  closed_at       timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS rounds_kind_unique ON rounds (category_id, kind);

CREATE TABLE IF NOT EXISTS entries (
  id                   text PRIMARY KEY,
  program_id           text NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  category_id          text NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  studio_id            text NOT NULL REFERENCES studios (id) ON DELETE CASCADE,
  entry_number         integer NOT NULL,
  title                text NOT NULL,
  summary              text NOT NULL,
  site_url             text NOT NULL,
  credits              text NOT NULL DEFAULT '',
  state                text NOT NULL DEFAULT 'draft',
  disqualify_reason    text,
  award                text,
  fee_tier             text,
  fee_cents            integer,
  invoice_id           text,
  invoice_item_id      text,
  payment_id           text,
  paid_at              timestamptz,
  refund_amount_cents  integer,
  refunded_at          timestamptz,
  charge_attempts      integer NOT NULL DEFAULT 0,
  submitted_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  seq                  bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS entries_number_unique ON entries (program_id, entry_number);

CREATE TABLE IF NOT EXISTS assets (
  id           text PRIMARY KEY,
  entry_id     text NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
  storage_key  text NOT NULL,
  name         text NOT NULL,
  content_type text NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  bytes        integer NOT NULL,
  generated    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  seq          bigserial
);

CREATE TABLE IF NOT EXISTS conflicts (
  juror_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  studio_id   text NOT NULL REFERENCES studios (id) ON DELETE CASCADE,
  note        text,
  declared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (juror_id, studio_id)
);

CREATE TABLE IF NOT EXISTS panel_members (
  round_id            text NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  juror_id            text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ballot_submitted_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, juror_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  round_id    text NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  juror_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entry_id    text NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
  recused_at  timestamptz,
  recuse_note text,
  PRIMARY KEY (round_id, juror_id, entry_id)
);

CREATE TABLE IF NOT EXISTS scores (
  round_id   text NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  juror_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entry_id   text NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
  craft      integer NOT NULL,
  clarity    integer NOT NULL,
  idea       integer NOT NULL,
  story      integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, juror_id, entry_id)
);

CREATE TABLE IF NOT EXISTS round_results (
  round_id        text NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  entry_id        text NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
  score           numeric(6, 2),
  idea_mean       numeric(12, 4),
  ballots_counted integer NOT NULL,
  rank            integer NOT NULL,
  cut             text NOT NULL,
  PRIMARY KEY (round_id, entry_id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  studio_id  text NOT NULL REFERENCES studios (id) ON DELETE CASCADE,
  key        text NOT NULL,
  entry_id   text NOT NULL,
  status     integer,
  response   jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (studio_id, key)
);

CREATE TABLE IF NOT EXISTS emails (
  id         text PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  to_addr    text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  queued_at  timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          text PRIMARY KEY,
  actor_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  seq         bigserial
);

CREATE TABLE IF NOT EXISTS packet_jobs (
  round_id   text PRIMARY KEY REFERENCES rounds (id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
