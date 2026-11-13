import pg from 'pg';

// The schema, applied idempotently on every start.
const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS typists (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS typists_email_key ON typists (lower(email))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    typist_id UUID NOT NULL REFERENCES typists (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_typist_idx ON sessions (typist_id)`,
  `CREATE TABLE IF NOT EXISTS settings (
    typist_id UUID PRIMARY KEY REFERENCES typists (id) ON DELETE CASCADE,
    theme TEXT NOT NULL,
    caret TEXT NOT NULL,
    smooth_caret BOOLEAN NOT NULL,
    font_size DOUBLE PRECISION NOT NULL,
    blind_mode BOOLEAN NOT NULL,
    quick_restart TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS verify_tokens (
    token TEXT PRIMARY KEY,
    typist_id UUID NOT NULL REFERENCES typists (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS verify_tokens_typist_idx ON verify_tokens (typist_id)`,
  `CREATE TABLE IF NOT EXISTS reset_tokens (
    token TEXT PRIMARY KEY,
    typist_id UUID NOT NULL REFERENCES typists (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS reset_tokens_typist_idx ON reset_tokens (typist_id)`,
  `CREATE TABLE IF NOT EXISTS sign_failures (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sign_failures_email_idx ON sign_failures (email, failed_at)`,
  `CREATE TABLE IF NOT EXISTS tickets (
    ticket_id UUID PRIMARY KEY,
    typist_id UUID REFERENCES typists (id) ON DELETE SET NULL,
    mode TEXT NOT NULL,
    length INTEGER,
    punctuation BOOLEAN NOT NULL,
    numbers BOOLEAN NOT NULL,
    words JSONB NOT NULL,
    seed BIGINT,
    quote_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_run_id UUID
  )`,
  `CREATE INDEX IF NOT EXISTS tickets_typist_idx ON tickets (typist_id)`,
  `CREATE SEQUENCE IF NOT EXISTS ticket_sequence AS BIGINT START 1`,
  `CREATE TABLE IF NOT EXISTS runs (
    run_id UUID PRIMARY KEY,
    typist_id UUID NOT NULL REFERENCES typists (id) ON DELETE CASCADE,
    ticket_id UUID REFERENCES tickets (ticket_id) ON DELETE SET NULL,
    mode TEXT NOT NULL,
    length INTEGER,
    punctuation BOOLEAN NOT NULL,
    numbers BOOLEAN NOT NULL,
    quote_id TEXT,
    words JSONB NOT NULL,
    log JSONB NOT NULL,
    first_body BYTEA NOT NULL,
    proof_key TEXT,
    verdict TEXT NOT NULL,
    reason TEXT,
    duration_ms DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    raw DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    consistency DOUBLE PRECISION,
    characters JSONB,
    errors_by_key JSONB,
    per_second JSONB,
    personal_best BOOLEAN NOT NULL DEFAULT FALSE,
    board_length INTEGER,
    finished_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS runs_ticket_key ON runs (ticket_id) WHERE ticket_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS runs_typist_idx ON runs (typist_id, finished_at DESC)`,
  `CREATE INDEX IF NOT EXISTS runs_board_idx ON runs (typist_id, board_length, speed DESC)`,
  `CREATE TABLE IF NOT EXISTS pending_mail (
    id BIGSERIAL PRIMARY KEY,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ
  )`,
];

export async function applySchema(pool: pg.Pool): Promise<void> {
  for (const statement of STATEMENTS) await pool.query(statement);
  // Earlier boots may have created stricter columns and indexes; relax them so
  // grading runs, which carry no ticket and no proof key, can be stored.
  await pool.query('ALTER TABLE runs ALTER COLUMN proof_key DROP NOT NULL');
  await pool.query('ALTER TABLE runs ALTER COLUMN ticket_id DROP NOT NULL');
  await pool.query('DROP INDEX IF EXISTS runs_ticket_key');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS runs_ticket_key ON runs (ticket_id) WHERE ticket_id IS NOT NULL');
}
