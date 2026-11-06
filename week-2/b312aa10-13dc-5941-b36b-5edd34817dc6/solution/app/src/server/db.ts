import pg from "pg";
import { config } from "./config.js";

// DATE columns stay kitchen-local YYYY-MM-DD strings; bigint ids and counts become numbers.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 40 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.PoolClient | pg.Pool;

/** Deadlocks and serialisation failures: the transaction is run again, so contention never answers 5xx. */
const RETRYABLE = new Set(["40001", "40P01"]);

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (!RETRYABLE.has((error as { code?: string }).code ?? "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(200, 10 * attempt) * Math.random()));
    } finally {
      client.release();
    }
  }
}

/** Serialises work on one key (a station, a member's month, a sign-in email) until the transaction ends. */
export async function lockKey(client: pg.PoolClient, key: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
}

/**
 * The month-close order: every booking action touching a month holds its month key shared, and a
 * close holds it exclusively, so the two never interleave. Months are taken in sorted order.
 */
export async function lockMonths(client: pg.PoolClient, kitchenId: string, months: Iterable<string>, mode: "shared" | "exclusive"): Promise<void> {
  const fn = mode === "shared" ? "pg_advisory_xact_lock_shared" : "pg_advisory_xact_lock";
  for (const month of [...new Set(months)].sort()) await client.query(`SELECT ${fn}(hashtext($1))`, [`month:${kitchenId}:${month}`]);
}

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS kitchens (
  id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, time_zone text NOT NULL,
  peak_windows jsonb NOT NULL, required_documents text[] NOT NULL, rules_version integer NOT NULL DEFAULT 1,
  seeded_on date NOT NULL);
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS seeded_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY, kitchen_id text NOT NULL REFERENCES kitchens, name text NOT NULL, email text NOT NULL,
  business_name text NOT NULL, plan_hours integer NOT NULL);

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, kitchen_id text NOT NULL REFERENCES kitchens, email text NOT NULL UNIQUE, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('operator','shift_lead','member')), password_hash text NOT NULL,
  member_id text REFERENCES members);

CREATE TABLE IF NOT EXISTS signin_failures (
  id bigserial PRIMARY KEY, email text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE signin_failures ADD COLUMN IF NOT EXISTS leaves_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS signin_failures_leaves ON signin_failures (email, leaves_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, person_id text NOT NULL REFERENCES people, expires_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY, kitchen_id text NOT NULL REFERENCES kitchens, name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('hourly','shelf')), capacity integer CHECK ((kind = 'shelf') = (capacity IS NOT NULL)),
  position integer NOT NULL);

CREATE TABLE IF NOT EXISTS rate_versions (
  station_id text NOT NULL REFERENCES stations, effective_from text NOT NULL, effective_at timestamptz NOT NULL,
  off_peak_cents integer, peak_cents integer, shelf_day_cents integer,
  PRIMARY KEY (station_id, effective_at));

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY, kitchen_id text NOT NULL REFERENCES kitchens, member_id text NOT NULL REFERENCES members,
  station_id text NOT NULL REFERENCES stations, series_id text,
  local_date date NOT NULL, local_start text, local_end text, days integer,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('held','confirmed','checked_in','completed','cancelled_free','cancelled_late','no_show','expired')),
  quarters integer NOT NULL, peak_quarters integer NOT NULL, charge_cents integer NOT NULL,
  penalty_cents integer NOT NULL DEFAULT 0, penalty_waived boolean NOT NULL DEFAULT false,
  conflict boolean NOT NULL DEFAULT false, notes text NOT NULL,
  hold_expires_at timestamptz, confirmed_at timestamptz, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_one_hourly_occupant') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_one_hourly_occupant EXCLUDE USING gist
      (station_id WITH =, tstzrange(start_at, end_at) WITH &&)
      WHERE (days IS NULL AND status IN ('held','confirmed','checked_in','completed','no_show'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS bookings_kitchen_date ON bookings (kitchen_id, local_date);
CREATE INDEX IF NOT EXISTS bookings_member_date ON bookings (member_id, local_date);
CREATE INDEX IF NOT EXISTS bookings_due ON bookings (kitchen_id, status) WHERE status IN ('held','confirmed');

CREATE TABLE IF NOT EXISTS out_of_service (
  id text PRIMARY KEY, kitchen_id text NOT NULL REFERENCES kitchens, station_id text NOT NULL REFERENCES stations,
  local_date date NOT NULL, local_start text NOT NULL, local_end text NOT NULL,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, reason text NOT NULL);

CREATE TABLE IF NOT EXISTS billing_items (
  id bigserial PRIMARY KEY, kitchen_id text NOT NULL REFERENCES kitchens, member_id text NOT NULL REFERENCES members,
  booking_id text NOT NULL REFERENCES bookings, month text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('Booking','Moved','Late cancellation','Cancelled','Waived late cancellation','Adjustment')),
  description text NOT NULL, amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), attempted boolean NOT NULL DEFAULT false,
  kb_item_id text, recorded_at timestamptz);
CREATE INDEX IF NOT EXISTS billing_items_member_month ON billing_items (member_id, month, id);
CREATE INDEX IF NOT EXISTS billing_items_queue ON billing_items (id) WHERE recorded_at IS NULL;

CREATE TABLE IF NOT EXISTS hour_ledger (
  id bigserial PRIMARY KEY, billing_item_id bigint NOT NULL UNIQUE REFERENCES billing_items,
  member_id text NOT NULL REFERENCES members, month text NOT NULL, quarters integer NOT NULL);
CREATE INDEX IF NOT EXISTS hour_ledger_member_month ON hour_ledger (member_id, month);

CREATE TABLE IF NOT EXISTS kb_accounts (
  member_id text PRIMARY KEY REFERENCES members, kb_account_id text NOT NULL, name text NOT NULL);
CREATE TABLE IF NOT EXISTS account_names (
  id bigserial PRIMARY KEY, member_id text NOT NULL REFERENCES members, name text NOT NULL,
  delivered_at timestamptz);
CREATE INDEX IF NOT EXISTS account_names_queue ON account_names (id) WHERE delivered_at IS NULL;
CREATE TABLE IF NOT EXISTS kb_invoices (
  member_id text NOT NULL REFERENCES members, month text NOT NULL, kb_invoice_id text NOT NULL,
  committed_at timestamptz, PRIMARY KEY (member_id, month));
CREATE TABLE IF NOT EXISTS closed_months (
  kitchen_id text NOT NULL REFERENCES kitchens, month text NOT NULL, closed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kitchen_id, month));
CREATE TABLE IF NOT EXISTS close_time_names (
  kitchen_id text NOT NULL, month text NOT NULL, member_id text NOT NULL REFERENCES members, business_name text NOT NULL,
  PRIMARY KEY (kitchen_id, month, member_id), FOREIGN KEY (kitchen_id, month) REFERENCES closed_months);

CREATE TABLE IF NOT EXISTS frozen_figures (
  kitchen_id text NOT NULL, month text NOT NULL, surface text NOT NULL CHECK (surface IN ('invoice','report','csv')),
  member_id text NOT NULL DEFAULT '', body text NOT NULL,
  PRIMARY KEY (kitchen_id, month, surface, member_id), FOREIGN KEY (kitchen_id, month) REFERENCES closed_months);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY, to_address text NOT NULL, subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz);
ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS mail_outbox_queue ON mail_outbox (id) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id text NOT NULL REFERENCES people, key text NOT NULL, fingerprint text NOT NULL,
  status_code integer, body text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (person_id, key));

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY, kitchen_id text NOT NULL REFERENCES kitchens, member_id text NOT NULL REFERENCES members,
  type text NOT NULL CHECK (type IN ('insurance_certificate','food_handler_card')), expiry_date date NOT NULL,
  file_name text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL,
  uploaded_at timestamptz NOT NULL, approved_at timestamptz, superseded boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, object_stored boolean NOT NULL);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS seed_order integer;
CREATE TABLE IF NOT EXISTS document_notices (
  document_id text NOT NULL REFERENCES documents, notice text NOT NULL CHECK (notice IN ('14-day','3-day')),
  PRIMARY KEY (document_id, notice));

CREATE TABLE IF NOT EXISTS sanitation_entries (
  id text PRIMARY KEY, kitchen_id text NOT NULL REFERENCES kitchens, area text NOT NULL, task text NOT NULL,
  sanitizer_ppm integer, initials text NOT NULL, notes text NOT NULL, logged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  logged_by text NOT NULL);
CREATE INDEX IF NOT EXISTS sanitation_entries_kitchen ON sanitation_entries (kitchen_id, logged_at);
CREATE TABLE IF NOT EXISTS sanitation_reports (
  kitchen_id text NOT NULL REFERENCES kitchens, month text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','stored')), stored_at timestamptz,
  PRIMARY KEY (kitchen_id, month));

CREATE TABLE IF NOT EXISTS inspector_links (
  id text PRIMARY KEY, kitchen_id text NOT NULL REFERENCES kitchens, email text NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS inspector_tokens (
  token_hash text PRIMARY KEY, link_id text NOT NULL REFERENCES inspector_links, retired_at timestamptz);
CREATE TABLE IF NOT EXISTS inspector_access (
  id bigserial PRIMARY KEY, link_id text NOT NULL REFERENCES inspector_links,
  at timestamptz NOT NULL DEFAULT clock_timestamp(), action text NOT NULL CHECK (action IN ('view','document','report')),
  target text);

CREATE OR REPLACE FUNCTION lineboard_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% rows are never changed or removed', TG_TABLE_NAME; END $$;
CREATE OR REPLACE TRIGGER hour_ledger_append_only BEFORE UPDATE OR DELETE ON hour_ledger
  FOR EACH ROW EXECUTE FUNCTION lineboard_append_only();
CREATE OR REPLACE TRIGGER sanitation_entries_append_only BEFORE UPDATE OR DELETE ON sanitation_entries
  FOR EACH ROW EXECUTE FUNCTION lineboard_append_only();
CREATE OR REPLACE TRIGGER inspector_access_append_only BEFORE UPDATE OR DELETE ON inspector_access
  FOR EACH ROW EXECUTE FUNCTION lineboard_append_only();
`;

/** Waits for PostgreSQL, then applies the schema; instances sharing a database take turns. */
export async function migrate(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (error) {
      console.log(`waiting for PostgreSQL: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lineboard:schema'))");
    await client.query(SCHEMA);
  });
}
