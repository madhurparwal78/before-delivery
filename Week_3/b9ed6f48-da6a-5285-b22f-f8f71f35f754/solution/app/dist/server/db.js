// PostgreSQL: the pool, transactions and the schema, applied idempotently on every start under
// an advisory lock so several instances can boot against one database.
import pg from "pg";
import { config } from "./config.js";
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));
pg.types.setTypeParser(1082, (value) => value);
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });
pool.on("error", (error) => console.error("postgres pool error", error.message));
export async function rows(db, sql, params = []) {
    return (await db.query(sql, params)).rows;
}
export async function one(db, sql, params = []) {
    return (await db.query(sql, params)).rows[0];
}
export async function tx(work) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
}
/** Runs `work` while holding a transaction-scoped advisory lock on `name`, across instances. */
export async function locked(name, work) {
    return tx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [name]);
        return work(client);
    });
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  n integer NOT NULL UNIQUE,
  citation text NOT NULL
);
CREATE TABLE IF NOT EXISTS chapters (
  id text PRIMARY KEY,
  number integer NOT NULL UNIQUE,
  numeral text NOT NULL,
  title text NOT NULL,
  era text NOT NULL,
  sightline_deg integer NOT NULL,
  exhibit text,
  body text NOT NULL,
  status text NOT NULL,
  owner_email text NOT NULL,
  publish_at timestamptz
);
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  chapter integer NOT NULL REFERENCES chapters(number),
  year integer NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  source_ids text[] NOT NULL DEFAULT '{}',
  status text NOT NULL,
  owner_email text NOT NULL,
  publish_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media (
  id text PRIMARY KEY,
  item_id text NOT NULL,
  kind text NOT NULL,
  filename text NOT NULL,
  bytes integer NOT NULL,
  content_type text NOT NULL,
  key text NOT NULL,
  transcript text,
  caption text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_item ON media (item_id, kind, created_at);
CREATE TABLE IF NOT EXISTS sign_in_sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{"motion": true, "sound": false}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS guided_sessions (
  id text PRIMARY KEY,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  capacity integer NOT NULL,
  cancelling boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS killbill_accounts (
  user_id text PRIMARY KEY,
  account_id text NOT NULL UNIQUE,
  currency text NOT NULL
);
CREATE SEQUENCE IF NOT EXISTS receipt_numbers;
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  receipt_number text NOT NULL UNIQUE,
  user_id text NOT NULL,
  user_email text NOT NULL,
  user_name text NOT NULL,
  kind text NOT NULL,
  description text NOT NULL,
  currency text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  card_last4 text NOT NULL,
  killbill_invoice_id text NOT NULL,
  killbill_payment_id text NOT NULL,
  settled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, created_at);
CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES guided_sessions(id),
  user_id text NOT NULL,
  seats integer NOT NULL,
  state text NOT NULL,
  ticket_code text UNIQUE,
  order_id text REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_session ON bookings (session_id, state);
CREATE TABLE IF NOT EXISTS refunds (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason text NOT NULL,
  at timestamptz NOT NULL,
  killbill_transaction_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_order ON refunds (order_id);
CREATE TABLE IF NOT EXISTS order_notes (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  text text NOT NULL,
  author_email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body jsonb,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS card_charge_counts (
  user_id text PRIMARY KEY,
  charges integer NOT NULL
);
CREATE TABLE IF NOT EXISTS cards_on_file (
  user_id text PRIMARY KEY,
  last4 text NOT NULL,
  outcome_class text NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_queue (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  to_name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_unsent ON mail_queue (id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS dunning (
  user_id text PRIMARY KEY,
  user_email text NOT NULL,
  user_name text NOT NULL,
  subscription_id text NOT NULL,
  invoice_id text NOT NULL,
  order_kind text NOT NULL,
  tier text NOT NULL,
  currency text NOT NULL,
  amount_due_minor bigint NOT NULL,
  failed_at timestamptz NOT NULL,
  attempts integer NOT NULL,
  auto_retries integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz
);
CREATE TABLE IF NOT EXISTS voided_subscriptions (
  subscription_id text PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS staff_actions (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_email text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE OR REPLACE FUNCTION staff_actions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'staff_actions is append-only'; END $$;
DROP TRIGGER IF EXISTS staff_actions_append_only ON staff_actions;
CREATE TRIGGER staff_actions_append_only BEFORE UPDATE OR DELETE ON staff_actions
  FOR EACH ROW EXECUTE FUNCTION staff_actions_append_only();
`;
export async function migrate() {
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock(hashtextextended('schema', 0))");
        await client.query(SCHEMA);
    }
    finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended('schema', 0))").catch(() => undefined);
        client.release();
    }
}
