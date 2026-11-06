import pg from "pg";
import { config } from "./config";
import { errors, HttpError } from "./http";

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 24,
  connectionTimeoutMillis: 3_000,
  idleTimeoutMillis: 10_000,
});
// An idle client that loses its connection is dropped; the next request connects afresh.
pool.on("error", () => undefined);

export type Db = pg.PoolClient;
export type Row = Record<string, unknown>;

async function connect(): Promise<pg.PoolClient> {
  try {
    return await pool.connect();
  } catch {
    throw errors.database();
  }
}

function translate(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const code = (error as { code?: string }).code ?? "";
  if (/^(ECONN|ENOTFOUND|ETIMEDOUT|EPIPE|57P0|08)/.test(code) || /Connection terminated/i.test(String(error))) {
    throw errors.database();
  }
  throw error;
}

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } catch (error) {
    translate(error);
  } finally {
    client.release();
  }
}

export async function one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}

/** Runs `work` in one transaction; any throw rolls it back. */
export async function tx<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    translate(error);
  } finally {
    client.release();
  }
}

export async function rows<T extends Row = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Runs `work` only in the one process holding the named session lock; others skip it. */
export async function exclusively(name: string, work: () => Promise<void>): Promise<void> {
  const client = await connect();
  try {
    const got = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [name]);
    if (!got.rows[0]?.ok) return;
    try {
      await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [name]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

export async function healthy(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS client_accounts (
  id uuid PRIMARY KEY,
  business_name text NOT NULL,
  currency text,
  kb_account_id text,
  card_last4 text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES client_accounts(id),
  role text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  owner_key uuid NOT NULL,
  user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS prices (
  id uuid PRIMARY KEY,
  plan text NOT NULL,
  currency text NOT NULL,
  amount_minor bigint NOT NULL,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prices_lookup ON prices (plan, currency, effective_at DESC, created_at DESC);
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 7;
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  number text NOT NULL UNIQUE,
  creator_key uuid,
  account_id uuid REFERENCES client_accounts(id),
  plan text NOT NULL,
  currency text NOT NULL,
  state text NOT NULL,
  total_minor bigint NOT NULL,
  due_now_minor bigint NOT NULL,
  due_at_launch_minor bigint NOT NULL,
  price_id uuid NOT NULL REFERENCES prices(id),
  accepted_at timestamptz,
  balance_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  kind text NOT NULL,
  amount_minor bigint NOT NULL,
  kb_payment_ids text[] NOT NULL,
  kb_invoice_id text NOT NULL,
  settled boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id),
  amount_minor bigint NOT NULL,
  reason text NOT NULL,
  kb_transaction_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credits (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES client_accounts(id),
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  account_id uuid NOT NULL REFERENCES client_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE TABLE IF NOT EXISTS assignments (
  project_id uuid NOT NULL REFERENCES projects(id),
  contractor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, contractor_id)
);
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  size bigint NOT NULL,
  object_key text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS download_links (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  file_id uuid REFERENCES files(id),
  account_id uuid REFERENCES client_accounts(id),
  object_key text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES client_accounts(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  fingerprint text NOT NULL,
  status int,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key, method, path)
);
CREATE TABLE IF NOT EXISTS care_plans (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  account_id uuid NOT NULL REFERENCES client_accounts(id),
  tier text NOT NULL,
  monthly_minor bigint NOT NULL,
  kb_bundle_id text NOT NULL,
  kb_subscription_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS previews (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES care_plans(id),
  from_tier text NOT NULL,
  to_tier text NOT NULL,
  currency text NOT NULL,
  monthly_minor bigint NOT NULL,
  credit_minor bigint NOT NULL,
  charge_minor bigint NOT NULL,
  days_left int NOT NULL,
  days_in_period int NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS renewals (
  kb_invoice_id text PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES care_plans(id),
  amount_minor bigint NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz,
  settled_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dunning_attempts (
  kb_invoice_id text NOT NULL REFERENCES renewals(kb_invoice_id),
  attempt int NOT NULL,
  outcome text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kb_invoice_id, attempt)
);
CREATE TABLE IF NOT EXISTS invoice_pdfs (
  kb_invoice_id text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  stored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mail_queue (
  id uuid PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seed_steps (
  step text PRIMARY KEY,
  value text,
  done_at timestamptz
);
`;

/** Applies the schema idempotently; processes sharing the database take turns. */
export async function migrate(): Promise<void> {
  const client = await connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('pampero-schema'))");
    try {
      await client.query(SCHEMA);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('pampero-schema'))");
    }
  } finally {
    client.release();
  }
}
