import pg, { type PoolClient } from 'pg';
import { config } from './util.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 3_000,
});

export type Db = PoolClient;

export async function withTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch {
      // connection already broken
    }
    throw err;
  } finally {
    db.release();
  }
}

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    return await fn(db);
  } finally {
    db.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  business_name text NOT NULL,
  currency text NOT NULL,
  card_last4 text,
  killbill_account_id text,
  created_at timestamptz NOT NULL,
  seeding_day date
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS prices (
  id uuid PRIMARY KEY,
  plan text NOT NULL,
  currency text NOT NULL,
  amount_minor bigint NOT NULL,
  effective_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS prices_lookup ON prices (plan, currency, effective_at);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  number text NOT NULL,
  account_id uuid REFERENCES accounts(id),
  session_id uuid REFERENCES sessions(id),
  plan text NOT NULL,
  plan_name text NOT NULL,
  currency text NOT NULL,
  state text NOT NULL,
  total_minor bigint NOT NULL,
  due_now_minor bigint NOT NULL,
  due_at_launch_minor bigint NOT NULL,
  accepted_at timestamptz,
  price_row_id uuid REFERENCES prices(id),
  project_id uuid,
  killbill_bundle_id text,
  killbill_subscription_id text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_session ON orders (session_id);
CREATE INDEX IF NOT EXISTS orders_account ON orders (account_id);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  kind text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  killbill_payment_id text NOT NULL,
  killbill_invoice_id text NOT NULL,
  captured_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id),
  amount_minor bigint NOT NULL,
  reason text NOT NULL,
  killbill_transaction_id text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS credits (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  business_name text NOT NULL,
  plan_name text NOT NULL,
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS assignments (
  project_id uuid NOT NULL REFERENCES projects(id),
  contractor_id uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, contractor_id)
);

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  size integer NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  uploaded_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS files_project ON files (project_id);

CREATE TABLE IF NOT EXISTS download_links (
  id uuid PRIMARY KEY,
  file_id uuid REFERENCES files(id),
  invoice_id text,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY,
  token text NOT NULL UNIQUE,
  email text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer,
  response_body text,
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (scope, method, path, key)
);

CREATE TABLE IF NOT EXISTS previews (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  from_tier text NOT NULL,
  to_tier text NOT NULL,
  currency text NOT NULL,
  credit_minor bigint NOT NULL,
  charge_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  credit_share text NOT NULL,
  days_left integer NOT NULL,
  days_in_period integer NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS dunning_attempts (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  invoice_id text NOT NULL,
  attempt_no integer NOT NULL,
  due_at timestamptz NOT NULL,
  attempted_at timestamptz,
  succeeded boolean NOT NULL,
  UNIQUE (order_id, invoice_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS invoice_records (
  invoice_id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  order_id uuid REFERENCES orders(id),
  kind text NOT NULL,
  noticed_at timestamptz,
  pdf_stored_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_queue (
  id uuid PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  delivered_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_markers (
  key text PRIMARY KEY,
  done_at timestamptz NOT NULL
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}
