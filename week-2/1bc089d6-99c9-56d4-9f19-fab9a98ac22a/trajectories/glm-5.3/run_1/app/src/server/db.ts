import { Pool } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hours (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','confirmed')),
  bedtime TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  reminders TEXT NOT NULL DEFAULT 'on' CHECK (reminders IN ('on','paused')),
  version INTEGER NOT NULL DEFAULT 0,
  confirmed_at TIMESTAMPTZ,
  reminders_start TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hours_draft_one ON hours (email) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS hours_confirmed_one ON hours (email) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS hours_email ON hours (email);

CREATE TABLE IF NOT EXISTS rituals (
  hour_id TEXT NOT NULL REFERENCES hours (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (hour_id, id)
);

CREATE TABLE IF NOT EXISTS links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('confirm','signin')),
  state TEXT NOT NULL DEFAULT 'issued' CHECK (state IN ('issued','used')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS links_email ON links (email);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
  hour_id TEXT PRIMARY KEY REFERENCES hours (id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  body TEXT NOT NULL,
  status INTEGER,
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  email TEXT NOT NULL,
  bucket TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_email_bucket ON rate_limits (email, bucket, at);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  link_token TEXT,
  claim_until TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (id) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS reminder_records (
  hour_id TEXT NOT NULL,
  night TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','skipped')),
  due_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (hour_id, night)
);

CREATE TABLE IF NOT EXISTS test_clock (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  at TIMESTAMPTZ
);
INSERT INTO test_clock (id, at) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;
`;

let schemaPromise: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = pool.query(SCHEMA).then(() => undefined).catch((err: unknown) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

export function isDbError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    return typeof code === 'string' && code.startsWith('57') // server shutdown classes
      || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT'
      || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'EPIPE'
      || code === '55P03' || code === '53300';
  }
  return false;
}
