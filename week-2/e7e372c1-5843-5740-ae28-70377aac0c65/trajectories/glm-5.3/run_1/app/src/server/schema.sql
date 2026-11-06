-- Idempotent schema. Every start applies it; conflicts do nothing.
CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at BIGINT NOT NULL,
  last_used_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS restatements (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  week_ending TEXT NOT NULL,
  state TEXT NOT NULL,
  supersedes TEXT,
  correction_reason TEXT,
  rows_beginning_balance TEXT,
  rows_eth_acquired TEXT,
  rows_staking_rewards TEXT,
  rows_ending_balance TEXT,
  rows_cumulative_staking_rewards TEXT,
  rows_diluted_shares TEXT,
  accession TEXT,
  exhibit_page INTEGER,
  exhibit_sha256 TEXT,
  exhibit_status TEXT, -- 'verified' | 'rejected' | NULL
  exhibit_bytes INTEGER,
  exhibit_key TEXT,
  prepared_by TEXT NOT NULL REFERENCES staff_users(id),
  cleared_by TEXT REFERENCES staff_users(id),
  released_by TEXT REFERENCES staff_users(id),
  return_note TEXT,
  release_at BIGINT,
  published_at BIGINT,
  superseded_by TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  restatement_id TEXT NOT NULL REFERENCES restatements(id),
  kind TEXT NOT NULL,
  shares TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  position INTEGER NOT NULL
);

-- Append-only audit trail. The rule (trigger) is created after seeding so the
-- seeded history itself can be inserted directly, then the table is frozen.
CREATE TABLE IF NOT EXISTS restatement_audit (
  id BIGSERIAL PRIMARY KEY,
  restatement_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  at BIGINT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS computations (
  id TEXT PRIMARY KEY,
  figure TEXT NOT NULL,
  value TEXT NOT NULL,
  display TEXT NOT NULL,
  as_of BIGINT NOT NULL,
  computed_at BIGINT NOT NULL,
  stored_order BIGSERIAL NOT NULL,
  restatement_id TEXT,
  sets_as_of_input TEXT NOT NULL,
  inputs JSONB NOT NULL,
  restated_on TEXT,
  restated_reason TEXT,
  superseded_by TEXT,
  superseding_computation_id TEXT
);

CREATE TABLE IF NOT EXISTS ticks (
  id TEXT PRIMARY KEY,
  instrument TEXT NOT NULL,
  price TEXT NOT NULL,
  at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_closes (
  date TEXT PRIMARY KEY,
  close_at BIGINT NOT NULL,
  processed_at BIGINT
);

CREATE TABLE IF NOT EXISTS share_count_events (
  id BIGSERIAL PRIMARY KEY,
  restatement_id TEXT NOT NULL REFERENCES restatements(id),
  effective_date TEXT NOT NULL,
  signed_shares TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  restatement_id TEXT NOT NULL,
  status INTEGER NOT NULL,
  body JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS tape_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'playing',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS market_clock (
  id INTEGER PRIMARY KEY DEFAULT 1,
  rehearsal_base_ms BIGINT,
  rehearsal_set_real_ms BIGINT
);

CREATE TABLE IF NOT EXISTS tick_key (
  id INTEGER PRIMARY KEY DEFAULT 1,
  key_hex TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seeded_exhibits (
  accession TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL
);

-- Exactly-one-open-restatement guard (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS one_open_restatement
  ON restatements ((state IN ('draft','in_review','returned','cleared','queued')))
  WHERE state IN ('draft','in_review','returned','cleared','queued');

-- Exactly-one-current-published-restatement-per-week guard
CREATE UNIQUE INDEX IF NOT EXISTS one_published_per_week
  ON restatements (week_ending)
  WHERE state = 'published';

CREATE INDEX IF NOT EXISTS computations_figure_computed ON computations (figure, computed_at);
CREATE INDEX IF NOT EXISTS ticks_instrument_at ON ticks (instrument, at);

-- One audit entry per version, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS one_audit_entry_per_version
  ON restatement_audit (restatement_id, version);
