import pg from "pg";
import type { Config } from "./config.js";
import { LEDGER_LOCK_KEY } from "./locks.js";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  clinic_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS benches (
  label text PRIMARY KEY,
  row text NOT NULL,
  number int NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id text PRIMARY KEY,
  buyer_id text NOT NULL REFERENCES accounts(id),
  state text NOT NULL DEFAULT 'held',
  invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id text PRIMARY KEY,
  bench text NOT NULL REFERENCES benches(label),
  tier text NOT NULL,
  state text NOT NULL,
  group_id text REFERENCES groups(id),
  buyer_id text NOT NULL REFERENCES accounts(id),
  attendee_name text,
  attendee_email text,
  attendee_accepted boolean NOT NULL DEFAULT false,
  price_cents int NOT NULL,
  paid_cents int NOT NULL DEFAULT 0,
  refund_due_cents int,
  refund_email_sent boolean NOT NULL DEFAULT false,
  hold_expires_at timestamptz,
  hold_duration_seconds int,
  payment_in_flight boolean NOT NULL DEFAULT false,
  payment_pending text,
  upgrade_bench text,
  licence_status text NOT NULL DEFAULT 'none',
  licence_number text,
  licence_state text,
  licence_object_key text,
  licence_reviewed_note text,
  passport_status text NOT NULL DEFAULT 'none',
  passport_full_name text,
  passport_nationality text,
  passport_number text,
  passport_object_key text,
  checked_in_day1 timestamptz,
  checked_in_day2 timestamptz,
  certificate_number text,
  reminder_21_sent_at timestamptz,
  reminder_7_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  tier text NOT NULL,
  state text NOT NULL DEFAULT 'waitlisted',
  bench text,
  offer_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_invoices (
  external_key text PRIMARY KEY,
  invoice_id text NOT NULL,
  item_ids jsonb NOT NULL,
  total_cents int NOT NULL,
  payment_id text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_payments (
  id text PRIMARY KEY,
  reservation_id text NOT NULL,
  kind text NOT NULL,
  external_key text NOT NULL UNIQUE,
  amount_cents int NOT NULL,
  refunded_cents int NOT NULL DEFAULT 0,
  invoice_id text,
  invoice_item_id text,
  payment_id text,
  payment_external_key text,
  ord int NOT NULL DEFAULT 1,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency (
  account_id text NOT NULL,
  key text NOT NULL,
  endpoint text NOT NULL,
  body_hash text NOT NULL,
  status int NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);

CREATE TABLE IF NOT EXISTS certificates (
  reservation_id text PRIMARY KEY,
  certificate_number int NOT NULL UNIQUE,
  object_key text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  reservation_id text NOT NULL,
  kind text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, kind)
);

CREATE TABLE IF NOT EXISTS kb_refunds (
  external_key text PRIMARY KEY,
  reservation_id text NOT NULL,
  kb_payment_id text NOT NULL,
  amount_cents int NOT NULL,
  ord int NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_queue (
  id text PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const MIGRATIONS = `
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS upgrade_bench text;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS refund_email_sent boolean NOT NULL DEFAULT false;
ALTER TABLE kb_payments ADD COLUMN IF NOT EXISTS ord int NOT NULL DEFAULT 1;
ALTER TABLE kb_payments ADD COLUMN IF NOT EXISTS payment_external_key text;
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    await client.query(MIGRATIONS);
    const { rows } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM benches");
    if (rows[0]?.count === 0) {
      const labels: string[] = [];
      for (const row of ["A", "B", "C", "D"]) {
        for (let n = 1; n <= 6; n++) labels.push(`${row}${n}`);
      }
      for (const label of labels) {
        await client.query("INSERT INTO benches (label, row, number) VALUES ($1, $2, $3)", [label, label[0], Number(label.slice(1))]);
      }
    }
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken */
    }
    throw e;
  } finally {
    client.release();
  }
}

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}

export async function query<T>(text: string, params?: unknown[]): Promise<Rows<T>> {
  const result = await pool.query(text, params as never[]);
  return { rows: result.rows as T[], rowCount: result.rowCount };
}

/** The single ledger mutation lock, shared by every app process. */
export async function withLedgerLock<T>(client: pg.PoolClient, fn: () => Promise<T>): Promise<T> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [LEDGER_LOCK_KEY]);
  return fn();
}

export type _Config = Config;
