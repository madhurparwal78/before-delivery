// PostgreSQL: the pool, transactions, the schema and the seed, applied idempotently at every start.
import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';
import { addDays, torontoDate, torontoInstant } from '../shared/toronto.js';

pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on('error', () => undefined);

export type Db = pg.PoolClient;

export async function tx<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

/** Takes the next gap-free number of a series inside the committing transaction. */
export async function nextNumber(db: Db, series: 'RF' | 'CR' | 'CT' | 'NT' | 'SC'): Promise<string> {
  const row = (await db.query<{ value: number }>('UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value', [series])).rows[0];
  return `${series}-${String(row?.value).padStart(6, '0')}`;
}

/** Order and subscription numbers come from sequences: taken before Kill Bill, never reused, gaps allowed. */
export async function takeSequenceNumber(prefix: 'PDL' | 'SUB'): Promise<string> {
  const sequence = prefix === 'PDL' ? 'order_number_seq' : 'subscription_number_seq';
  const row = (await pool.query<{ value: number }>(`SELECT nextval('${sequence}') AS value`)).rows[0];
  return `${prefix}-${String(row?.value).padStart(6, '0')}`;
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value integer NOT NULL);
CREATE SEQUENCE IF NOT EXISTS order_number_seq;
CREATE SEQUENCE IF NOT EXISTS subscription_number_seq;
CREATE SEQUENCE IF NOT EXISTS batch_code_seq START 412;
CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY CHECK (id = 1),
  packing_cutoff_local text NOT NULL,
  seeded_on date NOT NULL
);
CREATE TABLE IF NOT EXISTS staff (
  id serial PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('maker','finance','packing')), password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS batches (
  code text PRIMARY KEY, scent text NOT NULL, poured_on date NOT NULL, cure_days integer NOT NULL,
  state text NOT NULL, drop_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY, cart_id text NOT NULL, batch_code text NOT NULL REFERENCES batches(code), bar integer NOT NULL,
  status text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_batch ON holds (batch_code, status);
CREATE INDEX IF NOT EXISTS holds_cart ON holds (cart_id, status);
CREATE TABLE IF NOT EXISTS movements (
  id serial PRIMARY KEY, batch_code text NOT NULL REFERENCES batches(code), kind text NOT NULL,
  bars integer[] NOT NULL, ref text, at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_batch ON movements (batch_code, id);
CREATE TABLE IF NOT EXISTS customers (
  id serial PRIMARY KEY, email text UNIQUE NOT NULL, locale text NOT NULL, kb_account_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stepup_codes (
  number text PRIMARY KEY, email text NOT NULL, code text NOT NULL, created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX IF NOT EXISTS stepup_codes_email ON stepup_codes (email, created_at);
CREATE TABLE IF NOT EXISTS stepup_failures (
  email text PRIMARY KEY, failures integer NOT NULL, locked_until timestamptz
);
CREATE TABLE IF NOT EXISTS orders (
  number text PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id), status text NOT NULL,
  fulfilment text NOT NULL, placed_at timestamptz NOT NULL, ship_on date NOT NULL, locale text NOT NULL,
  email text NOT NULL, shipping jsonb NOT NULL, subtotal_cents integer NOT NULL, shipping_cents integer NOT NULL,
  taxes jsonb NOT NULL, total_cents integer NOT NULL, version integer NOT NULL,
  kb_invoice_id text NOT NULL, kb_payment_id text NOT NULL, kb_items jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders (customer_id);
CREATE TABLE IF NOT EXISTS order_lines (
  order_number text NOT NULL REFERENCES orders(number), batch_code text NOT NULL, bar integer NOT NULL,
  unit_cents integer NOT NULL, PRIMARY KEY (order_number, batch_code, bar)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  number text PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id), state text NOT NULL,
  scent text NOT NULL, cadence text NOT NULL, pending_cadence text, started_on date NOT NULL,
  anchor_date date NOT NULL, next_bill_date date, skipped_bill_date date, paused_from date,
  shipping jsonb NOT NULL, locale text NOT NULL, version integer NOT NULL, kb_subscription_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_trio_per_customer ON subscriptions (customer_id) WHERE state IN ('active','paused');
CREATE TABLE IF NOT EXISTS subscription_charges (
  payment_key text PRIMARY KEY, subscription text NOT NULL REFERENCES subscriptions(number),
  bill_date date NOT NULL, kb_invoice_id text NOT NULL, kb_payment_id text, total_cents integer NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  number text PRIMARY KEY, order_number text NOT NULL REFERENCES orders(number), status text NOT NULL,
  bars jsonb NOT NULL, restock boolean NOT NULL, amount_cents integer NOT NULL, allocation jsonb NOT NULL,
  reason text NOT NULL, killbill_ref text, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS credits (
  number text PRIMARY KEY, target text NOT NULL, customer_id integer NOT NULL REFERENCES customers(id),
  status text NOT NULL, amount_cents integer NOT NULL, reason text NOT NULL, killbill_ref text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id serial PRIMARY KEY, at timestamptz NOT NULL, actor text NOT NULL, role text NOT NULL, action text NOT NULL,
  target text NOT NULL, reason text NOT NULL, amount_cents integer NOT NULL, killbill_ref text, outcome text NOT NULL
);
CREATE OR REPLACE FUNCTION audit_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit entries are append-only'; END $$;
DROP TRIGGER IF EXISTS audit_append_only ON audit;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();
DROP TRIGGER IF EXISTS audit_no_truncate ON audit;
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit FOR EACH STATEMENT EXECUTE FUNCTION audit_is_append_only();
CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL, key text NOT NULL, request_hash text NOT NULL, status integer, body text,
  created_at timestamptz NOT NULL, PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS notices (
  number text PRIMARY KEY, key text UNIQUE NOT NULL, kind text NOT NULL, recipient text NOT NULL,
  locale text NOT NULL, subject text NOT NULL, public_subject text NOT NULL, body text NOT NULL,
  status text NOT NULL, enqueued_at timestamptz NOT NULL, next_attempt_at timestamptz NOT NULL,
  attempts jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS notices_due ON notices (status, enqueued_at, number);
CREATE TABLE IF NOT EXISTS contacts (
  number text PRIMARY KEY, name text NOT NULL, email text NOT NULL, topic text NOT NULL, message text NOT NULL,
  locale text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS reconciliation_snapshots (
  month text PRIMARY KEY, checked_at timestamptz NOT NULL, lines jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS reconciliation_accepts (
  id serial PRIMARY KEY, key text NOT NULL, delta_cents integer NOT NULL, at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS orphan_refunds (
  payment_id text PRIMARY KEY, amount_cents integer NOT NULL, killbill_ref text, at timestamptz NOT NULL
);
`;

const STAFF = [
  { name: 'Odile Arsenault', email: 'maker@paindelune.example', password: 'lune-maker-2026', role: 'maker' },
  { name: 'Samir Boucher', email: 'finance@paindelune.example', password: 'lune-finance-2026', role: 'finance' },
  { name: 'Jade Poirier', email: 'packing@paindelune.example', password: 'lune-packing-2026', role: 'packing' },
];

async function seed(db: Db): Promise<void> {
  await db.query(
    `INSERT INTO counters (name, value) VALUES ('RF',0),('CR',0),('CT',0),('NT',0),('SC',0) ON CONFLICT DO NOTHING`,
  );
  const seedDay = torontoDate(new Date());
  await db.query(`INSERT INTO settings (id, packing_cutoff_local, seeded_on) VALUES (1, '14:00', $1) ON CONFLICT DO NOTHING`, [seedDay]);
  const staffCount = (await db.query<{ n: number }>('SELECT count(*) AS n FROM staff')).rows[0];
  if (staffCount?.n === 0) {
    for (const s of STAFF) {
      await db.query('INSERT INTO staff (email, name, role, password_hash) VALUES ($1,$2,$3,$4)', [s.email, s.name, s.role, hashPassword(s.password)]);
    }
  }
  const batchCount = (await db.query<{ n: number }>('SELECT count(*) AS n FROM batches')).rows[0];
  if (batchCount?.n === 0) {
    const day = ((await db.query<{ seeded_on: string }>('SELECT seeded_on FROM settings WHERE id = 1')).rows[0])?.seeded_on ?? seedDay;
    const atTen = (date: string) => torontoInstant(date, 10, 0);
    const seeded = [
      { code: 'B-0412', scent: 'lavender-oat', poured: addDays(day, -35), bars: 12, state: 'live', drop: atTen(addDays(day, -1)) },
      { code: 'B-0413', scent: 'smoked-birch', poured: addDays(day, -30), bars: 10, state: 'scheduled', drop: atTen(addDays(day, 7)) },
      { code: 'B-0414', scent: 'wild-mint', poured: addDays(day, -3), bars: 14, state: 'curing', drop: null },
    ];
    const cureDays: Record<string, number> = { 'B-0412': 28, 'B-0413': 28, 'B-0414': 35 };
    for (const b of seeded) {
      await db.query(
        'INSERT INTO batches (code, scent, poured_on, cure_days, state, drop_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [b.code, b.scent, b.poured, cureDays[b.code], b.state, b.drop],
      );
      await db.query(`INSERT INTO movements (batch_code, kind, bars, ref, at) VALUES ($1, 'cut', $2, NULL, now())`, [
        b.code,
        Array.from({ length: b.bars }, (_, i) => i + 1),
      ]);
    }
    await db.query("SELECT setval('batch_code_seq', 414)");
  }
}

/** Waits for PostgreSQL (retrying every 2 s), then applies schema and seed under one advisory lock. */
export async function migrate(): Promise<void> {
  for (;;) {
    try {
      await tx(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(7340001)');
        await db.query(SCHEMA);
        await seed(db);
      });
      return;
    } catch (error) {
      console.error(`database not ready: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
