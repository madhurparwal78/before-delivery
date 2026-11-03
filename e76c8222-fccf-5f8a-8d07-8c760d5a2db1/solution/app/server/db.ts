// PostgreSQL: the pool, transactions and the idempotent schema.
import pg from "pg";
import { config } from "./config.js";

// DATE columns stay YYYY-MM-DD agency dates instead of becoming local-midnight Dates.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.Pool | pg.PoolClient;

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

/** Runs `work` in one transaction; commits on success, rolls back on any throw. */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  killbill_account_id text
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('coordinator','interpreter','requester','consumer','billing')),
  org_id text REFERENCES orgs(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
  id uuid PRIMARY KEY,
  interpreter_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  number text NOT NULL,
  expires_on date NOT NULL,
  scan_filename text NOT NULL,
  scan_content_type text NOT NULL,
  scan_key text NOT NULL,
  scan_pending boolean NOT NULL DEFAULT false,
  warned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS preferences (
  consumer_id uuid NOT NULL REFERENCES users(id),
  interpreter_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('preferred','blocked')),
  position integer NOT NULL,
  PRIMARY KEY (consumer_id, interpreter_id)
);
CREATE TABLE IF NOT EXISTS rates (
  setting text PRIMARY KEY,
  cents integer NOT NULL CHECK (cents > 0)
);
CREATE SEQUENCE IF NOT EXISTS request_ref_seq START 1007;
CREATE TABLE IF NOT EXISTS requests (
  id uuid PRIMARY KEY,
  ref_no integer NOT NULL UNIQUE,
  org_id text NOT NULL REFERENCES orgs(id),
  title text NOT NULL,
  setting text NOT NULL,
  location text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  consumer_id uuid NOT NULL REFERENCES users(id),
  notes text NOT NULL DEFAULT '',
  status text NOT NULL,
  logged_after boolean NOT NULL DEFAULT false,
  cancellation_fee_cents integer,
  cancellation_quote jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_start ON requests (start_at);
CREATE INDEX IF NOT EXISTS requests_org ON requests (org_id, start_at);
CREATE TABLE IF NOT EXISTS seats (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id),
  position integer NOT NULL,
  UNIQUE (request_id, position)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY,
  seat_id uuid NOT NULL REFERENCES seats(id),
  interpreter_id uuid NOT NULL REFERENCES users(id),
  held_by uuid NOT NULL REFERENCES users(id),
  token text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('active','accepted','declined','expired','withdrawn')),
  sent_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  outbox_id bigint REFERENCES outbox(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS offers_one_live_per_seat ON offers (seat_id) WHERE status IN ('active','accepted');
CREATE INDEX IF NOT EXISTS offers_active_expiry ON offers (expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS offers_interpreter ON offers (interpreter_id) WHERE status IN ('active','accepted');
CREATE INDEX IF NOT EXISTS offers_seat ON offers (seat_id, sent_at);
CREATE TABLE IF NOT EXISTS timesheets (
  id uuid PRIMARY KEY,
  seat_id uuid NOT NULL UNIQUE REFERENCES seats(id),
  interpreter_id uuid NOT NULL REFERENCES users(id),
  actual_start timestamptz NOT NULL,
  actual_end timestamptz NOT NULL,
  signature_name text NOT NULL,
  billed_hundredths integer NOT NULL,
  status text NOT NULL CHECK (status IN ('submitted','approved')),
  hourly_rate_cents integer,
  amount_cents integer,
  killbill_invoice_id text,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS prep_files (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id),
  filename text NOT NULL,
  size integer NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL,
  object_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  key text NOT NULL,
  body text NOT NULL,
  state text NOT NULL CHECK (state IN ('running','done')),
  status integer,
  response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action, target, key)
);
CREATE TABLE IF NOT EXISTS charge_attempts (
  charge_key text PRIMARY KEY,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  request_id uuid,
  from_status text,
  to_status text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_request ON audit_log (request_id, id);
`;

const SCHEMA_LOCK = 72_220_001;

/** Applies the schema and, on an empty database, the seed; serialised across serve instances. */
export async function prepareDatabase(seed: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(SCHEMA);
    const empty = (await client.query("SELECT 1 FROM users LIMIT 1")).rowCount === 0;
    if (empty) {
      await client.query("BEGIN");
      try {
        await seed(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}
