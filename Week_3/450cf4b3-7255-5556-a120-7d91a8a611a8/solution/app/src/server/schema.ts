// Schema and seed, applied idempotently at every start under an advisory lock, so a second
// process starting against an already seeded database adds nothing.

import { addDays } from "../shared/clock.js";
import { hashPassword } from "./auth.js";
import { db } from "./db.js";
import { kitchenTime } from "./kitchen.js";
import { col, only, type Queryable } from "./postgres.js";

const SCHEMA_LOCK = 4_173_001;

const DDL = [
  `CREATE EXTENSION IF NOT EXISTS btree_gist`,
  `CREATE TABLE IF NOT EXISTS kitchen_seed (
     id smallint PRIMARY KEY CHECK (id = 1),
     seeded_on date NOT NULL,
     seeded_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS stations (
     id text PRIMARY KEY,
     name text NOT NULL,
     kind text NOT NULL CHECK (kind IN ('range', 'prep_table', 'mixer', 'cooler_shelf')),
     col int NOT NULL,
     "row" int NOT NULL,
     cleanup_minutes int NOT NULL,
     seed_order int NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS tenants (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     business_name text NOT NULL,
     contact_name text NOT NULL,
     onboarding text NOT NULL CHECK (onboarding IN ('applied', 'documents_pending', 'approved')),
     killbill_account_id text,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     role text NOT NULL CHECK (role IN ('owner', 'shift_lead', 'tenant')),
     email text NOT NULL,
     display_name text NOT NULL,
     password_hash text NOT NULL,
     tenant_id uuid UNIQUE REFERENCES tenants (id),
     created_at timestamptz NOT NULL DEFAULT now(),
     CHECK ((role = 'tenant') = (tenant_id IS NOT NULL)))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email))`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users (id),
     confirmed_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS documents (
     id uuid PRIMARY KEY,
     seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
     tenant_id uuid NOT NULL REFERENCES tenants (id),
     kind text NOT NULL CHECK (kind IN ('insurance_certificate', 'food_handler_card')),
     expires_on date NOT NULL,
     per_occurrence_limit bigint,
     additional_insured boolean,
     content_type text,
     size_bytes int,
     sha256 text,
     object_key text,
     uploaded_at timestamptz NOT NULL DEFAULT now(),
     CHECK ((kind = 'insurance_certificate') = (per_occurrence_limit IS NOT NULL AND additional_insured IS NOT NULL)))`,
  `CREATE INDEX IF NOT EXISTS documents_by_tenant ON documents (tenant_id, kind, seq DESC)`,
  `CREATE OR REPLACE VIEW current_documents AS
     SELECT DISTINCT ON (tenant_id, kind) * FROM documents ORDER BY tenant_id, kind, seq DESC`,
  `CREATE TABLE IF NOT EXISTS purchase_attempts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users (id),
     tenant_id uuid NOT NULL REFERENCES tenants (id),
     endpoint text NOT NULL,
     idempotency_key text NOT NULL,
     fingerprint text NOT NULL,
     hours int NOT NULL,
     state text NOT NULL CHECK (state IN ('started', 'invoiced', 'paid', 'finished', 'voided', 'failed')),
     lease_until timestamptz NOT NULL,
     account_id text,
     invoice_id text,
     invoice_item_id text,
     payment_id text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS purchase_attempts_by_key ON purchase_attempts (user_id, endpoint, idempotency_key, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS packs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id uuid NOT NULL REFERENCES tenants (id),
     hours int NOT NULL,
     purchased_minutes int NOT NULL,
     price_cents int NOT NULL,
     status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'refunded')),
     invoice_id text NOT NULL,
     invoice_item_id text NOT NULL,
     payment_id text NOT NULL,
     attempt_id uuid NOT NULL UNIQUE REFERENCES purchase_attempts (id),
     refunded_cents int,
     purchased_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS bookings (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id uuid NOT NULL REFERENCES tenants (id),
     station_id text NOT NULL REFERENCES stations (id),
     shelf_id text REFERENCES stations (id),
     start_at timestamptz NOT NULL,
     end_at timestamptz NOT NULL,
     buffer_end timestamptz NOT NULL,
     minutes int NOT NULL,
     status text NOT NULL CHECK (status IN ('held', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')),
     hold_expires_at timestamptz NOT NULL,
     pack_id uuid NOT NULL REFERENCES packs (id),
     debited_minutes int,
     refunded_minutes int,
     cancel_reason text CHECK (cancel_reason IN ('tenant', 'hold_expired')),
     cleanup_note text,
     move_count smallint NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now())`,
  // The one definition of a live hold: from holdExpiresAt on, a held booking reads as cancelled
  // with hold_expired for every statement, whatever its stored status still says.
  `CREATE OR REPLACE VIEW bookings_now AS
     SELECT b.id, b.tenant_id, b.station_id, b.shelf_id, b.start_at, b.end_at, b.buffer_end, b.minutes,
            CASE WHEN l.lapsed THEN 'cancelled' ELSE b.status END AS status,
            b.hold_expires_at, b.pack_id, b.debited_minutes, b.refunded_minutes,
            CASE WHEN l.lapsed THEN 'hold_expired' ELSE b.cancel_reason END AS cancel_reason,
            b.cleanup_note, b.move_count, b.created_at
       FROM bookings b
       CROSS JOIN LATERAL (SELECT b.status = 'held' AND b.hold_expires_at <= now() AS lapsed) l`,
  `CREATE INDEX IF NOT EXISTS bookings_by_start ON bookings (start_at)`,
  `CREATE INDEX IF NOT EXISTS bookings_held ON bookings (hold_expires_at) WHERE status = 'held'`,
  // One row per station a booking occupies; the exclusion constraint is the no-overlap rule for
  // single and paired bookings alike, and a trigger keeps "live" in step with the booking status.
  `CREATE TABLE IF NOT EXISTS booking_occupancies (
     booking_id uuid NOT NULL REFERENCES bookings (id),
     station_id text NOT NULL REFERENCES stations (id),
     start_at timestamptz NOT NULL,
     buffer_end timestamptz NOT NULL,
     live boolean NOT NULL DEFAULT true,
     PRIMARY KEY (booking_id, station_id),
     CONSTRAINT occupancies_no_overlap EXCLUDE USING gist (station_id WITH =, tstzrange(start_at, buffer_end) WITH &&) WHERE (live))`,
  `CREATE OR REPLACE FUNCTION booking_occupancies_follow() RETURNS trigger LANGUAGE plpgsql AS
     $$ BEGIN UPDATE booking_occupancies SET live = (NEW.status <> 'cancelled') WHERE booking_id = NEW.id; RETURN NEW; END $$`,
  `DROP TRIGGER IF EXISTS booking_occupancies_follow ON bookings`,
  `CREATE TRIGGER booking_occupancies_follow AFTER UPDATE OF status ON bookings
     FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION booking_occupancies_follow()`,
  `CREATE TABLE IF NOT EXISTS door_log (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
     booking_id uuid NOT NULL REFERENCES bookings (id),
     action text NOT NULL CHECK (action IN ('check_in', 'check_out', 'no_show')),
     at timestamptz NOT NULL DEFAULT now(),
     by_user_id uuid NOT NULL REFERENCES users (id),
     by_name text NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS door_log_by_booking ON door_log (booking_id, seq)`,
  `CREATE OR REPLACE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS
     $$ BEGIN RAISE EXCEPTION '% rows are never edited or deleted', TG_TABLE_NAME; END $$`,
  `DROP TRIGGER IF EXISTS door_log_append_only ON door_log`,
  `CREATE TRIGGER door_log_append_only BEFORE UPDATE OR DELETE ON door_log
     FOR EACH ROW EXECUTE FUNCTION append_only()`,
  `CREATE TABLE IF NOT EXISTS signin_attempts (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     email text NOT NULL,
     at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS signin_attempts_by_email ON signin_attempts (email, at)`,
  `CREATE TABLE IF NOT EXISTS counted_claims (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     tenant_id uuid NOT NULL REFERENCES tenants (id),
     at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS counted_claims_by_tenant ON counted_claims (tenant_id, at)`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
     movement_id uuid NOT NULL,
     movement text NOT NULL CHECK (movement IN ('purchase', 'booking_debit', 'cancellation_credit', 'move_adjustment', 'refund')),
     side text NOT NULL CHECK (side IN ('pack', 'kitchen')),
     minutes int NOT NULL,
     pack_id uuid NOT NULL REFERENCES packs (id),
     booking_id uuid REFERENCES bookings (id),
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (movement_id, side))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ledger_once_per_booking ON ledger_entries (booking_id, movement, side) WHERE booking_id IS NOT NULL`,
  `DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries`,
  `CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
     FOR EACH ROW EXECUTE FUNCTION append_only()`,
  `CREATE TABLE IF NOT EXISTS mail_queue (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     action text NOT NULL,
     record_id text NOT NULL,
     to_name text NOT NULL,
     to_address text NOT NULL,
     subject text NOT NULL,
     body text NOT NULL,
     queued_at timestamptz NOT NULL DEFAULT now(),
     claimed_until timestamptz,
     attempts int NOT NULL DEFAULT 0,
     failed_by uuid,
     failed_at timestamptz,
     last_error text,
     delivered_at timestamptz)`,
  `CREATE INDEX IF NOT EXISTS mail_queue_pending ON mail_queue (queued_at) WHERE delivered_at IS NULL`,
  `CREATE OR REPLACE VIEW pack_figures AS
     SELECT p.*, f.balance_minutes, f.held_minutes, f.balance_minutes - f.held_minutes AS available_minutes,
            (SELECT m.delivered_at FROM mail_queue m WHERE m.action = 'pack_receipt' AND m.record_id = p.id::text ORDER BY m.queued_at LIMIT 1) AS receipt_delivered_at
       FROM packs p
       CROSS JOIN LATERAL (
         SELECT COALESCE((SELECT sum(e.minutes) FROM ledger_entries e WHERE e.pack_id = p.id AND e.side = 'pack'), 0)::int AS balance_minutes,
                COALESCE((SELECT sum(b.minutes) FROM bookings_now b WHERE b.pack_id = p.id AND b.status = 'held'), 0)::int AS held_minutes
       ) f`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     user_id uuid NOT NULL REFERENCES users (id),
     endpoint text NOT NULL,
     key text NOT NULL,
     fingerprint text NOT NULL,
     state text NOT NULL CHECK (state IN ('running', 'done')),
     lease_until timestamptz NOT NULL,
     response_status int,
     response_body text,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, endpoint, key))`,
  `CREATE TABLE IF NOT EXISTS notice_claims (
     document_id uuid NOT NULL REFERENCES documents (id),
     point text NOT NULL CHECK (point IN ('seven_days', 'today')),
     claimed_at timestamptz NOT NULL DEFAULT now(),
     mail_id uuid REFERENCES mail_queue (id),
     PRIMARY KEY (document_id, point))`,
];

const STATIONS = [
  ["range-1", "Range 1", "range", 0, 0],
  ["range-2", "Range 2", "range", 1, 0],
  ["range-3", "Range 3", "range", 2, 0],
  ["prep-a", "Prep Table A", "prep_table", 0, 1],
  ["prep-b", "Prep Table B", "prep_table", 1, 1],
  ["mixer-60", "Mixer 60 qt", "mixer", 2, 1],
  ["mixer-20", "Mixer 20 qt", "mixer", 3, 1],
  ["shelf-1", "Walk-in Shelf 1", "cooler_shelf", 0, 2],
  ["shelf-2", "Walk-in Shelf 2", "cooler_shelf", 1, 2],
  ["shelf-3", "Walk-in Shelf 3", "cooler_shelf", 2, 2],
] as const;

const STAFF = [
  ["owner", "Imani Ferro", "owner@stationhouse.test", "owner-pass-2026"],
  ["shift_lead", "Theo Park", "lead@stationhouse.test", "lead-pass-2026"],
] as const;

const TENANT_PASSWORD = "tenant-pass-2026";

/** Business, contact, email, stored onboarding, insurance and food-handler expiry in days from today. */
const TENANTS = [
  ["Bright Fork Catering", "Dana Okafor", "dana@brightfork.test", "approved", 200, 200],
  ["Tío Lalo's Tacos", "Lalo Medina", "lalo@tiolalo.test", "approved", 200, 200],
  ["Crumb & Kettle Bakery", "Pearl Asante", "pearl@crumbkettle.test", "approved", 2, 200],
  ["Saltbox Provisions", "June Harrow", "june@saltbox.test", "approved", 0, 200],
  ["Night Market Dumplings", "Wei Lindqvist", "wei@nightmarket.test", "approved", -1, 200],
  ["Copper Pot Jams", "Sam Whitlock", "sam@copperpot.test", "documents_pending", 200, 200],
  ["Fennel & Fig", "Ari Castellanos", "ari@fennelfig.test", "applied", null, null],
] as const;

async function seed(tx: Queryable): Promise<void> {
  const { today } = await kitchenTime(tx);
  await tx.query("INSERT INTO kitchen_seed (id, seeded_on) VALUES (1, $1)", [today]);
  for (const [order, [id, name, kind, column, row]] of STATIONS.entries()) {
    await tx.query(
      `INSERT INTO stations (id, name, kind, col, "row", cleanup_minutes, seed_order) VALUES ($1, $2, $3, $4, $5, 30, $6)`,
      [id, name, kind, column, row, order],
    );
  }
  for (const [role, name, email, password] of STAFF) {
    await tx.query("INSERT INTO users (role, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
      [role, email, name, await hashPassword(password)]);
  }
  const tenantHash = await hashPassword(TENANT_PASSWORD);
  for (const [business, contact, email, onboarding, insurance, foodHandler] of TENANTS) {
    const tenantId = col.text(only(await tx.query(
      "INSERT INTO tenants (business_name, contact_name, onboarding) VALUES ($1, $2, $3) RETURNING id",
      [business, contact, onboarding],
    )), "id");
    await tx.query("INSERT INTO users (role, email, display_name, password_hash, tenant_id) VALUES ('tenant', $1, $2, $3, $4)",
      [email, contact, tenantHash, tenantId]);
    if (insurance === null || foodHandler === null) continue;
    await tx.query(
      `INSERT INTO documents (id, tenant_id, kind, expires_on, per_occurrence_limit, additional_insured)
       VALUES (gen_random_uuid(), $1, 'insurance_certificate', $2, 1000000, true),
              (gen_random_uuid(), $1, 'food_handler_card', $3, NULL, NULL)`,
      [tenantId, addDays(today, insurance), addDays(today, foodHandler)],
    );
  }
}

export async function applySchema(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    for (const statement of DDL) await tx.query(statement);
    const [seeded] = await tx.query("SELECT 1 AS seeded FROM kitchen_seed WHERE id = 1");
    if (!seeded) await seed(tx);
  });
}
