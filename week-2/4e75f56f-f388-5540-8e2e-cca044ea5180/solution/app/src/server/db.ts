import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 10_000 });
pool.on("error", () => {
  // An idle client lost its connection; the pool replaces it on the next checkout.
});

export type Db = pg.PoolClient;
export type Queryable = Db | pg.Pool;

const SCHEMA_LOCK = 7_201;
const LEDGER_LOCK = 7_202;
const CERTIFICATE_LOCK = 7_203;
const AGENDA_LOCK = 7_204;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  clinic_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS groups (
  id text PRIMARY KEY,
  buyer_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reservations (
  id text PRIMARY KEY,
  bench text NOT NULL,
  state text NOT NULL,
  group_id text REFERENCES groups(id),
  buyer_id text NOT NULL REFERENCES accounts(id),
  attendee_name text,
  attendee_email text,
  attendee_account_id text REFERENCES accounts(id),
  attendee_accepted boolean NOT NULL DEFAULT false,
  hold_expires_at timestamptz,
  hold_duration integer,
  payment_pending text,
  upgrade_target text,
  refund_due_cents bigint,
  licence_number text,
  licence_state text,
  licence_key text,
  licence_status text NOT NULL DEFAULT 'none',
  passport_full_name text,
  passport_nationality text,
  passport_number text,
  passport_key text,
  checked_in_day1 boolean NOT NULL DEFAULT false,
  checked_in_day2 boolean NOT NULL DEFAULT false,
  certificate_number text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservations_buyer ON reservations (buyer_id);
CREATE INDEX IF NOT EXISTS reservations_state ON reservations (state);
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  external_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  owner_id text NOT NULL,
  amount_cents bigint NOT NULL,
  billing_name text NOT NULL,
  kb_account_id text,
  kb_invoice_id text,
  kb_payment_id text,
  confirmed_at timestamptz,
  finalized_at timestamptz,
  retry_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_items (
  payment_id text NOT NULL REFERENCES payments(id),
  reservation_id text NOT NULL REFERENCES reservations(id),
  bench text NOT NULL,
  amount_cents bigint NOT NULL,
  kb_invoice_item_id text,
  PRIMARY KEY (payment_id, reservation_id)
);
CREATE TABLE IF NOT EXISTS refunds (
  reservation_id text NOT NULL REFERENCES reservations(id),
  n integer NOT NULL,
  payment_id text NOT NULL REFERENCES payments(id),
  amount_cents bigint NOT NULL,
  external_key text NOT NULL UNIQUE,
  confirmed_at timestamptz,
  PRIMARY KEY (reservation_id, n)
);
CREATE TABLE IF NOT EXISTS documents (
  owner_id text NOT NULL,
  kind text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, kind)
);
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id text PRIMARY KEY,
  seq bigserial UNIQUE,
  account_id text NOT NULL REFERENCES accounts(id),
  tier text NOT NULL,
  state text NOT NULL,
  bench text,
  offer_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  account_id text NOT NULL REFERENCES accounts(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  retry_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (retry_after) WHERE sent_at IS NULL;
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    try {
      await client.query(SCHEMA);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
    }
  } finally {
    client.release();
  }
}

export async function tx<T>(work: (db: Db) => Promise<T>): Promise<T> {
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

/** Serialises every change to bench occupancy (claims, releases, offers) across processes. */
export async function lockLedger(db: Db): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock($1)", [LEDGER_LOCK]);
}

/** Serialises certificate numbering so numbers run from OB-2027-0001 without gaps or repeats. */
export async function lockCertificates(db: Db): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock($1)", [CERTIFICATE_LOCK]);
}

/**
 * Runs an agenda write with every other agenda write across processes waiting, so each is
 * checked against the agenda as the previous write left it.
 */
export async function oneAgendaWriteAtATime<T>(work: () => Promise<T>): Promise<T> {
  return tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [AGENDA_LOCK]);
    return work();
  });
}

/** For statements that always return a row (INSERT/UPDATE … RETURNING, aggregates). */
export async function oneRow<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query(sql, params);
  const row = result.rows[0] as T | undefined;
  if (row === undefined) throw new Error("expected a row");
  return row;
}

export async function one<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await db.query(sql, params);
  return (result.rows[0] as T | undefined) ?? null;
}

export async function many<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}
