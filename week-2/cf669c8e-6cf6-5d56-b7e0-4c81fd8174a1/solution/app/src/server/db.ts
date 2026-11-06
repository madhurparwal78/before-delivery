/** PostgreSQL: pool, transactions, idempotent schema and seed, and the readiness the data routes depend on. */
import { randomBytes, scrypt } from 'node:crypto';
import pg from 'pg';
import { CATALOGUE_SCHEMA, loadCatalogue, seedCatalogue } from './catalogue.js';
import { addDays, amsterdamToday, localInstants, weekday } from './clock.js';
import { config, databaseParts } from './config.js';
import { HttpError, isRecord } from './errors.js';
import { SEED_USERS } from './seed-data.js';

/** Stretch a password; every use of a stored hash goes through this one function. */
export function scrypted(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => { if (error) reject(error); else resolve(key); });
  });
}

pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));
pg.types.setTypeParser(1700, (value: string) => Number(value));

export type Db = pg.Pool | pg.PoolClient;

// Several instances share one server's connection limit: the pool stays small and gives idle connections back.
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
pool.on('error', () => undefined);

let ready = false;
let migrating: Promise<void> | null = null;
let firstAttempt: Promise<void> = Promise.resolve();

export function isReady(): boolean {
  return ready;
}

/** A request during a connection's first attempt waits for its outcome; a database that has refused answers 503 at once. */
export async function requireDatabase(): Promise<void> {
  await firstAttempt;
  if (!ready) throw new HttpError(503, { error: 'database_unreachable' });
}

const DATABASE_MISSING = new Set(['3D000']);
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01', '57P02', '57P03', '08006', '08001', '08003', '08004']);

/** Run a query; a lost connection marks the database not ready and answers 503 database_unreachable. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<T[]> {
  try {
    return (await db.query<T>(text, values)).rows;
  } catch (error) {
    if (isConnectionError(error)) {
      ready = false;
      void connect();
      throw new HttpError(503, { error: 'database_unreachable' });
    }
    throw error;
  }
}

/** A checked-out client has no pool listener; its lost connection surfaces on the statement that is running or next. */
const ignoreLostConnection = (): void => undefined;

function hasCode(error: unknown, codes: Set<string>): boolean {
  const code = isRecord(error) ? error['code'] : undefined;
  return typeof code === 'string' && codes.has(code);
}

function isConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return hasCode(error, CONNECTION_CODES) || message.includes('Connection terminated') || message.includes('not queryable') || message.includes('timeout exceeded when trying to connect');
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(db, text, values))[0];
}

/** The row a statement always returns: an INSERT ... RETURNING, or a row a foreign key or this transaction guarantees. */
export async function theRow<T extends pg.QueryResultRow = pg.QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<T> {
  return (await query<T>(db, text, values))[0];
}

/** One transaction; the callback's client is committed on return and rolled back on a throw. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  await requireDatabase();
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isConnectionError(error)) {
      ready = false;
      void connect();
      throw new HttpError(503, { error: 'database_unreachable' });
    }
    throw error;
  }
  client.on('error', ignoreLostConnection);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isConnectionError(error)) {
      ready = false;
      void connect();
      throw new HttpError(503, { error: 'database_unreachable' });
    }
    throw error;
  } finally {
    client.off('error', ignoreLostConnection);
    client.release();
  }
}

export const sql = pool;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS provider_health (address text PRIMARY KEY, up boolean NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL, name text NOT NULL, country text NOT NULL, role text NOT NULL, password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL, key text NOT NULL, fingerprint text NOT NULL, state text NOT NULL, status int, body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, key)
);
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 10001;
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number text NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL, state text NOT NULL, plan jsonb NOT NULL, plan_version int NOT NULL DEFAULT 1,
  bike_id text, config jsonb, donor jsonb, verdict text, class_move boolean NOT NULL DEFAULT false,
  fulfilment text NOT NULL, delivery_country text NOT NULL,
  total_cents int NOT NULL, vat_cents int NOT NULL, partly_refunded boolean NOT NULL DEFAULT false,
  delivered_on date, withdrawal_deadline timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), position int NOT NULL,
  code text NOT NULL, name text NOT NULL, gross_cents int NOT NULL, vat_rate_pct int NOT NULL, vat_cents int NOT NULL
);
CREATE INDEX IF NOT EXISTS order_lines_order ON order_lines (order_id, position);
CREATE TABLE IF NOT EXISTS stages (
  order_id uuid NOT NULL REFERENCES orders(id), stage text NOT NULL, position int NOT NULL, label text NOT NULL,
  due_date date NOT NULL, amount_cents int NOT NULL, status text NOT NULL DEFAULT 'scheduled', attempts int NOT NULL DEFAULT 0,
  confirmed_at timestamptz, vat_corrected_cents int NOT NULL DEFAULT 0, PRIMARY KEY (order_id, stage)
);
CREATE TABLE IF NOT EXISTS allocations (
  order_id uuid NOT NULL REFERENCES orders(id), stage text NOT NULL, line_id uuid NOT NULL REFERENCES order_lines(id),
  gross_cents int NOT NULL, vat_cents int NOT NULL, PRIMARY KEY (order_id, stage, line_id)
);
CREATE TABLE IF NOT EXISTS kb_accounts (user_id uuid PRIMARY KEY REFERENCES users(id), account_id text NOT NULL);
CREATE TABLE IF NOT EXISTS payments (
  external_key text PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), stage text NOT NULL, user_id uuid NOT NULL,
  collection boolean NOT NULL DEFAULT false, amount_cents int NOT NULL, kb_payment_id text, kb_transaction_id text,
  outcome text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_order ON payments (order_id, stage, created_at);
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), line_id uuid NOT NULL REFERENCES order_lines(id),
  amount_cents int NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
);
CREATE TABLE IF NOT EXISTS refund_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), refund_id uuid NOT NULL REFERENCES refunds(id), order_id uuid NOT NULL REFERENCES orders(id),
  stage text NOT NULL, seq int NOT NULL, amount_cents int NOT NULL, vat_cents int NOT NULL, status text NOT NULL DEFAULT 'pending',
  external_key text NOT NULL UNIQUE, user_id uuid NOT NULL, kb_payment_id text, sent boolean NOT NULL DEFAULT false, claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS refund_draws_refund ON refund_draws (refund_id, seq);
CREATE INDEX IF NOT EXISTS refund_draws_order ON refund_draws (order_id);
CREATE INDEX IF NOT EXISTS refunds_order ON refunds (order_id, created_at);
CREATE TABLE IF NOT EXISTS slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bike_id text NOT NULL, starts_at timestamptz NOT NULL,
  local_date date NOT NULL, local_time text NOT NULL, UNIQUE (bike_id, starts_at)
);
CREATE INDEX IF NOT EXISTS slots_bike ON slots (bike_id, starts_at);
CREATE TABLE IF NOT EXISTS rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), slot_id uuid NOT NULL REFERENCES slots(id),
  bike_id text NOT NULL, state text NOT NULL, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rides_one_hold ON rides (user_id) WHERE state = 'held';
CREATE INDEX IF NOT EXISTS rides_held_expiry ON rides (expires_at) WHERE state = 'held';
CREATE UNIQUE INDEX IF NOT EXISTS rides_one_per_slot ON rides (slot_id) WHERE state IN ('held', 'confirmed', 'ridden', 'no-show');
CREATE TABLE IF NOT EXISTS mails (
  id bigserial PRIMARY KEY, dedupe_key text NOT NULL UNIQUE, to_email text NOT NULL, subject text NOT NULL, body text NOT NULL,
  state text NOT NULL DEFAULT 'queued', claimed_at timestamptz, sent_at timestamptz, attempts int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY, payment_id text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypted(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function seed(client: pg.PoolClient): Promise<void> {
  for (const user of SEED_USERS) {
    const exists = (await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [user.email])).rowCount;
    if (!exists) {
      await client.query('INSERT INTO users (email, name, country, role, password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [
        user.email, user.name, user.country, user.role, await hashPassword(user.password),
      ]);
    }
  }
  const catalogued = await client.query("SELECT 1 FROM settings WHERE key = 'catalogue_seeded'");
  if (!catalogued.rowCount) {
    await seedCatalogue(client);
    await client.query("INSERT INTO settings (key, value) VALUES ('catalogue_seeded', 'yes') ON CONFLICT DO NOTHING");
  }
  const seeded = await client.query("SELECT 1 FROM settings WHERE key = 'slots_seeded'");
  if (seeded.rowCount) return;
  const today = amsterdamToday();
  const slots: { bike: string; date: string; time: string }[] = [];
  for (const bike of ['BK-KADE-25', 'BK-DIJK-45']) {
    for (let offset = 0; offset < 14; offset += 1) {
      const date = addDays(today, offset);
      if (weekday(date) === 0) continue;
      for (const time of ['10:00', '13:00', '16:00']) slots.push({ bike, date, time });
    }
  }
  let next = addDays(today, 1);
  while (weekday(next) === 0) next = addDays(next, 1);
  slots.push({ bike: 'BK-POLDER-45', date: next, time: '10:00' });
  for (const s of slots) {
    const instant = localInstants(s.date, s.time)[0];
    await client.query('INSERT INTO slots (bike_id, starts_at, local_date, local_time) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [
      s.bike, new Date(instant).toISOString(), s.date, s.time,
    ]);
  }
  await client.query("INSERT INTO settings (key, value) VALUES ('slots_seeded', 'yes') ON CONFLICT DO NOTHING");
}

async function createDatabaseIfMissing(): Promise<void> {
  const { admin, name } = databaseParts();
  const adminPool = new pg.Pool({ connectionString: admin, max: 1, connectionTimeoutMillis: 3000 });
  adminPool.on('error', () => undefined);
  try {
    const exists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!exists.rowCount) await adminPool.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await adminPool.end().catch(() => undefined);
  }
}

async function migrate(): Promise<void> {
  const client = await pool.connect();
  client.on('error', ignoreLostConnection);
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    try {
      await client.query(SCHEMA + CATALOGUE_SCHEMA);
      await seed(client);
      await loadCatalogue(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(727001)');
    }
  } finally {
    client.off('error', ignoreLostConnection);
    client.release();
  }
}

/** Connect, apply schema and seed, and mark ready. Retries until PostgreSQL answers; never throws. */
export function connect(): Promise<void> {
  if (migrating) return migrating;
  let attempted = (): void => undefined;
  firstAttempt = new Promise((resolve) => { attempted = resolve; });
  migrating = (async () => {
    for (;;) {
      try {
        try {
          await migrate();
        } catch (error) {
          if (!hasCode(error, DATABASE_MISSING)) throw error;
          await createDatabaseIfMissing();
          await migrate();
        }
        ready = true;
        return;
      } catch {
        attempted();
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  })().finally(() => {
    attempted();
    migrating = null;
  });
  return migrating;
}
