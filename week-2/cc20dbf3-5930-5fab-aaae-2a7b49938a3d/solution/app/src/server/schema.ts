// Schema and seed rows, created idempotently on every start under one advisory lock so that several
// copies of the server can start against an empty database at once.

import { randomBytes } from "node:crypto";
import { pool } from "./db.js";
import { hashPassword } from "./domain/sessions.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_secret (
  name text PRIMARY KEY,
  value text NOT NULL
);
CREATE TABLE IF NOT EXISTS library (
  id int PRIMARY KEY CHECK (id = 1),
  name text NOT NULL,
  time_zone text NOT NULL,
  open_days text[] NOT NULL,
  opening_time text NOT NULL,
  closing_time text NOT NULL,
  max_active_per_member int NOT NULL
);
CREATE TABLE IF NOT EXISTS closure_date (day date PRIMARY KEY);
CREATE TABLE IF NOT EXISTS late_fee_rate (
  effective_from date PRIMARY KEY,
  cents_per_day int NOT NULL CHECK (cents_per_day >= 0)
);
CREATE TABLE IF NOT EXISTS person (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('member', 'volunteer', 'founder')),
  email text NOT NULL UNIQUE,
  phone text NOT NULL,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS item (
  id text PRIMARY KEY,
  position int NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  deposit_cents int NOT NULL CHECK (deposit_cents >= 0),
  replacement_cents int NOT NULL CHECK (replacement_cents >= 0)
);
CREATE TABLE IF NOT EXISTS unit (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES item(id),
  label text NOT NULL,
  lane_index int NOT NULL,
  UNIQUE (item_id, lane_index)
);
CREATE TABLE IF NOT EXISTS session (
  token_hash text PRIMARY KEY,
  person_id text NOT NULL REFERENCES person(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS hold (
  id uuid PRIMARY KEY,
  member_id text NOT NULL REFERENCES person(id),
  item_id text NOT NULL REFERENCES item(id),
  unit_id text NOT NULL REFERENCES unit(id),
  status text NOT NULL CHECK (status IN ('requested', 'ready', 'collected', 'expired', 'cancelled')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  ready_at timestamptz,
  pickup_deadline timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS hold_page ON hold (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS hold_active ON hold (item_id) WHERE status IN ('requested', 'ready');
CREATE TABLE IF NOT EXISTS loan (
  id uuid PRIMARY KEY,
  member_id text NOT NULL REFERENCES person(id),
  item_id text NOT NULL REFERENCES item(id),
  unit_id text NOT NULL REFERENCES unit(id),
  hold_id uuid UNIQUE REFERENCES hold(id),
  status text NOT NULL CHECK (status IN ('out', 'returned', 'inspected', 'settled')),
  checked_out_at timestamptz NOT NULL,
  due_date date NOT NULL,
  due_at timestamptz NOT NULL,
  renewed_at timestamptz,
  returned_at timestamptz,
  on_time boolean,
  late_days int,
  deposit_cents int NOT NULL,
  replacement_cents int NOT NULL,
  inspection_outcome text CHECK (inspection_outcome IN ('ok', 'damaged')),
  inspection_note text,
  inspected_at timestamptz,
  fixed_damage_cents int
);
CREATE INDEX IF NOT EXISTS loan_page ON loan (checked_out_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS loan_out ON loan (item_id) WHERE status = 'out';
CREATE TABLE IF NOT EXISTS settlement (
  loan_id uuid PRIMARY KEY REFERENCES loan(id),
  deposit_cents int NOT NULL,
  released_cents int NOT NULL,
  damage_cents int NOT NULL,
  damage_from_deposit_cents int NOT NULL,
  extra_damage_cents int NOT NULL,
  late_days int NOT NULL,
  late_fee_cents int NOT NULL,
  total_charged_cents int NOT NULL,
  settled_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS photo (
  id uuid PRIMARY KEY,
  loan_id uuid NOT NULL REFERENCES loan(id),
  stage text NOT NULL CHECK (stage IN ('checkout', 'return')),
  content_type text NOT NULL,
  size_bytes int NOT NULL,
  object_key text NOT NULL UNIQUE,
  seq bigserial NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_loan ON photo (loan_id, seq);
CREATE TABLE IF NOT EXISTS ledger_entry (
  id uuid PRIMARY KEY,
  loan_id uuid NOT NULL REFERENCES loan(id),
  kind text NOT NULL CHECK (kind IN ('deposit_hold', 'deposit_release', 'damage_charge', 'extra_damage', 'late_fee')),
  amount_cents int NOT NULL,
  created_at timestamptz NOT NULL,
  seq bigserial NOT NULL,
  UNIQUE (loan_id, kind)
);
CREATE TABLE IF NOT EXISTS idempotency_key (
  caller_id text NOT NULL REFERENCES person(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'done')),
  status_code int,
  body text,
  started_at timestamptz NOT NULL,
  PRIMARY KEY (caller_id, key)
);
CREATE TABLE IF NOT EXISTS due_reminder (
  loan_id uuid NOT NULL REFERENCES loan(id),
  due_at timestamptz NOT NULL,
  PRIMARY KEY (loan_id, due_at)
);
CREATE TABLE IF NOT EXISTS outbox_email (
  id uuid PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox_email (created_at) WHERE sent_at IS NULL;
`;

const SEED_PASSWORD = "pegboard-2026";

const PEOPLE = [
  ["usr-rosa", "Rosa Lindqvist", "founder", "rosa@commonshed.example", "555-0100"],
  ["usr-dev", "Dev Okafor", "volunteer", "dev@commonshed.example", "555-0101"],
  ["usr-ines", "Ines Marchetti", "volunteer", "ines@commonshed.example", "555-0102"],
  ["mem-hal", "Hal Brennan", "member", "hal@members.example", "555-0141"],
  ["mem-mina", "Mina Castellanos", "member", "mina@members.example", "555-0142"],
  ["mem-tobi", "Tobi Adeyemi", "member", "tobi@members.example", "555-0143"],
  ["mem-wren", "Wren Kowalski", "member", "wren@members.example", "555-0144"],
  ["mem-sol", "Sol Navarro", "member", "sol@members.example", "555-0145"],
  ["mem-juno", "Juno Achterberg", "member", "juno@members.example", "555-0146"],
] as const;

const ITEMS = [
  ["tile-saw", "7-inch wet tile saw", "Masonry", ["TS-1", "TS-2"], 5000, 18900],
  ["pressure-washer", "Electric pressure washer", "Cleaning", ["PW-1", "PW-2", "PW-3"], 4000, 24900],
  ["carpet-cleaner", "Carpet cleaner", "Cleaning", ["CC-1", "CC-2"], 6000, 32900],
  ["floor-sander", "Orbital floor sander", "Power tools", ["FS-1", "FS-2"], 7500, 89900],
  ["laser-level", "Self-levelling laser", "Measuring", ["LL-1"], 2500, 13900],
  ["ext-ladder", "24-foot extension ladder", "Ladders", ["LD-1"], 0, 21900],
  ["drill-driver", "Cordless drill driver", "Power tools", ["DR-1", "DR-2", "DR-3", "DR-4"], 0, 12900],
  ["hedge-trimmer", "Hedge trimmer", "Garden", ["HT-1", "HT-2"], 0, 9900],
  ["post-hole-digger", "Post hole digger", "Garden", ["PH-1"], 0, 4500],
  ["stud-finder", "Stud finder", "Hand tools", ["SF-1", "SF-2"], 0, 2499],
] as const;

const CLOSURE_DATES = ["2026-07-04", "2026-11-26", "2026-12-25", "2026-12-26"];
const LATE_FEE_SCHEDULE = [
  ["2026-01-06", 50],
  ["2026-09-01", 100],
] as const;

export async function migrateAndSeed(): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(hashtext('shedline:schema'))");
    await db.query(SCHEMA);
    await db.query("BEGIN");
    await db.query(
      `INSERT INTO library (id, name, time_zone, open_days, opening_time, closing_time, max_active_per_member)
       VALUES (1, 'Common Shed — Eastgate', 'America/New_York', $1, '10:00', '18:00', 4)
       ON CONFLICT (id) DO NOTHING`,
      [["tue", "wed", "thu", "fri", "sat", "sun"]],
    );
    await db.query("INSERT INTO closure_date (day) SELECT unnest($1::date[]) ON CONFLICT DO NOTHING", [CLOSURE_DATES]);
    for (const [from, cents] of LATE_FEE_SCHEDULE) {
      await db.query("INSERT INTO late_fee_rate (effective_from, cents_per_day) VALUES ($1, $2) ON CONFLICT DO NOTHING", [from, cents]);
    }
    const seeded = await db.query<{ id: string }>("SELECT id FROM person");
    const present = new Set(seeded.rows.map((row) => row.id));
    for (const [id, name, role, email, phone] of PEOPLE) {
      if (present.has(id)) continue;
      await db.query(
        "INSERT INTO person (id, name, role, email, phone, password_hash) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
        [id, name, role, email, phone, await hashPassword(SEED_PASSWORD)],
      );
    }
    for (const [position, [id, name, category, labels, deposit, replacement]] of ITEMS.entries()) {
      await db.query(
        `INSERT INTO item (id, position, name, category, deposit_cents, replacement_cents)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [id, position, name, category, deposit, replacement],
      );
      for (const [lane, label] of labels.entries()) {
        await db.query("INSERT INTO unit (id, item_id, label, lane_index) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [
          `${id}-${lane + 1}`,
          id,
          label,
          lane,
        ]);
      }
    }
    await db.query("INSERT INTO app_secret (name, value) VALUES ('signing', $1) ON CONFLICT DO NOTHING", [
      randomBytes(32).toString("base64url"),
    ]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtext('shedline:schema'))");
    db.release();
  }
}
