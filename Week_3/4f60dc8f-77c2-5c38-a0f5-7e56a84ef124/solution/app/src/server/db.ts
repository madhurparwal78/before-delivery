// Postgres: the pool, the schema (applied idempotently on every serve, retried per request) and transactions.
import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number.parseInt(value, 10));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
pool.on("error", (error) => console.error("postgres pool", error.message));

export type Db = pg.Pool | pg.PoolClient;

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await db.query(sql, params);
  return (result.rows[0] as T | undefined) ?? null;
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  currency text NOT NULL,
  killbill_account_id text,
  overdue_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES brands(id),
  role text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  UNIQUE (brand_id, role)
);
CREATE INDEX IF NOT EXISTS contacts_email ON contacts (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  kind text NOT NULL,
  brand_id uuid REFERENCES brands(id),
  email text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS signin_codes (
  email text PRIMARY KEY,
  code_hash text NOT NULL,
  issued_at timestamptz NOT NULL,
  wrong_tries integer NOT NULL DEFAULT 0,
  used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS signin_code_requests (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  requested_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS signin_code_requests_email ON signin_code_requests (email, requested_at);
CREATE SEQUENCE IF NOT EXISTS engagement_reference START 1001;
CREATE TABLE IF NOT EXISTS engagements (
  id uuid PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES brands(id),
  reference text NOT NULL UNIQUE,
  title text NOT NULL,
  state text NOT NULL,
  review_milestone text,
  finals_out boolean NOT NULL DEFAULT false,
  quote_revision integer NOT NULL DEFAULT 0,
  locked_rate numeric(12,4),
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS quote_lines (
  engagement_id uuid NOT NULL REFERENCES engagements(id),
  shot_code text NOT NULL,
  quantity integer NOT NULL,
  locked_title text,
  locked_price_pence integer,
  locked_sort integer,
  PRIMARY KEY (engagement_id, shot_code)
);
CREATE TABLE IF NOT EXISTS exchange_rates (
  id bigserial PRIMARY KEY,
  currency text NOT NULL,
  rate numeric(12,4) NOT NULL,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS intake_files (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id),
  name text NOT NULL,
  kind text NOT NULL,
  extension text NOT NULL,
  size_bytes bigint NOT NULL,
  status text NOT NULL,
  measurement text,
  measurement_failures integer NOT NULL DEFAULT 0,
  unit_decision text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS intake_files_engagement ON intake_files (engagement_id, created_at);
CREATE TABLE IF NOT EXISTS measurements (
  intake_file_id uuid PRIMARY KEY REFERENCES intake_files(id),
  x_m double precision,
  y_m double precision,
  z_m double precision,
  outcome text NOT NULL,
  measured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS stills (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id),
  shot_code text NOT NULL,
  milestone text NOT NULL,
  extension text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (engagement_id, shot_code, milestone)
);
CREATE TABLE IF NOT EXISTS review_links (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id),
  milestone text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS revision_rounds (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id),
  milestone text NOT NULL,
  round integer NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (engagement_id, milestone, round)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  status integer,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id),
  milestone text NOT NULL,
  status text NOT NULL,
  number text,
  killbill_invoice_id text,
  failed_attempts integer NOT NULL DEFAULT 0,
  issued_at timestamptz,
  overdue_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (engagement_id, milestone)
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  position integer NOT NULL,
  description text NOT NULL,
  amount_minor bigint NOT NULL,
  PRIMARY KEY (invoice_id, position)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id),
  kind text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  invoice_id uuid REFERENCES invoices(id),
  killbill_payment_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_refund_once ON ledger_entries (engagement_id, killbill_payment_id) WHERE kind = 'refund';
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz,
  attempt_after timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS attempt_after timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS studio_founder (
  id integer PRIMARY KEY CHECK (id = 1),
  password_hash text NOT NULL
);
`;

let ready: Promise<void> | null = null;

/** Applies the schema and seeds once per process; a failure clears the memo so the next request retries. */
export function ensureSchema(seed: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  ready ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(727001)");
      try {
        await client.query(SCHEMA);
        await seed(client);
      } finally {
        await client.query("SELECT pg_advisory_unlock(727001)");
      }
    } finally {
      client.release();
    }
  })().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}
