import pg from "pg";
import { config } from "./config.js";

// bigint (cents, sizes) and numeric come back as JS numbers: every value we store fits in 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// Calendar dates stay `YYYY-MM-DD` strings: they are venue-local days, never instants.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 3000 });
pool.on("error", () => undefined);

export type Db = pg.Pool | pg.PoolClient;
type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(text: string, values: unknown[] = [], db: Db = pool): Promise<T[]> {
  const result = await db.query<T>(text, values);
  return result.rows;
}

export async function one<T extends Row = Row>(text: string, values: unknown[] = [], db: Db = pool): Promise<T | null> {
  return (await query<T>(text, values, db))[0] ?? null;
}

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Live events for /api/events, delivered to every app instance sharing the database on commit. */
export async function notify(db: Db, event: string, payload: Record<string, unknown>): Promise<void> {
  await db.query("SELECT pg_notify('spindrift_events', $1)", [JSON.stringify({ event, ...payload })]);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code: unknown }).code === "23505";
}

export function isDatabaseDown(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  return ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "57P01", "57P03", "08006", "08001"].includes(code)
    || /timeout exceeded when trying to connect|Connection terminated/i.test(error.message);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, email text NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS sessions (
  id_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), roles text[] NOT NULL,
  access_token text NOT NULL, refresh_token text NOT NULL, id_token text NOT NULL,
  access_expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  state text PRIMARY KEY, browser_hash text NOT NULL, verifier text NOT NULL, nonce text NOT NULL,
  return_to text, created_at timestamptz NOT NULL DEFAULT now(), used_at timestamptz);

CREATE TABLE IF NOT EXISTS briefs (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES users(id), answers jsonb NOT NULL DEFAULT '{}',
  answered_through int NOT NULL DEFAULT 0, next_step int DEFAULT 1, commission_id uuid, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS commissions (
  id uuid PRIMARY KEY, brief_id uuid NOT NULL UNIQUE REFERENCES briefs(id), client_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL, state text NOT NULL, installation_type text NOT NULL, venue_id text NOT NULL,
  width_m double precision NOT NULL, depth_m double precision NOT NULL, door_wall text NOT NULL, audience text NOT NULL,
  notes text NOT NULL, size text NOT NULL, add_ons text[] NOT NULL, quote_id uuid,
  layout_version int NOT NULL DEFAULT 1, layout jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id), lines jsonb NOT NULL,
  subtotal_cents bigint NOT NULL, tax_cents bigint NOT NULL, total_cents bigint NOT NULL,
  issued_at timestamptz NOT NULL, valid_until timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id), kind text NOT NULL,
  file_name text NOT NULL, content_type text NOT NULL, size_bytes bigint NOT NULL, sha256 text NOT NULL,
  status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS render_jobs (
  id uuid PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id), venue_photo_file_id uuid NOT NULL,
  reference_url text, reference_content_type text, reference_sha256 text, reference_bytes bytea,
  layout jsonb, state text NOT NULL, progress int NOT NULL DEFAULT 0, provider_job_id text, failure_reason text,
  preview_bytes bytea, preview_sha256 text, terminal_event text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS render_callbacks (
  event_id text PRIMARY KEY, render_job_id uuid NOT NULL, received_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id), venue_id text NOT NULL,
  date date NOT NULL, recorded_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, status text NOT NULL,
  ended_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_per_venue_day ON holds (venue_id, date) WHERE status IN ('held', 'booked');
CREATE INDEX IF NOT EXISTS holds_by_commission ON holds (commission_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS install_days (
  id uuid PRIMARY KEY, commission_id uuid NOT NULL UNIQUE REFERENCES commissions(id), hold_id uuid NOT NULL,
  venue_id text NOT NULL, date date NOT NULL, released_at timestamptz,
  load_in_at timestamptz NOT NULL, load_in_queued_at timestamptz);

CREATE TABLE IF NOT EXISTS install_day_crew (
  install_day_id uuid NOT NULL REFERENCES install_days(id), crew_user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (install_day_id, crew_user_id));

CREATE TABLE IF NOT EXISTS milestones (
  id uuid PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id), position int NOT NULL,
  label text NOT NULL, schedule_bp int NOT NULL, subtotal_cents bigint NOT NULL, tax_cents bigint NOT NULL,
  amount_cents bigint NOT NULL, state text NOT NULL, invoiced_at timestamptz, due_at timestamptz,
  killbill_invoice_id text, killbill_invoice_number text, killbill_payment_id text, document_id uuid,
  UNIQUE (commission_id, position));

CREATE TABLE IF NOT EXISTS funders (
  id uuid PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id), position int NOT NULL,
  kind text NOT NULL, name text NOT NULL, email text NOT NULL, bp int NOT NULL, state text NOT NULL,
  invite_token_hash text UNIQUE, invite_sent_at timestamptz, invite_expires_at timestamptz,
  user_id uuid REFERENCES users(id), accepted_at timestamptz, subtotal_cents bigint, tax_cents bigint,
  amount_cents bigint, invoiced_at timestamptz, due_at timestamptz, killbill_invoice_id text,
  killbill_invoice_number text, killbill_payment_id text, document_id uuid, removed_at timestamptz);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id), kind text NOT NULL,
  version int NOT NULL, label text NOT NULL, storage_key text NOT NULL UNIQUE, snapshot jsonb NOT NULL,
  status text NOT NULL, size_bytes bigint, sha256 text, issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id), payer_user_id uuid NOT NULL,
  payer_name text NOT NULL, label text NOT NULL, amount_cents bigint NOT NULL,
  killbill_payment_id text NOT NULL UNIQUE, at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, idempotency_key text NOT NULL, fingerprint text NOT NULL,
  target_kind text NOT NULL, target_id uuid NOT NULL, status text NOT NULL, response_status int,
  response_body jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, idempotency_key));

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY, kind text NOT NULL, commission_id uuid, payload jsonb NOT NULL, status text NOT NULL,
  attempts int NOT NULL DEFAULT 0, last_error text, run_at timestamptz NOT NULL, locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs (run_at) WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS crm_endpoints (
  user_id uuid PRIMARY KEY REFERENCES users(id), url text NOT NULL, svix_endpoint_id text NOT NULL,
  signing_secret text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS crm_events (
  event_id uuid PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id), client_id uuid NOT NULL,
  type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS maintenance (
  commission_id uuid PRIMARY KEY REFERENCES commissions(id), plan text NOT NULL,
  killbill_subscription_id text NOT NULL, started_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS maintenance_receipts (
  killbill_payment_id text PRIMARY KEY, commission_id uuid NOT NULL REFERENCES commissions(id));
`;

/** Applied at every start, idempotently, by one instance at a time. */
export async function migrate(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7302114)");
    await client.query(SCHEMA);
  });
}
