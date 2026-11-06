import pg from "pg";
import { config } from "./config.ts";

/** DATE columns stay `YYYY-MM-DD` text so no server time zone touches them. */
pg.types.setTypeParser(1082, (value: string) => value);

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", () => undefined);

export type Db = pg.PoolClient | pg.Pool;
type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export async function one<T extends Row = Row>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  return (await query<T>(sql, params, db))[0];
}

/** Runs `work` in one database transaction: everything inside commits together or not at all. */
export async function transaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
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

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: string }).code === "23505";
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS venues (
  id text PRIMARY KEY, name text NOT NULL, address text NOT NULL
);
CREATE TABLE IF NOT EXISTS auditoriums (
  code text PRIMARY KEY, venue_id text NOT NULL REFERENCES venues(id), name text NOT NULL,
  first_row char(1) NOT NULL, last_row char(1) NOT NULL, seats_per_row integer NOT NULL
);
CREATE SEQUENCE IF NOT EXISTS account_number_seq START 100001;
CREATE TABLE IF NOT EXISTS accounts (
  id serial PRIMARY KEY, number text UNIQUE, email text NOT NULL, name text NOT NULL, password_hash text NOT NULL,
  role text NOT NULL, locale text NOT NULL, kb_account_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, account_id integer NOT NULL REFERENCES accounts(id), stepup_valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS guest_billing_accounts (
  email text PRIMARY KEY, kb_account_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS seasons (
  slug text PRIMARY KEY, title_en text NOT NULL, title_fr text NOT NULL, public_sale_date date NOT NULL,
  lifecycle text NOT NULL, screenings_created integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS screenings (
  id text PRIMARY KEY, season_slug text NOT NULL REFERENCES seasons(slug), film_title text NOT NULL, format text NOT NULL,
  auditorium text NOT NULL REFERENCES auditoriums(code), starts_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS screenings_season ON screenings (season_slug, starts_at);
CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY, screening_id text NOT NULL REFERENCES screenings(id), account_id integer REFERENCES accounts(id),
  guest_id text, seats text[] NOT NULL, is_group boolean NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  ended_by text, booking_ref text, quoted_total_cents integer
);
CREATE INDEX IF NOT EXISTS holds_screening ON holds (screening_id, expires_at);
CREATE TABLE IF NOT EXISTS bookings (
  ref text PRIMARY KEY, hold_id uuid NOT NULL UNIQUE REFERENCES holds(id), screening_id text NOT NULL REFERENCES screenings(id),
  account_id integer REFERENCES accounts(id), name text NOT NULL, email text NOT NULL, phone text, locale text NOT NULL,
  state text NOT NULL, lines jsonb NOT NULL, admission_cents integer NOT NULL, gst_cents integer NOT NULL, qst_cents integer NOT NULL,
  uplift_cents integer NOT NULL, total_cents integer NOT NULL, credit_applied_cents integer NOT NULL, paid_cents integer NOT NULL,
  split jsonb, note text NOT NULL, cardholder_name text NOT NULL, kb_account_id text NOT NULL, kb_invoice_id text NOT NULL,
  kb_payment_id text, guest_token_hash text UNIQUE, paid_at timestamptz NOT NULL,
  refunded_at timestamptz, refunded_cents integer, recredited_cents integer, refund_reason text
);
CREATE INDEX IF NOT EXISTS bookings_account ON bookings (account_id, paid_at);
CREATE INDEX IF NOT EXISTS bookings_paid_at ON bookings (paid_at);
CREATE INDEX IF NOT EXISTS bookings_refunded_at ON bookings (refunded_at);
CREATE TABLE IF NOT EXISTS tickets (
  code text PRIMARY KEY, booking_ref text NOT NULL REFERENCES bookings(ref), screening_id text NOT NULL, seat text NOT NULL,
  fare text NOT NULL, status text NOT NULL, checked_in_at timestamptz
);
CREATE INDEX IF NOT EXISTS tickets_booking ON tickets (booking_ref);
CREATE INDEX IF NOT EXISTS tickets_screening ON tickets (screening_id);
CREATE TABLE IF NOT EXISTS gifts (
  ref text PRIMARY KEY, tier text NOT NULL, price_cents integer NOT NULL, purchaser_account_id integer REFERENCES accounts(id),
  purchaser_name text NOT NULL, purchaser_email text NOT NULL, purchaser_locale text NOT NULL, recipient_name text NOT NULL,
  recipient_email text NOT NULL, recipient_locale text NOT NULL, message text NOT NULL, cardholder_name text NOT NULL,
  token_hash text NOT NULL UNIQUE, kb_invoice_id text NOT NULL, credit_applied_cents integer NOT NULL, paid_cents integer NOT NULL,
  created_at timestamptz NOT NULL, redeemed_at timestamptz, redeemed_by integer REFERENCES accounts(id)
);
CREATE TABLE IF NOT EXISTS memberships (
  account_id integer PRIMARY KEY REFERENCES accounts(id), tier text NOT NULL, cadence text NOT NULL, started_on date NOT NULL,
  charged_through date NOT NULL, ends_on date, pending_tier text, pending_cadence text, pending_effective date,
  kb_subscription_id text NOT NULL, gift_ref text REFERENCES gifts(ref)
);
CREATE TABLE IF NOT EXISTS membership_invoices (
  id serial PRIMARY KEY, account_id integer NOT NULL REFERENCES accounts(id), kb_invoice_id text NOT NULL UNIQUE,
  amount_cents integer NOT NULL, credit_applied_cents integer NOT NULL, paid_cents integer NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id bigserial PRIMARY KEY, movement_id uuid NOT NULL, account_number text NOT NULL, ledger_account text NOT NULL,
  amount_cents integer NOT NULL, kind text NOT NULL, reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_account ON credit_ledger (account_number, created_at);
CREATE TABLE IF NOT EXISTS audit_log (
  id serial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, action text NOT NULL, target text NOT NULL,
  amount_cents integer, reason text NOT NULL
);
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status integer, body text,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS stepup_challenges (
  id uuid PRIMARY KEY, account_id integer NOT NULL REFERENCES accounts(id), code_hash text NOT NULL, expires_at timestamptz NOT NULL,
  wrong_attempts integer NOT NULL DEFAULT 0, used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS stepup_sends (
  account_id integer NOT NULL REFERENCES accounts(id), sent_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS stepup_sends_account ON stepup_sends (account_id, sent_at);
CREATE TABLE IF NOT EXISTS stepup_locks (
  account_id integer PRIMARY KEY REFERENCES accounts(id), locked_until timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_counters (
  scope text PRIMARY KEY, n integer NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  seq bigserial PRIMARY KEY, key text NOT NULL UNIQUE, kind text NOT NULL, to_address text NOT NULL, subject text NOT NULL,
  body text NOT NULL, instance text NOT NULL, enqueued_at timestamptz NOT NULL DEFAULT clock_timestamp(), state text NOT NULL DEFAULT 'pending',
  failures integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS outbox_head ON outbox (instance, state, enqueued_at, seq);
CREATE TABLE IF NOT EXISTS outbox_attempts (
  id bigserial PRIMARY KEY, seq bigint NOT NULL REFERENCES outbox(seq), started_at timestamptz NOT NULL, finished_at timestamptz, outcome text
);
CREATE INDEX IF NOT EXISTS outbox_attempts_seq ON outbox_attempts (seq);
CREATE TABLE IF NOT EXISTS enquiries (
  ref text PRIMARY KEY, name text NOT NULL, email text NOT NULL, subject text NOT NULL, message text NOT NULL, locale text NOT NULL,
  state text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reconciliation_acceptances (
  id serial PRIMARY KEY, business_date date NOT NULL, difference_cents integer NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_compensations (
  id serial PRIMARY KEY, kind text NOT NULL, kb_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), done boolean NOT NULL DEFAULT false
);
ALTER TABLE billing_compensations ADD COLUMN IF NOT EXISTS cents integer NOT NULL DEFAULT 0;
`;

/** Applies the schema and, on an empty database, the seed; safe for several instances at once. */
export async function migrate(seed: (tx: pg.PoolClient) => Promise<void>): Promise<void> {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(724100)");
    await tx.query(SCHEMA);
    const seeded = await one<{ n: number }>("SELECT count(*)::int AS n FROM accounts", [], tx);
    if (seeded?.n === 0) await seed(tx);
  });
}
