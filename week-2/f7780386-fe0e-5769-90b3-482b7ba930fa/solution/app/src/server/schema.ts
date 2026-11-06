// Schema and seed data, applied idempotently on every serve into an empty or an existing database.

import type { Db } from "./db.js";
import { hashPassword } from "./passwords.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kitchen (
  id text PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL
);
CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  name text NOT NULL,
  hourly_rate_cents integer NOT NULL CHECK (hourly_rate_cents >= 0),
  cleaning_minutes integer NOT NULL CHECK (cleaning_minutes >= 0 AND cleaning_minutes % 15 = 0),
  position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  business_name text NOT NULL,
  contact_email text NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('operator', 'member', 'crew_cook')),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  member_id text REFERENCES members(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  station_id text NOT NULL REFERENCES stations(id),
  date date NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL,
  tail_end_minute integer NOT NULL,
  status text NOT NULL CHECK (status IN ('live', 'confirmed', 'expired', 'released')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_live ON holds (expires_at) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS holds_station_date ON holds (station_id, date);
-- One winner per cell: a live hold or a non-cancelled booking (through its hold) owns each station cell.
CREATE TABLE IF NOT EXISTS station_cells (
  station_id text NOT NULL REFERENCES stations(id),
  date date NOT NULL,
  cell_minute integer NOT NULL,
  hold_id text NOT NULL REFERENCES holds(id),
  PRIMARY KEY (station_id, date, cell_minute)
);
CREATE INDEX IF NOT EXISTS station_cells_hold ON station_cells (hold_id);
CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  hold_id text NOT NULL UNIQUE REFERENCES holds(id),
  member_id text NOT NULL REFERENCES members(id),
  station_id text NOT NULL REFERENCES stations(id),
  date date NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL,
  tail_end_minute integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('confirmed', 'checked_in', 'completed', 'cancelled_free', 'cancelled_with_fee')),
  payment text NOT NULL CHECK (payment IN ('paid', 'payment_pending', 'voided')),
  booked_minutes integer NOT NULL,
  prepaid_minutes integer NOT NULL,
  overage_minutes integer NOT NULL,
  overage_cents integer NOT NULL,
  list_cents integer NOT NULL,
  free_cancel_until timestamptz NOT NULL,
  fee_cents integer,
  fee_status text CHECK (fee_status IN ('pending', 'charged', 'waived')),
  confirmed_at timestamptz NOT NULL,
  cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS bookings_date ON bookings (date);
CREATE INDEX IF NOT EXISTS bookings_member ON bookings (member_id, date);
CREATE TABLE IF NOT EXISTS check_ins (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id),
  crew_cook_id text NOT NULL REFERENCES users(id),
  at timestamptz NOT NULL,
  card_document_id text NOT NULL,
  UNIQUE (booking_id, crew_cook_id)
);
CREATE TABLE IF NOT EXISTS ledger_transactions (
  seq bigserial UNIQUE,
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  kind text NOT NULL CHECK (kind IN ('opening', 'pack_purchase', 'booking_debit', 'cancellation_refund', 'adjustment', 'reversal')),
  created_at timestamptz NOT NULL,
  booking_id text REFERENCES bookings(id),
  reason text,
  reverses text UNIQUE REFERENCES ledger_transactions(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_debit_per_booking ON ledger_transactions (booking_id) WHERE kind = 'booking_debit';
CREATE UNIQUE INDEX IF NOT EXISTS one_refund_per_booking ON ledger_transactions (booking_id) WHERE kind = 'cancellation_refund';
CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  transaction_id text NOT NULL REFERENCES ledger_transactions(id),
  account text NOT NULL,
  minutes integer NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries (account);
CREATE INDEX IF NOT EXISTS ledger_entries_transaction ON ledger_entries (transaction_id);
CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  kind text NOT NULL CHECK (kind IN ('liability_insurance', 'food_handler_card')),
  crew_cook_id text REFERENCES users(id),
  expires_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('uploaded', 'approved', 'rejected')),
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  object_key text NOT NULL,
  uploaded_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  rejection_reason text
);
CREATE TABLE IF NOT EXISTS document_warnings (
  document_id text NOT NULL REFERENCES documents(id),
  days_before integer NOT NULL CHECK (days_before IN (14, 3)),
  PRIMARY KEY (document_id, days_before)
);
CREATE TABLE IF NOT EXISTS packets (
  id text PRIMARY KEY,
  from_date date NOT NULL,
  to_date date NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  token text UNIQUE,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL REFERENCES users(id),
  key text NOT NULL,
  request_hash text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  status_code integer,
  response text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id text PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('booking_confirmed', 'booking_cancelled', 'expiry_warning', 'invoice_notice')),
  ref text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient text NOT NULL,
  sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_outbox_unsent ON mail_outbox (created_at) WHERE NOT sent;
CREATE TABLE IF NOT EXISTS billing_accounts (
  member_id text PRIMARY KEY REFERENCES members(id),
  killbill_account_id text NOT NULL
);
-- Queued Kill Bill work. "target" names the Kill Bill endpoint the work was queued for, so an instance
-- only delivers work to the billing service it is configured with.
CREATE TABLE IF NOT EXISTS billing_jobs (
  id text PRIMARY KEY,
  target text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('overage_charge', 'fee_charge', 'fee_waiver_credit', 'overage_refund_credit')),
  member_id text NOT NULL REFERENCES members(id),
  booking_id text NOT NULL REFERENCES bookings(id),
  amount_cents integer NOT NULL,
  description text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'done', 'dropped')),
  killbill_invoice_id text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_jobs_queued ON billing_jobs (target, created_at) WHERE state = 'queued';
CREATE UNIQUE INDEX IF NOT EXISTS one_billing_job_per_kind ON billing_jobs (booking_id, kind);
`;

const SEED_PASSWORD = "prep-shift-2026";

export const SEED_DOCUMENTS = [
  { id: "doc-rosa-coi", member: "mbr-rosa", kind: "liability_insurance", crew: null, expires: "2030-12-31" },
  { id: "doc-crumb-coi", member: "mbr-crumb", kind: "liability_insurance", crew: null, expires: "2030-12-31" },
  { id: "doc-lake-coi", member: "mbr-lake", kind: "liability_insurance", crew: null, expires: "2026-09-30" },
  { id: "doc-tomas-card", member: "mbr-rosa", kind: "food_handler_card", crew: "usr-tomas", expires: "2030-06-30" },
  { id: "doc-lena-card", member: "mbr-rosa", kind: "food_handler_card", crew: "usr-lena", expires: "2026-08-31" },
  { id: "doc-abe-card", member: "mbr-crumb", kind: "food_handler_card", crew: "usr-abe", expires: "2030-06-30" },
] as const;

export type SeedDocument = (typeof SEED_DOCUMENTS)[number];

const USERS = [
  ["usr-ines", "operator", "Ines Albrecht", "ines@halsted-kitchen.test", null],
  ["usr-rosa", "member", "Rosa Delgado", "rosa@tamalcart.test", "mbr-rosa"],
  ["usr-owen", "member", "Owen Mbeki", "owen@crumbco.test", "mbr-crumb"],
  ["usr-priya", "member", "Priya Natarajan", "priya@lakefrontprep.test", "mbr-lake"],
  ["usr-tomas", "crew_cook", "Tomás Reyes", "tomas@tamalcart.test", "mbr-rosa"],
  ["usr-lena", "crew_cook", "Lena Park", "lena@tamalcart.test", "mbr-rosa"],
  ["usr-abe", "crew_cook", "Abe Lindqvist", "abe@crumbco.test", "mbr-crumb"],
] as const;

const OPENING_BALANCES = [
  ["txn-open-rosa", "mbr-rosa", 360],
  ["txn-open-lake", "mbr-lake", 600],
] as const;

export function seedDocumentKey(member: string, documentId: string): string {
  return `documents/${member}/${documentId}`;
}

/** Applies the schema and seed in one transaction under an advisory lock, so concurrent serves agree. */
export async function migrate(db: Db, seededAt: Date, seedPdfSize: (doc: SeedDocument) => number): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(7342019)");
  await db.query(SCHEMA);
  await db.query(
    `INSERT INTO kitchen (id, name, time_zone) VALUES ('halsted', 'Halsted Street Kitchen', 'America/Chicago')
     ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO stations (id, name, hourly_rate_cents, cleaning_minutes, position) VALUES
       ('oven-1', 'Convection Oven 1', 2800, 30, 1),
       ('oven-2', 'Deck Oven', 2600, 30, 2),
       ('kettle-1', 'Steam Kettle', 3200, 45, 3),
       ('prep-a', 'Prep Station A', 1800, 15, 4),
       ('prep-b', 'Prep Station B', 1800, 15, 5),
       ('cold-1', 'Walk-in Shelf 1', 600, 0, 6)
     ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO packs (id, name, minutes, price_cents, position) VALUES
       ('pack-10', '10-hour pack', 600, 23000, 1),
       ('pack-25', '25-hour pack', 1500, 52500, 2)
     ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO members (id, business_name, contact_email) VALUES
       ('mbr-rosa', 'Rosa''s Tamal Cart', 'rosa@tamalcart.test'),
       ('mbr-crumb', 'Northside Crumb Co.', 'owen@crumbco.test'),
       ('mbr-lake', 'Lakefront Meal Prep', 'priya@lakefrontprep.test')
     ON CONFLICT (id) DO NOTHING`,
  );
  const existing = await db.query<{ id: string }>("SELECT id FROM users");
  const known = new Set(existing.rows.map((row) => row.id));
  for (const [id, role, name, email, member] of USERS) {
    if (known.has(id)) continue;
    await db.query(
      `INSERT INTO users (id, role, name, email, password_hash, member_id) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, role, name, email, await hashPassword(SEED_PASSWORD), member],
    );
  }
  for (const doc of SEED_DOCUMENTS) {
    await db.query(
      `INSERT INTO documents (id, member_id, kind, crew_cook_id, expires_on, status, filename, content_type,
                              size_bytes, object_key, uploaded_at, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6, 'application/pdf', $7, $8, $9, $9)
       ON CONFLICT (id) DO NOTHING`,
      [doc.id, doc.member, doc.kind, doc.crew, doc.expires, `${doc.id}.pdf`, seedPdfSize(doc), seedDocumentKey(doc.member, doc.id), seededAt],
    );
  }
  for (const [id, member, minutes] of OPENING_BALANCES) {
    const inserted = await db.query(
      `INSERT INTO ledger_transactions (id, member_id, kind, created_at, reason)
       VALUES ($1, $2, 'opening', $3, 'Opening balance') ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, member, seededAt],
    );
    if (inserted.rowCount === 1) {
      await db.query(
        `INSERT INTO ledger_entries (transaction_id, account, minutes) VALUES ($1, $2, $3), ($1, 'kitchen:issued', $4)`,
        [id, `member:${member}`, minutes, -minutes],
      );
    }
  }
}
