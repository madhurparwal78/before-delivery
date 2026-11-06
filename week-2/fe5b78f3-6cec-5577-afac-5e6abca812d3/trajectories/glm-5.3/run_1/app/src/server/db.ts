import pg from 'pg';
import type { PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { STATIONS, TRAINS } from '../seed.js';
import { ClassCode } from '../types.js';

// Postgres is the system of record. Schema and seed are applied idempotently on start.

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  } finally {
    c.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trains (
  number text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS train_stops (
  train text NOT NULL REFERENCES trains(number),
  idx int NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  km int NOT NULL,
  dep_hhmm text NOT NULL,
  plus_day boolean NOT NULL,
  rl boolean NOT NULL,
  PRIMARY KEY (train, idx)
);
CREATE TABLE IF NOT EXISTS coaches (
  train text NOT NULL REFERENCES trains(number),
  coach text NOT NULL,
  cls text NOT NULL,
  PRIMARY KEY (train, coach)
);
CREATE TABLE IF NOT EXISTS bookings (
  pnr text PRIMARY KEY,
  version int NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  train text NOT NULL REFERENCES trains(number),
  run_date date NOT NULL,
  from_code text NOT NULL,
  to_code text NOT NULL,
  from_idx int NOT NULL,
  to_idx int NOT NULL,
  cls text NOT NULL,
  quota text NOT NULL,
  keep_in_one_coach boolean NOT NULL,
  lower_berth_only boolean NOT NULL,
  contact_phone text NOT NULL,
  total_paise bigint NOT NULL,
  fare_lines jsonb NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS passengers (
  pnr text NOT NULL REFERENCES bookings(pnr) ON DELETE CASCADE,
  number int NOT NULL,
  name text NOT NULL,
  age int NOT NULL,
  gender text NOT NULL,
  berth_preference text NOT NULL,
  fare_paise bigint NOT NULL,
  status text NOT NULL,
  wl_type text,
  wl_num int,
  rac_place int,
  coach text,
  berth int,
  berth_type text,
  from_idx int NOT NULL,
  to_idx int NOT NULL,
  seq bigint NOT NULL,
  PRIMARY KEY (pnr, number)
);
CREATE TABLE IF NOT EXISTS passenger_history (
  pnr text NOT NULL,
  passenger int NOT NULL,
  at timestamptz NOT NULL,
  from_label text NOT NULL,
  to_label text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_pnr ON passenger_history(pnr, passenger);
CREATE TABLE IF NOT EXISTS holds (
  id bigserial PRIMARY KEY,
  train text NOT NULL,
  run_date date NOT NULL,
  coach text NOT NULL,
  berth int NOT NULL,
  place smallint NOT NULL, -- 0 for a confirmed berth, 1 or 2 for an RAC place
  pnr text NOT NULL,
  passenger int NOT NULL,
  from_idx int NOT NULL,
  to_idx int NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holds_run ON holds(train, run_date, coach, berth);
CREATE TABLE IF NOT EXISTS chart_done (
  train text NOT NULL,
  run_date date NOT NULL,
  chart_at timestamptz NOT NULL,
  done_at timestamptz NOT NULL,
  PRIMARY KEY (train, run_date)
);
CREATE TABLE IF NOT EXISTS cancellations (
  pnr text NOT NULL,
  number int NOT NULL,
  requested_at timestamptz NOT NULL,
  refund_paise bigint NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (pnr, number)
);
CREATE TABLE IF NOT EXISTS cancellation_passengers (
  pnr text NOT NULL,
  cancellation int NOT NULL,
  number int NOT NULL,
  band text NOT NULL,
  charge_paise bigint NOT NULL,
  gst_paise bigint NOT NULL,
  deduction_paise bigint NOT NULL,
  refund_paise bigint NOT NULL,
  PRIMARY KEY (pnr, cancellation, number)
);
CREATE TABLE IF NOT EXISTS refunds (
  pnr text NOT NULL,
  number int NOT NULL,
  reason text NOT NULL,
  refund_paise bigint NOT NULL,
  status text NOT NULL,
  issued_at timestamptz,
  PRIMARY KEY (pnr, number)
);
CREATE TABLE IF NOT EXISTS tickets (
  pnr text NOT NULL,
  version int NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL,
  stored boolean NOT NULL DEFAULT false,
  etag text,
  PRIMARY KEY (pnr, version)
);
CREATE TABLE IF NOT EXISTS idempotency (
  account_id uuid NOT NULL,
  key text NOT NULL,
  body_sha text NOT NULL,
  state text NOT NULL,
  status int,
  response_body text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);
CREATE SEQUENCE IF NOT EXISTS passenger_seq;
CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
`;

export async function applySchemaAndSeed(): Promise<void> {
  await withClient(async (c) => {
    await c.query(SCHEMA);
    void STATIONS;
    for (const t of TRAINS) {
      await c.query(
        'INSERT INTO trains (number, name) VALUES ($1,$2) ON CONFLICT (number) DO UPDATE SET name = EXCLUDED.name',
        [t.number, t.name],
      );
      for (const [i, st] of t.stops.entries()) {
        await c.query(
          `INSERT INTO train_stops (train, idx, code, name, km, dep_hhmm, plus_day, rl)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (train, idx) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name,
             km = EXCLUDED.km, dep_hhmm = EXCLUDED.dep_hhmm, plus_day = EXCLUDED.plus_day, rl = EXCLUDED.rl`,
          [t.number, i, st.code, st.name, st.km, st.time.replace('+1', ''), st.time.endsWith('+1'), st.rl],
        );
      }
      for (const co of t.coaches) {
        await c.query(
          `INSERT INTO coaches (train, coach, cls) VALUES ($1,$2,$3)
           ON CONFLICT (train, coach) DO UPDATE SET cls = EXCLUDED.cls`,
          [t.number, co.code, co.cls],
        );
      }
    }
    // seeded travellers
    const seeds: [string, string, string, string][] = [
      ['Meera Iyer', 'meera.iyer@example.test', '+919800000001', 'chart-paper-01'],
      ['Rohan Bhat', 'rohan.bhat@example.test', '+919800000002', 'chart-paper-02'],
    ];
    for (const [name, email, phone, pw] of seeds) {
      await c.query(
        `INSERT INTO accounts (id, name, email, phone, password_hash)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
        [randomUUID(), name, email, phone, hashPassword(pw)],
      );
    }
  });
}

const PW_SALT = 'pakka-static-salt-v1';

export function hashPassword(pw: string): string {
  return createHash('sha256').update(PW_SALT + ':' + pw).digest('hex') + ':' + PW_SALT;
}

export function verifyPassword(pw: string, hash: string): boolean {
  const [digest, salt] = hash.split(':');
  return createHash('sha256').update(salt + ':' + pw).digest('hex') === digest;
}

/** Advisory lock for a run and class, so one booking at a time re-shapes inventory. */
export async function lockRun(c: PoolClient, train: string, runDate: string, cls: ClassCode): Promise<void> {
  const h = createHash('md5').update(`${train}|${runDate}|${cls}`).digest('hex').slice(0, 14);
  await c.query(`SELECT pg_advisory_xact_lock(('x' || '${h}')::bit(52)::bigint)`);
}
