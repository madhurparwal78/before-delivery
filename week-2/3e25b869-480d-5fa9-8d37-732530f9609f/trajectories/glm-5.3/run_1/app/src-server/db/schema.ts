// PostgreSQL schema and seed data, applied idempotently on every start.
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { addDays, torontoDate } from "../core/toronto.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  locale text NOT NULL DEFAULT 'en-CA',
  killbill_account_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
  code text PRIMARY KEY,
  scent text NOT NULL,
  state text NOT NULL,
  poured_on date NOT NULL,
  cure_days int NOT NULL,
  bars_cut int NOT NULL DEFAULT 0,
  drop_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id bigserial PRIMARY KEY,
  batch_code text NOT NULL,
  kind text NOT NULL,
  bars int[] NOT NULL,
  ref text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carts (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY,
  cart_id uuid NOT NULL,
  batch_code text NOT NULL,
  bar int NOT NULL,
  status text NOT NULL,
  amount_cents int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL,
  status text NOT NULL,
  fulfilment text NOT NULL,
  placed_at timestamptz NOT NULL,
  ship_on date NOT NULL,
  locale text NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  line1 text NOT NULL,
  city text NOT NULL,
  province text NOT NULL,
  postal_code text NOT NULL,
  subtotal_cents int NOT NULL,
  shipping_cents int NOT NULL,
  taxes jsonb NOT NULL,
  total_cents int NOT NULL,
  refunded_cents int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 1,
  killbill_invoice_id text,
  killbill_payment_id text,
  kb_shipping_item_id text,
  kb_tax_items jsonb
);

CREATE TABLE IF NOT EXISTS order_lines (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL,
  batch_code text NOT NULL,
  scent text NOT NULL,
  bar int NOT NULL,
  unit_cents int NOT NULL,
  refunded boolean NOT NULL DEFAULT false,
  kb_invoice_item_id text
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL,
  state text NOT NULL,
  scent text NOT NULL,
  cadence text NOT NULL,
  pending_cadence text,
  anchor_date date NOT NULL,
  started_on date NOT NULL,
  next_bill_date date,
  skipped_bill_date date,
  paused_from date,
  name text NOT NULL,
  line1 text NOT NULL,
  city text NOT NULL,
  province text NOT NULL,
  postal_code text NOT NULL,
  version int NOT NULL DEFAULT 1,
  killbill_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  order_id bigint NOT NULL,
  status text NOT NULL,
  bars jsonb NOT NULL,
  restock boolean NOT NULL,
  amount_cents int NOT NULL,
  allocation jsonb NOT NULL,
  reason text NOT NULL,
  killbill_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credits (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  target text NOT NULL,
  customer_id bigint NOT NULL,
  status text NOT NULL,
  amount_cents int NOT NULL,
  reason text NOT NULL,
  killbill_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  role text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  reason text NOT NULL,
  amount jsonb NOT NULL,
  killbill_ref text,
  outcome text NOT NULL
);

CREATE TABLE IF NOT EXISTS stepup_codes (
  id bigserial PRIMARY KEY,
  sc_number text NOT NULL,
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stepup_requests (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stepup_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stepup_locks (
  email text PRIMARY KEY,
  until timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  customer_id bigint,
  staff_id bigint,
  kind text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status int NOT NULL,
  body text,
  in_progress boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, key)
);

CREATE TABLE IF NOT EXISTS notices (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  key text NOT NULL UNIQUE,
  kind text NOT NULL,
  to_email text NOT NULL,
  locale text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  attempts jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS contacts (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  topic text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reconciliation_snapshots (
  id bigserial PRIMARY KEY,
  month text NOT NULL,
  lines jsonb NOT NULL,
  totals jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reconciliation_accepts (
  id bigserial PRIMARY KEY,
  month text NOT NULL,
  line_key text NOT NULL,
  shop_cents int NOT NULL,
  killbill_cents int NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value bigint NOT NULL
);
`;

const COUNTERS = ["order", "subscription", "refund", "credit", "contact", "notice", "sc", "batch"] as const;

const STAFF_SEED = [
  { email: "maker@paindelune.example", name: "Odile Arsenault", password: "lune-maker-2026", role: "maker" },
  { email: "finance@paindelune.example", name: "Samir Boucher", password: "lune-finance-2026", role: "finance" },
  { email: "packing@paindelune.example", name: "Jade Poirier", password: "lune-packing-2026", role: "packing" }
];

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 20 });
}

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
  await seed(pool);
}

async function seed(pool: Pool): Promise<void> {
  // Counters start at zero; numbers are taken as value + 1.
  for (const name of COUNTERS) {
    await pool.query(
      "INSERT INTO counters (name, value) VALUES ($1, 0) ON CONFLICT (name) DO NOTHING",
      [name]
    );
  }

  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('packing_cutoff_local', '14:00') ON CONFLICT (key) DO NOTHING"
  );

  const staffCount = await pool.query("SELECT count(*)::int AS n FROM staff");
  if (staffCount.rows[0].n === 0) {
    for (const member of STAFF_SEED) {
      await pool.query(
        "INSERT INTO staff (email, name, password_hash, role) VALUES ($1, $2, $3, $4)",
        [member.email, member.name, hashPassword(member.password), member.role]
      );
    }
  }

  const batchCount = await pool.query("SELECT count(*)::int AS n FROM batches");
  if (batchCount.rows[0].n === 0) {
    const seedDay = torontoDate(new Date());
    const drop1 = torontoInstant(addDays(seedDay, -1), "10:00");
    const drop2 = torontoInstant(addDays(seedDay, 7), "10:00");
    await pool.query(
      `INSERT INTO batches (code, scent, state, poured_on, cure_days, bars_cut, drop_at) VALUES
       ($1, $2, 'live', $3, 28, 12, $4),
       ($5, $6, 'scheduled', $7, 28, 10, $8),
       ($9, $10, 'curing', $11, 35, 14, NULL)`,
      [
        "B-0412", "lavender-oat", addDays(seedDay, -35), drop1,
        "B-0413", "smoked-birch", addDays(seedDay, -30), drop2,
        "B-0414", "wild-mint", addDays(seedDay, -3)
      ]
    );
    await pool.query(
      `INSERT INTO stock_movements (batch_code, kind, bars, ref)
       VALUES ('B-0412', 'cut', $1, NULL), ('B-0413', 'cut', $2, NULL), ('B-0414', 'cut', $3, NULL)`,
      [barNumbers(12), barNumbers(10), barNumbers(14)]
    );
    await pool.query("UPDATE counters SET value = 414 WHERE name = 'batch'");
  }
}

function barNumbers(cut: number): number[] {
  return Array.from({ length: cut }, (_, i) => i + 1);
}

function torontoInstant(date: string, hhmm: string): Date {
  // Import cycle avoided by using a tiny local reimplementation via Intl.
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const base = new Date(`${date}T${hhmm}:00Z`).getTime();
  for (const guess of [base - 5 * 3600000, base - 4 * 3600000]) {
    const offset = torontoOffset(dtf, new Date(guess));
    const inst = new Date(base - offset * 60000);
    const parts = dtf.formatToParts(inst);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = hhmm.split(":").map(Number);
    if (Number(get("year")) === y && Number(get("month")) === m && Number(get("day")) === d &&
        Number(get("hour")) === hh && Number(get("minute")) === mm) {
      return inst;
    }
  }
  return new Date(base - 5 * 3600000);
}

function torontoOffset(dtf: Intl.DateTimeFormat, instant: Date): number {
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asLocal - instant.getTime()) / 60000);
}


const STAFF_PEPPER = "loafline-staff-pepper";

/** Password hashing for staff sign-in. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = createHash("sha256").update(salt + password + STAFF_PEPPER).digest("hex");
  return `${salt}:${digest}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const check = createHash("sha256").update(salt + password + STAFF_PEPPER).digest("hex");
  return check === digest;
}

/** Take the next number from a counter, returning its full formatted number. */
export async function takeNumber(client: PoolClient, counter: string, prefix: string, width: number): Promise<string> {
  const res = await client.query(
    "UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value",
    [counter]
  );
  const value = res.rows[0].value as number;
  return `${prefix}${String(value).padStart(width, "0")}`;
}

