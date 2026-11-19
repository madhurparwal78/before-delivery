import pg from "pg";
import { config } from "./config.js";
import { fail } from "./http.js";

// bigint columns hold integer cents; they always fit a safe integer (fees are at most 100,000,000).
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export type Db = pg.PoolClient | pg.Pool;

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 30_000,
});
pool.on("error", () => undefined);

let ready = false;

export function markReady(): void {
  ready = true;
}

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "57P01", "57P03", "08006", "08001", "08003"]);

export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return (code !== undefined && CONNECTION_CODES.has(code)) || /timeout|terminat|connect/i.test(error.message);
}

function unavailable(cause?: unknown): never {
  if (cause instanceof Error) console.error(`Database unreachable: ${(cause as { code?: string }).code ?? ""} ${cause.message}`);
  fail(503, "database_unavailable", "The database is unreachable. Try again shortly.");
}

export async function query<Row extends pg.QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  client: Db = pool,
): Promise<Row[]> {
  if (!ready && client === pool) unavailable();
  try {
    return (await client.query<Row>(sql, values)).rows;
  } catch (error) {
    if (isConnectionError(error)) unavailable(error);
    throw error;
  }
}

export async function one<Row extends pg.QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  client: Db = pool,
): Promise<Row | undefined> {
  return (await query<Row>(sql, values, client))[0];
}

/** Runs `work` in one transaction; any throw rolls it back. */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!ready) unavailable();
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    unavailable(error);
  }
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isConnectionError(error)) unavailable(error);
    throw error;
  } finally {
    client.release();
  }
}

/** Startup work that must run once across instances (schema, seed) holds this session lock. */
export async function withStartupLock<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727400)");
    try {
      return await work(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock(727400)");
    }
  } finally {
    client.release();
  }
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS operators (
  email text PRIMARY KEY,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  operator_email text NOT NULL REFERENCES operators(email),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  time_zone text NOT NULL,
  operator_email text NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  credit_type text NOT NULL,
  credit_line text NOT NULL,
  role text NOT NULL,
  blurb text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL,
  position integer NOT NULL,
  threshold_pulse integer NOT NULL,
  threshold_lead integer NOT NULL,
  threshold_stinger integer NOT NULL,
  status text NOT NULL,
  seeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stems (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  layer text NOT NULL,
  format text NOT NULL,
  bytes integer NOT NULL,
  duration_ms integer NOT NULL,
  object_key text NOT NULL,
  UNIQUE (project_id, layer)
);
CREATE TABLE IF NOT EXISTS listening_links (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  label text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS enquiry_reference_seq START 2;
CREATE TABLE IF NOT EXISTS enquiries (
  id uuid PRIMARY KEY,
  reference_number bigint NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new',
  name text NOT NULL,
  email text NOT NULL,
  studio text NOT NULL,
  brief text NOT NULL,
  preferred_month text,
  project_id uuid REFERENCES projects(id),
  sender_ip text NOT NULL,
  pacing_policy text NOT NULL,
  attachment_filename text,
  attachment_bytes integer,
  attachment_format text,
  attachment_key text,
  triage_notes text NOT NULL DEFAULT '',
  fit_score integer,
  rate_floor_cents bigint
);
CREATE INDEX IF NOT EXISTS enquiries_policy_sender_idx ON enquiries (pacing_policy, lower(email), received_at);
CREATE INDEX IF NOT EXISTS enquiries_policy_ip_idx ON enquiries (pacing_policy, sender_ip, received_at);
CREATE TABLE IF NOT EXISTS production_months (
  month text PRIMARY KEY,
  capacity integer NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  enquiry_id uuid PRIMARY KEY REFERENCES enquiries(id),
  token text NOT NULL UNIQUE,
  producer_name text NOT NULL,
  producer_email text NOT NULL,
  project_title text NOT NULL,
  scope text NOT NULL,
  fee_cents bigint NOT NULL,
  production_month text NOT NULL,
  milestone_cents integer[] NOT NULL,
  sent_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  killbill_account_id text,
  deposit_invoice_id text,
  deposit_invoice_number text,
  deposit_amount_cents bigint,
  deposit_balance_cents bigint,
  deposit_payment_id text,
  deposit_paid_at timestamptz,
  deposit_invoice_date text
);
CREATE INDEX IF NOT EXISTS proposals_month_idx ON proposals (production_month);
CREATE TABLE IF NOT EXISTS milestone_invoices (
  enquiry_id uuid NOT NULL REFERENCES enquiries(id),
  number integer NOT NULL,
  amount_cents bigint NOT NULL,
  killbill_invoice_id text NOT NULL,
  invoice_number text NOT NULL,
  invoice_date text NOT NULL,
  PRIMARY KEY (enquiry_id, number)
);
CREATE TABLE IF NOT EXISTS idempotency_requests (
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  status_code integer,
  response jsonb,
  PRIMARY KEY (scope, idempotency_key)
);
CREATE TABLE IF NOT EXISTS outbound_mail (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  enquiry_id uuid NOT NULL REFERENCES enquiries(id),
  recipient text NOT NULL,
  message text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  hold_seconds integer NOT NULL,
  held_until timestamptz,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (kind, enquiry_id)
);
CREATE INDEX IF NOT EXISTS outbound_mail_pending_idx ON outbound_mail (state) WHERE state = 'pending';
CREATE TABLE IF NOT EXISTS server_keys (
  name text PRIMARY KEY,
  secret text NOT NULL
);
INSERT INTO server_keys (name, secret) VALUES ('enquiry-cursor', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  ON CONFLICT (name) DO NOTHING;
CREATE TABLE IF NOT EXISTS seed_marks (
  mark text PRIMARY KEY
);
`;

export { pool };
