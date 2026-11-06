import pg from "pg";
import { config } from "./config.js";
import { errorCode } from "./errors.js";

// bigint columns (sums of movements) come back as JS numbers; every value is far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
// DATE columns stay as YYYY-MM-DD strings: they are calendar dates, never instants.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });
pool.on("error", (error) => console.error("postgres pool error:", errorCode(error)));

export type Queryable = pg.Pool | pg.PoolClient;

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('retail', 'trade', 'admin')),
  trade_status text CHECK (trade_status IN ('submitted', 'approved', 'declined')),
  dial_mode text NOT NULL DEFAULT 'auto',
  kb_account_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users ON DELETE CASCADE,
  business_name text NOT NULL,
  nzbn text NOT NULL,
  occupation text NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'declined')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decline_reason text
);

CREATE TABLE IF NOT EXISTS finishes (
  code text PRIMARY KEY,
  name text NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  slug text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  family text NOT NULL,
  description text NOT NULL,
  watts int NOT NULL,
  cri int NOT NULL,
  ip_rating text NOT NULL,
  default_variant text NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS variants (
  code text PRIMARY KEY,
  product_slug text NOT NULL REFERENCES products,
  finish text NOT NULL REFERENCES finishes,
  beam_deg int NOT NULL,
  cct_k int NOT NULL,
  lumens int NOT NULL,
  candela int NOT NULL,
  retail_price_cents int NOT NULL,
  trade_price_cents int NOT NULL,
  clearance_price_cents int,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id bigserial PRIMARY KEY,
  variant_code text NOT NULL REFERENCES variants,
  delta int NOT NULL,
  reason text NOT NULL CHECK (reason IN ('seed', 'sale', 'release', 'adjust')),
  order_key text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_variant ON stock_movements (variant_code);

CREATE TABLE IF NOT EXISTS favourites (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  variant_code text NOT NULL REFERENCES variants,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, variant_code)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users,
  status text NOT NULL DEFAULT 'cart',
  payment_method text,
  price_tier text,
  captured_cents int NOT NULL DEFAULT 0,
  card_last4 text,
  purchase_order text,
  delivery jsonb,
  kb_payment_id text,
  kb_invoice_id text,
  invoice_number text,
  invoice_date date,
  due_date date,
  confirmation_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  left_cart_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_open_cart ON orders (user_id)
  WHERE status IN ('cart', 'declined', 'gateway_unavailable');

CREATE TABLE IF NOT EXISTS order_lines (
  order_id uuid NOT NULL REFERENCES orders ON DELETE CASCADE,
  variant_code text NOT NULL REFERENCES variants,
  quantity int NOT NULL,
  unit_price_cents int,
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (order_id, variant_code)
);

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders,
  seq int NOT NULL,
  amount_cents int NOT NULL,
  reason text NOT NULL,
  kb_transaction_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, seq)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'done')),
  status int,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_name text,
  owner_id uuid NOT NULL REFERENCES users,
  ceiling_height_mm int NOT NULL DEFAULT 2700,
  room_width_mm int NOT NULL DEFAULT 6000,
  room_depth_mm int NOT NULL DEFAULT 4500,
  cover_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_lines (
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  variant_code text NOT NULL REFERENCES variants,
  quantity int NOT NULL,
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (project_id, variant_code)
);

CREATE TABLE IF NOT EXISTS placement_counters (
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  variant_code text NOT NULL,
  last_ordinal int NOT NULL,
  PRIMARY KEY (project_id, variant_code)
);

CREATE TABLE IF NOT EXISTS placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  variant_code text NOT NULL REFERENCES variants,
  ordinal int NOT NULL,
  x_mm int NOT NULL,
  y_mm int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS project_collaborators (
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users,
  price_display text NOT NULL CHECK (price_display IN ('trade', 'retail', 'none')),
  recipients text[] NOT NULL,
  message text,
  pdf_status text NOT NULL DEFAULT 'pending' CHECK (pdf_status IN ('pending', 'waiting_for_storage', 'ready')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shares_open ON shares (created_at) WHERE pdf_status <> 'ready';

CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  occupation text NOT NULL,
  consent_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

/** Applies the schema and the seed. Idempotent, and safe when two instances start at once. */
export async function migrate(seed: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('lightfall-migrate'))");
    await client.query(SCHEMA);
    const seeded = await client.query("SELECT 1 FROM app_meta WHERE key = 'seed-v1'");
    if (!seeded.rowCount) {
      await client.query("BEGIN");
      try {
        await seed(client);
        await client.query("INSERT INTO app_meta (key) VALUES ('seed-v1')");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('lightfall-migrate'))");
    client.release();
  }
}
