import pg from 'pg';
import { config } from './config.ts';

// Postgres stores everything (brief: Services). The schema is applied idempotently every time the app serves.

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on('error', () => undefined);

// The brief keeps timestamps as instants; json (not jsonb) keeps published editions byte for byte.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS forms (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  draft jsonb NOT NULL,
  rev integer NOT NULL DEFAULT 0,
  live_edition integer,
  state text NOT NULL DEFAULT 'draft',
  closed_reason text,
  closes_at timestamptz,
  response_limit integer,
  closed_message text,
  copy_to text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS form_editors (
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (form_id, user_id)
);
CREATE TABLE IF NOT EXISTS editions (
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  number integer NOT NULL,
  definition json NOT NULL,
  published_at timestamptz NOT NULL,
  PRIMARY KEY (form_id, number)
);
CREATE TABLE IF NOT EXISTS form_changes (
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  rev integer NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  change jsonb NOT NULL,
  PRIMARY KEY (form_id, rev)
);
CREATE TABLE IF NOT EXISTS form_limits (
  form_id uuid PRIMARY KEY REFERENCES forms(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS responses (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  edition integer NOT NULL,
  status text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}',
  page text NOT NULL,
  device_id uuid,
  devices uuid[] NOT NULL DEFAULT '{}',
  last_seq integer NOT NULL DEFAULT 0,
  last_seq_device uuid,
  resume_token text NOT NULL UNIQUE,
  email text,
  saved_at timestamptz,
  created_at timestamptz NOT NULL,
  submitted_at timestamptz
);
CREATE INDEX IF NOT EXISTS responses_form_status ON responses (form_id, status, submitted_at);
CREATE INDEX IF NOT EXISTS responses_device ON responses (device_id, form_id);
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY,
  response_id uuid NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  name text NOT NULL,
  size integer NOT NULL,
  type text NOT NULL,
  object_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  key text PRIMARY KEY,
  response_id uuid NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  body_hash text NOT NULL,
  result jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
  token text PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  email text NOT NULL,
  inviter_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  responses integer NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (next_attempt_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS app_clock (
  id integer PRIMARY KEY,
  base timestamptz,
  set_at timestamptz NOT NULL
);
`;

const SCHEMA_LOCK = 7_340_117;
const RETRY_MS = 1_000;

/** Retry until Postgres answers, then create what is missing under an advisory lock (several instances may start). */
export async function applySchema(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
        await client.query(SCHEMA);
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
        return;
      } finally {
        client.release();
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

export type Db = Pick<pg.PoolClient, 'query'>;

export async function transaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const result = await work(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}

export async function checkPostgres(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
