// PostgreSQL: the pool, transactions, schema and readiness. The system of record for everything.
import pg from "pg";
import { config } from "./config.ts";
import { seedIfEmpty } from "./seed.ts";
import { auditBeforeCommit, auditRolledBack } from "./audit.ts";

export type Db = pg.PoolClient;
type Row = object;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 16, idleTimeoutMillis: 5000, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));
// A connection that drops while checked out fails its own query; it must never take the process down.
pool.on("connect", (client) => client.on("error", (error) => console.error("postgres connection error:", error.message)));

// Dates stay as the YYYY-MM-DD text they are stored as; no time zone shifts.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

let ready = false;

/** Health: the schema is in place and the database answers now (within a second). */
export async function isReady(): Promise<boolean> {
  if (!ready) return false;
  const probe = pool.query("SELECT 1").then(
    () => true,
    () => false,
  );
  return Promise.race([probe, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000))]);
}

export async function rows<T extends Row>(db: Db | pg.Pool, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

/** The one row a query must find. */
export async function theRow<T extends Row>(db: Db | pg.Pool, sql: string, params: unknown[] = []): Promise<T> {
  return required((await rows<T>(db, sql, params))[0]);
}

export function required<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("a required row is missing");
  return row;
}

export async function one<T extends Row>(db: Db | pg.Pool, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

const RETRYABLE = new Set(["40001", "40P01"]);

function sqlState(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return sqlState(error) === "23505";
}

/**
 * Runs `work` in one transaction, retrying on deadlock or serialization failure. Work that calls an
 * external service passes `retry: false`, so a provider call is never repeated by a retry.
 */
export async function tx<T>(work: (db: Db) => Promise<T>, options: { retry: boolean } = { retry: true }): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    let audited = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      audited = await auditBeforeCommit(client, result);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (audited) auditRolledBack();
      await client.query("ROLLBACK").catch(() => undefined);
      if (options.retry && attempt < 4 && RETRYABLE.has(sqlState(error) ?? "")) continue;
      throw error;
    } finally {
      client.release();
    }
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY, name text NOT NULL, legal_name text NOT NULL);
CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants, name text NOT NULL,
  time_zone text NOT NULL, address text NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS stations (
  id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES sites, name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('oven','mixer','blast_chiller','prep_table')), position int NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants, email text NOT NULL UNIQUE, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('member','kitchen_manager','finance_lead')), password_hash text NOT NULL,
  site_id uuid REFERENCES sites);
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES users, tenant_id uuid NOT NULL REFERENCES tenants,
  business_name text NOT NULL, home_site_id uuid NOT NULL REFERENCES sites,
  seeded_certificate_of_insurance date, seeded_food_handler_certificate date, seeded_business_licence date);
CREATE TABLE IF NOT EXISTS trucks (
  id uuid PRIMARY KEY, member_id uuid NOT NULL UNIQUE REFERENCES members, name text NOT NULL, permit_number text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, csrf_hash text NOT NULL, user_id uuid NOT NULL REFERENCES users,
  created_at timestamptz NOT NULL, last_used_at timestamptz NOT NULL, destroyed_at timestamptz, seq bigserial NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS sign_in_failures (
  id bigserial PRIMARY KEY, email text NOT NULL, address text NOT NULL, at timestamptz NOT NULL, cleared boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS sign_in_failures_email ON sign_in_failures (email, at);
CREATE INDEX IF NOT EXISTS sign_in_failures_address ON sign_in_failures (address, at);
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL, actor_user_id uuid, actor_name text, actor_role text, action text NOT NULL,
  target_type text, target_id uuid, outcome text NOT NULL, address_prefix text,
  subject_user_id uuid, tenant_id uuid, token_site_id uuid);
CREATE INDEX IF NOT EXISTS audit_events_tenant ON audit_events (tenant_id, id);
CREATE TABLE IF NOT EXISTS packs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants, name text NOT NULL,
  quarters int NOT NULL, price_cents int NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY, member_id uuid NOT NULL REFERENCES members, pack_id uuid NOT NULL REFERENCES packs,
  pack_name text NOT NULL, quarters int NOT NULL, price_cents int NOT NULL, valid_through date NOT NULL,
  killbill_payment_id text, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS lots (
  id uuid PRIMARY KEY, member_id uuid NOT NULL REFERENCES members, purchase_id uuid UNIQUE REFERENCES purchases,
  pack_name text NOT NULL, valid_through date, seq bigserial NOT NULL);
CREATE TABLE IF NOT EXISTS series (
  id uuid PRIMARY KEY, member_id uuid NOT NULL REFERENCES members, station_id uuid NOT NULL REFERENCES stations,
  weekday text NOT NULL, start_minutes int NOT NULL, end_minutes int NOT NULL, weeks int NOT NULL,
  created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS lots_member ON lots (member_id);
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants, reference text NOT NULL,
  site_id uuid NOT NULL REFERENCES sites, station_id uuid NOT NULL REFERENCES stations,
  member_id uuid NOT NULL REFERENCES members, date date NOT NULL, start_minutes int NOT NULL, end_minutes int NOT NULL,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, occupied_until timestamptz NOT NULL,
  quarters int NOT NULL, status text NOT NULL, hold_expires_at timestamptz, series_id uuid REFERENCES series,
  refunded_quarters int, forfeited_quarters int,
  cancelled_by_id uuid, cancelled_by_name text, cancellation_reason text,
  checked_in_at timestamptz, checked_in_by_id uuid, checked_in_by_name text,
  no_show_by_id uuid, no_show_by_name text,
  checked_out_at timestamptz, checked_out_by_id uuid, checked_out_by_name text,
  late_quarter_hours int, pack_quarters_applied int,
  overage_quarter_hours int, overage_hourly_rate_cents int, overage_tax_rate_percent text,
  overage_subtotal_cents int, overage_tax_cents int, overage_total_cents int, overage_killbill_invoice_id text,
  created_at timestamptz NOT NULL, seq bigserial NOT NULL,
  UNIQUE (tenant_id, reference));
CREATE INDEX IF NOT EXISTS bookings_station_span ON bookings (station_id, start_at);
CREATE INDEX IF NOT EXISTS bookings_member ON bookings (member_id);
CREATE INDEX IF NOT EXISTS bookings_site_date ON bookings (site_id, date);
CREATE TABLE IF NOT EXISTS movements (
  id uuid PRIMARY KEY, member_id uuid NOT NULL REFERENCES members, kind text NOT NULL,
  booking_id uuid REFERENCES bookings, purchase_id uuid REFERENCES purchases, quarters int NOT NULL CHECK (quarters > 0),
  actor_id uuid, actor_name text, actor_role text, created_at timestamptz NOT NULL, seq bigserial NOT NULL);
CREATE INDEX IF NOT EXISTS movements_member ON movements (member_id, seq);
CREATE INDEX IF NOT EXISTS movements_booking ON movements (booking_id);
CREATE TABLE IF NOT EXISTS entries (
  movement_id uuid NOT NULL REFERENCES movements, position smallint NOT NULL, account text NOT NULL,
  quarters int NOT NULL, PRIMARY KEY (movement_id, position));
CREATE TABLE IF NOT EXISTS movement_lots (
  movement_id uuid NOT NULL REFERENCES movements, position smallint NOT NULL, lot_id uuid NOT NULL REFERENCES lots,
  delta int NOT NULL CHECK (delta <> 0), PRIMARY KEY (movement_id, position));
CREATE INDEX IF NOT EXISTS movement_lots_lot ON movement_lots (lot_id);
CREATE TABLE IF NOT EXISTS rates (
  id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES sites, effective_from date NOT NULL,
  hourly_rate_cents int NOT NULL, tax_rate_percent text NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE (site_id, effective_from));
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY, member_id uuid NOT NULL REFERENCES members, type text NOT NULL, expiry_date date NOT NULL,
  status text NOT NULL, file_name text NOT NULL, content_type text NOT NULL, size_bytes int NOT NULL, sha256 text NOT NULL,
  rejection_reason text, created_at timestamptz NOT NULL, seq bigserial NOT NULL);
CREATE TABLE IF NOT EXISTS visits (
  id uuid PRIMARY KEY, truck_id uuid NOT NULL REFERENCES trucks, site_id uuid NOT NULL REFERENCES sites,
  arrived_at timestamptz NOT NULL, departed_at timestamptz, services text[] NOT NULL DEFAULT '{}',
  operator_signature text, arrived_by_name text NOT NULL, departed_by_name text, seq bigserial NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS visits_one_open ON visits (truck_id) WHERE departed_at IS NULL;
CREATE TABLE IF NOT EXISTS inspector_links (
  id uuid PRIMARY KEY, truck_id uuid NOT NULL REFERENCES trucks, inspector_email text NOT NULL,
  token text NOT NULL UNIQUE, url text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL, seq bigserial NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope uuid NOT NULL, key text NOT NULL, binding text NOT NULL, completed boolean NOT NULL DEFAULT false,
  status int, body text, started_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (scope, key));
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY, to_address text NOT NULL, subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz, sent_at timestamptz);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS notices (
  member_id uuid NOT NULL REFERENCES members, doc_type text NOT NULL, valid_through date NOT NULL,
  notice text NOT NULL, PRIMARY KEY (member_id, doc_type, valid_through, notice));
CREATE OR REPLACE FUNCTION pilotlight_ledger_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger and audit rows are never edited or deleted'; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'movements_append_only') THEN
    CREATE TRIGGER movements_append_only BEFORE UPDATE OR DELETE ON movements
      FOR EACH ROW EXECUTE FUNCTION pilotlight_ledger_is_append_only();
    CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE ON entries
      FOR EACH ROW EXECUTE FUNCTION pilotlight_ledger_is_append_only();
    CREATE TRIGGER movement_lots_append_only BEFORE UPDATE OR DELETE ON movement_lots
      FOR EACH ROW EXECUTE FUNCTION pilotlight_ledger_is_append_only();
    CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION pilotlight_ledger_is_append_only();
  END IF;
END $$;
`;

const BOOT_LOCK = 7_274_517;

async function prepare(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [BOOT_LOCK]);
    try {
      await client.query(SCHEMA);
      await seedIfEmpty(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [BOOT_LOCK]);
    }
  } finally {
    client.release();
  }
}

/** Connects, creates any missing schema and seeds an empty database; retries every 2 seconds. */
export async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      await prepare();
      ready = true;
      return;
    } catch (error) {
      console.error("database not ready:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
