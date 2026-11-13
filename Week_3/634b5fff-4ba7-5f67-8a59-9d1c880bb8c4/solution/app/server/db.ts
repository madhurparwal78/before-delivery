import pg from "pg";
import { EDITION, plateOf, SEED_RATE_BASIS_POINTS } from "../shared/domain.js";
import { TALE } from "../shared/tale.js";
import { config } from "./config.js";

pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 48, connectionTimeoutMillis: 5000 });
pool.on("error", () => undefined);

export const isUniqueViolation = (error: unknown): boolean => (error as { code?: string }).code === "23505";

export type Queryable = Pick<pg.PoolClient, "query">;

export const withTx = async <T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> => {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await work(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
};

/** Runs work while holding a session advisory lock, so attempts on one box are serialised across processes. */
export const withLock = async <T>(key: number, work: () => Promise<T>): Promise<T> => {
  const session = await pool.connect();
  try {
    await session.query("SELECT pg_advisory_lock($1)", [key]);
    return await work();
  } finally {
    await session.query("SELECT pg_advisory_unlock($1)", [key]);
    session.release();
  }
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS boxes (
  number int PRIMARY KEY, plate text NOT NULL, state text NOT NULL DEFAULT 'available');
CREATE TABLE IF NOT EXISTS orders (
  reference text PRIMARY KEY,
  box_number int NOT NULL REFERENCES boxes(number),
  hold_token text NOT NULL,
  order_token text NOT NULL,
  method text,
  buyer_name text, buyer_email text, street text, postcode text, city text,
  gift_name text, gift_email text, gift_message text,
  payment_state text NOT NULL DEFAULT 'started',
  box_state text,
  live boolean NOT NULL DEFAULT false,
  rate_basis_points int,
  payment_id text, transfer_id text, transfer_iban text, transfer_reference text,
  challenge_id text, challenge_expires_at timestamptz,
  kb_account_id text, kb_invoice_id text, kb_payment_id text,
  deadline_at timestamptz,
  authorised_at timestamptz,
  auth_expires_at timestamptz,
  capture_requested boolean NOT NULL DEFAULT false,
  capture_confirmed boolean NOT NULL DEFAULT false,
  capture_attempts int NOT NULL DEFAULT 0,
  settle_confirmed boolean NOT NULL DEFAULT false,
  void_pending boolean NOT NULL DEFAULT false,
  kb_closed boolean NOT NULL DEFAULT true,
  last_sequence int NOT NULL DEFAULT 0,
  certificate_state text NOT NULL DEFAULT 'none',
  tracking_code text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (box_number, hold_token));
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_live_claim ON orders (box_number) WHERE live;
CREATE INDEX IF NOT EXISTS orders_email ON orders (lower(buyer_email));
CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL, key text NOT NULL, fingerprint text NOT NULL,
  done boolean NOT NULL DEFAULT false, status int, body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (scope, key));
CREATE TABLE IF NOT EXISTS payment_events (
  event_id text PRIMARY KEY, reference text NOT NULL, sequence int NOT NULL, type text NOT NULL,
  status text NOT NULL, payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS refunds (
  refund_id text PRIMARY KEY, reference text NOT NULL, idempotency_key text,
  fingerprint text, amount_ore int NOT NULL, net_ore int NOT NULL, vat_ore int NOT NULL,
  charity_ore int NOT NULL, maker_ore int NOT NULL, state text NOT NULL DEFAULT 'pending',
  gateway_refund_id text, gateway_confirmed boolean NOT NULL DEFAULT false,
  kb_done boolean NOT NULL DEFAULT false, rate_basis_points int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_key ON refunds (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS split_lines (
  id bigserial PRIMARY KEY, reference text NOT NULL, box_number int NOT NULL, kind text NOT NULL,
  gross_ore int NOT NULL, net_ore int NOT NULL, vat_ore int NOT NULL, charity_ore int NOT NULL,
  maker_ore int NOT NULL, rate_basis_points int NOT NULL, posted_at timestamptz NOT NULL,
  refund_id text);
CREATE INDEX IF NOT EXISTS split_lines_reference ON split_lines (reference);
CREATE TABLE IF NOT EXISTS rate_changes (
  id serial PRIMARY KEY, basis_points int NOT NULL, effective_from timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS statements (
  id text PRIMARY KEY, month text NOT NULL, revision int NOT NULL,
  charity_total_ore int NOT NULL, maker_total_ore int NOT NULL, vat_total_ore int NOT NULL,
  lines jsonb NOT NULL, token text NOT NULL, issued_at timestamptz NOT NULL,
  UNIQUE (month, revision));
CREATE TABLE IF NOT EXISTS events (
  event_id text PRIMARY KEY, type text NOT NULL, reference text NOT NULL, box_number int NOT NULL,
  occurred_at timestamptz NOT NULL, published boolean NOT NULL DEFAULT false,
  attempts int NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'pending',
  last_error text, failed_at timestamptz, dismissal_note text);
CREATE INDEX IF NOT EXISTS events_unpublished ON events (occurred_at) WHERE NOT published;
CREATE TABLE IF NOT EXISTS event_effects (
  event_id text NOT NULL, effect text NOT NULL, PRIMARY KEY (event_id, effect));
CREATE TABLE IF NOT EXISTS jobs (
  id bigserial PRIMARY KEY, kind text NOT NULL, key text NOT NULL UNIQUE, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(), last_error text);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs (run_at) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS passages (
  passage_id text PRIMARY KEY, chapter text NOT NULL, position int NOT NULL, text text NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, username text NOT NULL, roles text[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS kb_accounts (email text PRIMARY KEY, account_id text NOT NULL);
CREATE TABLE IF NOT EXISTS stock_alerts (threshold int PRIMARY KEY, armed boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS plate_art (
  plate text PRIMARY KEY, object_key text NOT NULL, content_type text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
`;

/** Applies the schema and the seed rows; safe to run on every serve. */
export const migrate = async (): Promise<void> => {
  await withTx(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(72011)");
    await tx.query(SCHEMA);
    for (let number = 1; number <= EDITION; number += 1)
      await tx.query("INSERT INTO boxes (number, plate) VALUES ($1, $2) ON CONFLICT DO NOTHING", [number, plateOf(number)]);
    await tx.query(
      "INSERT INTO rate_changes (basis_points, effective_from) SELECT $1, to_timestamp(0) WHERE NOT EXISTS (SELECT 1 FROM rate_changes)",
      [SEED_RATE_BASIS_POINTS],
    );
    for (const [position, passage] of TALE.entries())
      await tx.query(
        "INSERT INTO passages (passage_id, chapter, position, text) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [passage.passageId, passage.chapter, position, passage.text],
      );
    for (const threshold of config.lowStockThresholds)
      await tx.query("INSERT INTO stock_alerts (threshold) VALUES ($1) ON CONFLICT DO NOTHING", [threshold]);
  });
};
