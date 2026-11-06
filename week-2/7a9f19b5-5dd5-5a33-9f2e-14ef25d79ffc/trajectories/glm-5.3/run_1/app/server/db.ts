import pg from 'pg'
import { load_config, type Config } from './config.js'
import { seed_data } from './seed_data.js'

// DATE columns stay as YYYY-MM-DD strings; the due-date rules compare them directly.
pg.types.setTypeParser(1082, (value: string) => value)

let config_value: Config | null = null

/** Config loaded once at start; also readable by modules that need it. */
export function config(): Config {
  if (!config_value) config_value = load_config()
  return config_value
}

const SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL,
  trade_status  text,
  dial_mode     text NOT NULL DEFAULT 'auto',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token  text PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trade_applications (
  id            serial PRIMARY KEY,
  user_id       int NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  nzbn          text NOT NULL,
  occupation    text NOT NULL,
  status        text NOT NULL,
  decline_reason text,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE TABLE IF NOT EXISTS products (
  id    serial PRIMARY KEY,
  slug  text NOT NULL UNIQUE,
  name  text NOT NULL,
  code  text NOT NULL,
  family text NOT NULL,
  description text NOT NULL,
  watts int NOT NULL,
  cri   int NOT NULL,
  ip_rating text NOT NULL,
  default_variant text NOT NULL
);
CREATE TABLE IF NOT EXISTS variants (
  id   serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  product_id int NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  finish text NOT NULL,
  beam_deg int NOT NULL,
  cct_k int NOT NULL,
  lumens int NOT NULL,
  candela int NOT NULL,
  retail_price_cents int NOT NULL,
  trade_price_cents int NOT NULL,
  clearance boolean NOT NULL DEFAULT false,
  clearance_price_cents int,
  was_price_cents int,
  stock_on_hand int NOT NULL DEFAULT 0,
  discontinued boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id        serial PRIMARY KEY,
  variant_id int NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  delta     int NOT NULL,
  reason    text NOT NULL,
  order_key text,
  note      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS favourites (
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant_id int NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, variant_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id         serial PRIMARY KEY,
  order_key  text NOT NULL UNIQUE,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL,
  payment_method text,
  price_tier text NOT NULL,
  purchase_order text,
  card_last4 text,
  delivery_name text,
  delivery_address text,
  delivery_city text,
  delivery_postcode text,
  subtotal_cents int,
  gst_cents int,
  total_cents int,
  captured_cents int,
  refunded_cents int NOT NULL DEFAULT 0,
  kb_payment_id text,
  kb_invoice_id text,
  invoice_number text,
  invoice_date date,
  due_date date,
  kb_next_refund_n int NOT NULL DEFAULT 1,
  confirmation_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_lines (
  id serial PRIMARY KEY,
  order_id int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id int NOT NULL REFERENCES variants(id),
  product_name text NOT NULL,
  quantity int NOT NULL,
  unit_price_cents int NOT NULL,
  line_total_cents int NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  id serial PRIMARY KEY,
  order_id int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents int NOT NULL,
  reason text NOT NULL,
  kb_transaction_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency (
  key        text NOT NULL,
  user_id    int NOT NULL,
  endpoint   text NOT NULL,
  in_progress boolean NOT NULL DEFAULT true,
  status     int,
  body       text,
  fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint, key)
);
CREATE TABLE IF NOT EXISTS projects (
  id serial PRIMARY KEY,
  name text NOT NULL,
  client_name text NOT NULL DEFAULT '',
  owner_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ceiling_height_mm int NOT NULL DEFAULT 2700,
  room_width_mm int NOT NULL DEFAULT 6000,
  room_depth_mm int NOT NULL DEFAULT 4500,
  cover_ext text,
  cover_object text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_collaborators (
  project_id int NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS project_lines (
  id serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  variant_id int NOT NULL REFERENCES variants(id),
  product_name text NOT NULL,
  quantity int NOT NULL
);
CREATE TABLE IF NOT EXISTS placements (
  id serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  variant_id int NOT NULL REFERENCES variants(id),
  variant_code text NOT NULL,
  ordinal int NOT NULL,
  x_mm int NOT NULL,
  y_mm int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shares (
  id uuid PRIMARY KEY,
  project_id int NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price_display text NOT NULL,
  recipients text NOT NULL,
  message text,
  pdf_status text NOT NULL DEFAULT 'pending',
  object_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id serial PRIMARY KEY,
  email text NOT NULL,
  occupation text NOT NULL,
  token text NOT NULL UNIQUE,
  consented_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
`

export interface Pool extends pg.Pool {}
export type DbClient = pg.PoolClient

export async function init_db(): Promise<Pool> {
  const pool = new pg.Pool({ connectionString: config().database_url, max: 20 })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(SCHEMA)
    await seed_data(client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return pool
}

const SEED_USERS = [
  { email: 'admin@southerly-light.test', password: 'Lightfall-admin-2026', name: 'Ana Whitlow', role: 'admin', trade_status: null as string | null, business: null as string | null, nzbn: null as string | null, occupation: null as string | null },
  { email: 'rangi@kowhai-electrical.test', password: 'Trade-approved-2026', name: 'Rangi Parata', role: 'trade', trade_status: 'approved', business: 'Kōwhai Electrical Ltd', nzbn: '9429041234567', occupation: 'electrician' },
  { email: 'isla@harbourlight.test', password: 'Trade-collab-2026', name: 'Isla Morven', role: 'trade', trade_status: 'approved', business: 'Harbour Light Design', nzbn: '9429047654321', occupation: 'lighting_designer' },
  { email: 'sam@whitcombe-wholesale.test', password: 'Trade-pending-2026', name: 'Sam Whitcombe', role: 'trade', trade_status: 'submitted', business: 'Whitcombe Wholesale', nzbn: '9429030000017', occupation: 'wholesaler' },
  { email: 'jo@bennett-home.test', password: 'Retail-buyer-2026', name: 'Jo Bennett', role: 'retail', trade_status: null, business: null, nzbn: null, occupation: null },
  { email: 'lee@chen-house.test', password: 'Retail-buyer2-2026', name: 'Lee Chen', role: 'retail', trade_status: null, business: null, nzbn: null, occupation: null },
]

export { SEED_USERS }
