// Schema and seed, applied on every start under one advisory lock so concurrent instances apply them exactly once.

import type { Db } from "./pool.js";
import { hashPassword } from "../http/sessions.js";
import { inTransaction } from "./pool.js";
import { storeWallClockInstant } from "../../shared/storeTime.js";

const DDL = `
CREATE TABLE IF NOT EXISTS seed_state (id int PRIMARY KEY, seeded_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS schools (
  id text PRIMARY KEY, name text NOT NULL, delivery_weekday int NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS families (
  id text PRIMARY KEY, parent_name text NOT NULL, email text NOT NULL, phone text NOT NULL, address text NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  role text NOT NULL, family_id text REFERENCES families, school_id text REFERENCES schools);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users, created_at timestamptz NOT NULL);
CREATE SEQUENCE IF NOT EXISTS student_number START 7;
CREATE TABLE IF NOT EXISTS students (
  id text PRIMARY KEY, name text NOT NULL, grade int NOT NULL, school_id text NOT NULL REFERENCES schools,
  family_id text NOT NULL REFERENCES families, created_order bigserial);
CREATE TABLE IF NOT EXISTS instruments (
  serial text PRIMARY KEY, instrument_type text NOT NULL, size text NOT NULL, model text NOT NULL,
  retired boolean NOT NULL DEFAULT false);
CREATE SEQUENCE IF NOT EXISTS price_list_number START 2;
CREATE TABLE IF NOT EXISTS price_lists (
  id text PRIMARY KEY, effective_date date NOT NULL, created_at timestamptz NOT NULL, created_order bigserial,
  withdrawn_at timestamptz, tax_rate_bp int NOT NULL, items jsonb NOT NULL, tiers jsonb NOT NULL);
CREATE SEQUENCE IF NOT EXISTS contract_number START 1004;
CREATE TABLE IF NOT EXISTS contracts (
  id text PRIMARY KEY, student_id text NOT NULL REFERENCES students, instrument_serial text NOT NULL REFERENCES instruments,
  status text NOT NULL, waiver boolean NOT NULL, price_list_id text REFERENCES price_lists, delivery_date date NOT NULL,
  hold_expires_at timestamptz, signer_name text, signed_at timestamptz, activated_at timestamptz,
  closed_at timestamptz, billing_anchor_date date, predecessor_id text, successor_id text,
  subscription_state text, agreement_stored boolean NOT NULL DEFAULT false, seeded_agreement boolean NOT NULL DEFAULT false,
  bill_of_sale_stored boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL, created_order bigserial);
CREATE INDEX IF NOT EXISTS contracts_hold ON contracts (status, hold_expires_at);
CREATE INDEX IF NOT EXISTS contracts_student ON contracts (student_id);
CREATE INDEX IF NOT EXISTS contracts_serial ON contracts (instrument_serial);
CREATE TABLE IF NOT EXISTS contract_history (
  id bigserial PRIMARY KEY, contract_id text NOT NULL REFERENCES contracts, from_status text, to_status text NOT NULL,
  at timestamptz NOT NULL, actor text NOT NULL, actor_name text);
CREATE TABLE IF NOT EXISTS signing_links (
  token_hash text PRIMARY KEY, contract_id text NOT NULL REFERENCES contracts, sent_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, state text NOT NULL, sent_order bigserial);
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY, contract_id text NOT NULL REFERENCES contracts, amount_cents int NOT NULL,
  base_rent_cents int NOT NULL, waiver_cents int NOT NULL, tax_cents int NOT NULL, killbill_payment_id text NOT NULL,
  created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS reversals (
  id text PRIMARY KEY, payment_id text NOT NULL UNIQUE REFERENCES payments, contract_id text NOT NULL REFERENCES contracts,
  reason text NOT NULL, amount_cents int NOT NULL, base_rent_cents int NOT NULL, waiver_cents int NOT NULL,
  tax_cents int NOT NULL, killbill_refund_id text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY, contract_id text NOT NULL REFERENCES contracts, kind text NOT NULL, amount_cents int NOT NULL,
  transfer_id text, payment_id text, created_at timestamptz NOT NULL, created_order bigserial);
CREATE TABLE IF NOT EXISTS idempotent_responses (
  contract_id text NOT NULL, action text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status int NOT NULL,
  body text NOT NULL, PRIMARY KEY (contract_id, action, key));
CREATE TABLE IF NOT EXISTS condition_events (
  id text PRIMARY KEY, contract_id text NOT NULL REFERENCES contracts, kind text NOT NULL, notes text NOT NULL,
  recorded_by text NOT NULL, created_at timestamptz NOT NULL, created_order bigserial);
CREATE TABLE IF NOT EXISTS condition_photos (
  id text PRIMARY KEY, event_id text NOT NULL REFERENCES condition_events, contract_id text NOT NULL REFERENCES contracts,
  position int NOT NULL);
CREATE TABLE IF NOT EXISTS outbox_emails (
  id bigserial PRIMARY KEY, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
  queued_at timestamptz NOT NULL, sent_at timestamptz, attempts int NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox_emails (id) WHERE sent_at IS NULL;
`;

const SCHOOLS = [["larkspur", "Larkspur Middle School", 2], ["ferncliff", "Ferncliff Elementary", 4]] as const;

const FAMILIES = [
  ["F-01", "Robin Alder", "robin.alder@example.com", "555-0101", "14 Orchard Row", "family-alder-2026"],
  ["F-02", "Sam Brandt", "sam.brandt@example.com", "555-0102", "9 Mill Lane", "family-brandt-2026"],
  ["F-03", "Lee Castellanos", "lee.castellanos@example.com", "555-0103", "220 Quarry Road", "family-castellanos-2026"],
  ["F-04", "Avery Dunmore", "avery.dunmore@example.com", "555-0104", "3 Tannery Court", "family-dunmore-2026"],
] as const;

const STAFF = [
  ["U-owner", "Dana Whitlock", "owner@keelandbell.example", "brass-owner-2026", "owner", null],
  ["U-tech", "Ira Penhallow", "tech@keelandbell.example", "brass-tech-2026", "tech", null],
  ["U-larkspur", "Celia Marrow", "cmarrow@larkspur.example", "baton-larkspur-2026", "director", "larkspur"],
  ["U-ferncliff", "Tomás Ibarra", "tibarra@ferncliff.example", "baton-ferncliff-2026", "director", "ferncliff"],
] as const;

const STUDENTS = [
  ["S-01", "Juniper Alder", 7, "larkspur", "F-01"], ["S-02", "Theo Alder", 4, "ferncliff", "F-01"],
  ["S-03", "Mira Brandt", 6, "larkspur", "F-02"], ["S-04", "Nico Castellanos", 6, "larkspur", "F-03"],
  ["S-05", "Ezra Dunmore", 6, "larkspur", "F-04"], ["S-06", "Wren Dunmore", 4, "ferncliff", "F-04"],
] as const;

const FLEET = [
  ["KB-FL-0101", "flute", "full", "Corvin FL-200"], ["KB-FL-0102", "flute", "full", "Corvin FL-200"],
  ["KB-CL-0201", "clarinet", "full", "Corvin CL-300"], ["KB-CL-0202", "clarinet", "full", "Corvin CL-300"],
  ["KB-TR-0301", "trumpet", "full", "Harlow TR-150"], ["KB-TR-0302", "trumpet", "full", "Harlow TR-150"],
  ["KB-VN-0401", "violin", "1/4", "Ostwald VN-10"], ["KB-VN-0402", "violin", "1/2", "Ostwald VN-10"],
  ["KB-VN-0403", "violin", "1/2", "Ostwald VN-10"], ["KB-VN-0404", "violin", "3/4", "Ostwald VN-10"],
  ["KB-VN-0405", "violin", "4/4", "Ostwald VN-10"], ["KB-CE-0501", "cello", "1/2", "Ostwald CE-20"],
  ["KB-CE-0502", "cello", "1/2", "Ostwald CE-20"], ["KB-CE-0503", "cello", "3/4", "Ostwald CE-20"],
  ["KB-CE-0504", "cello", "4/4", "Ostwald CE-20"], ["KB-CE-0505", "cello", "1/4", "Ostwald CE-20"],
] as const;

const SEED_PRICE_LIST = {
  id: "PL-2024-01", effective_date: "2024-01-01", tax_rate_bp: 825,
  items: [
    { instrument_type: "flute", base_rent_cents: 2400, waiver_cents: 500, purchase_price_cents: 72000 },
    { instrument_type: "clarinet", base_rent_cents: 2400, waiver_cents: 500, purchase_price_cents: 72000 },
    { instrument_type: "trumpet", base_rent_cents: 2600, waiver_cents: 600, purchase_price_cents: 83200 },
    { instrument_type: "violin", base_rent_cents: 1800, waiver_cents: 400, purchase_price_cents: 54000 },
    { instrument_type: "cello", base_rent_cents: 4500, waiver_cents: 900, purchase_price_cents: 180000 },
  ],
  tiers: [
    { from_month: 0, to_month: 3, percent: 40, name: "Term 1" },
    { from_month: 4, to_month: 12, percent: 30, name: "Year 1" },
    { from_month: 13, to_month: null, percent: 20, name: "After" },
  ],
};

const CONTRACTS = [
  { id: "C-1001", student: "S-02", serial: "KB-VN-0401", waiver: true, signed: "2025-09-03", activated: "2025-09-04", equity: 16200 },
  { id: "C-1002", student: "S-03", serial: "KB-TR-0301", waiver: false, signed: "2025-08-28", activated: "2025-09-02", equity: 7800 },
  { id: "C-1003", student: "S-01", serial: "KB-CE-0502", waiver: true, signed: "2024-09-03", activated: "2024-09-03", equity: 67500 },
] as const;

async function seed(db: Db): Promise<void> {
  for (const [id, name, weekday] of SCHOOLS) {
    await db.query("INSERT INTO schools (id, name, delivery_weekday, position) VALUES ($1, $2, $3, $4)",
      [id, name, weekday, SCHOOLS.findIndex((s) => s[0] === id)]);
  }
  for (const [id, parentName, email, phone, address, password] of FAMILIES) {
    await db.query("INSERT INTO families (id, parent_name, email, phone, address) VALUES ($1, $2, $3, $4, $5)",
      [id, parentName, email, phone, address]);
    await db.query("INSERT INTO users (id, name, email, password_hash, role, family_id) VALUES ($1, $2, $3, $4, 'parent', $5)",
      [`U-${id}`, parentName, email, await hashPassword(password), id]);
  }
  for (const [id, name, email, password, role, school] of STAFF) {
    await db.query("INSERT INTO users (id, name, email, password_hash, role, school_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, name, email, await hashPassword(password), role, school]);
  }
  for (const [id, name, grade, school, family] of STUDENTS) {
    await db.query("INSERT INTO students (id, name, grade, school_id, family_id) VALUES ($1, $2, $3, $4, $5)",
      [id, name, grade, school, family]);
  }
  for (const [serial, type, size, model] of FLEET) {
    await db.query("INSERT INTO instruments (serial, instrument_type, size, model, retired) VALUES ($1, $2, $3, $4, $5)",
      [serial, type, size, model, serial === "KB-CE-0505"]);
  }
  const pl = SEED_PRICE_LIST;
  await db.query(`INSERT INTO price_lists (id, effective_date, created_at, tax_rate_bp, items, tiers)
    VALUES ($1, $2, $3, $4, $5, $6)`, [pl.id, pl.effective_date, storeWallClockInstant(pl.effective_date, 0, 0),
    pl.tax_rate_bp, JSON.stringify(pl.items), JSON.stringify(pl.tiers)]);
  for (const c of CONTRACTS) {
    const signedAt = storeWallClockInstant(c.signed, 12, 0);
    const activatedAt = storeWallClockInstant(c.activated, 12, 0);
    await db.query(`INSERT INTO contracts (id, student_id, instrument_serial, status, waiver, price_list_id,
        delivery_date, signer_name, signed_at, activated_at, billing_anchor_date, seeded_agreement, created_at)
      SELECT $1, $2, $3, 'active', $4, $5, $6, f.parent_name, $7, $8, $6, true, $7
      FROM students s JOIN families f ON f.id = s.family_id WHERE s.id = $2`,
    [c.id, c.student, c.serial, c.waiver, pl.id, c.activated, signedAt, activatedAt]);
    await db.query(`INSERT INTO contract_history (contract_id, from_status, to_status, at, actor, actor_name)
      VALUES ($1, NULL, 'active', $2, 'owner', NULL)`, [c.id, activatedAt]);
    await db.query(`INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, created_at)
      VALUES ($1, $2, 'opening', $3, $4)`, [`L-${c.id}-opening`, c.id, c.equity, activatedAt]);
  }
}

/** Ensures the schema and, in a database never seeded before, the seed. Safe to run from many instances at once. */
export async function ensureSchemaAndSeed(db: Db, seededAt: Date): Promise<void> {
  await inTransaction(db, async () => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('bellroll:schema', 0))");
    await db.query(DDL);
    const seeded = await db.query("SELECT 1 FROM seed_state WHERE id = 1");
    if (seeded.rowCount === 0) {
      await seed(db);
      await db.query("INSERT INTO seed_state (id, seeded_at) VALUES (1, $1)", [seededAt]);
    }
  });
}
