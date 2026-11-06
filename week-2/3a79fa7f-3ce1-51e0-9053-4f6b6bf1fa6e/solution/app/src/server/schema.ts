// Tables for every record (brief: Services, PostgreSQL). Money is integer cents.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  sku text PRIMARY KEY,
  kind text NOT NULL,
  position integer NOT NULL,
  name text NOT NULL,
  price_cents integer NOT NULL,
  details jsonb NOT NULL,
  stock integer NOT NULL CHECK (stock >= 0),
  seeded_stock integer NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS carts (
  id serial PRIMARY KEY,
  user_id integer UNIQUE REFERENCES users,
  guest_token_hash text UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS cart_lines (
  id serial PRIMARY KEY,
  cart_id integer NOT NULL REFERENCES carts ON DELETE CASCADE,
  type text NOT NULL,
  line_key text NOT NULL,
  build_code text,
  sku text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, line_key)
);
CREATE TABLE IF NOT EXISTS cart_codes (
  cart_id integer NOT NULL REFERENCES carts ON DELETE CASCADE,
  code text NOT NULL,
  position bigserial,
  PRIMARY KEY (cart_id, code)
);
CREATE TABLE IF NOT EXISTS cart_shares (
  token text PRIMARY KEY,
  lines jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS builds (
  code text PRIMARY KEY,
  picks jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS match_results (
  id bigserial PRIMARY KEY,
  answers jsonb NOT NULL,
  recommended text NOT NULL,
  scores jsonb NOT NULL,
  reasons jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  name text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO settings (name, value) VALUES ('cursor_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) ON CONFLICT (name) DO NOTHING;
CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value integer NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  number text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users,
  status text NOT NULL,
  placed_at timestamptz NOT NULL,
  country text NOT NULL,
  address jsonb NOT NULL,
  subtotal_cents integer NOT NULL,
  discounts jsonb NOT NULL,
  credits jsonb NOT NULL,
  taxable_cents integer NOT NULL,
  shipping_cents integer NOT NULL,
  packed_batteries integer NOT NULL,
  standalone_batteries integer NOT NULL,
  dangerous_goods_cents integer NOT NULL,
  taxes jsonb NOT NULL,
  tax_cents integer NOT NULL,
  total_cents integer NOT NULL,
  ships_on date NOT NULL,
  arrives_on date NOT NULL,
  trade_in_id integer,
  demo_credit_used boolean NOT NULL,
  billing_account_key text NOT NULL,
  billing_account_id text,
  billing_invoice_id text,
  billing_items jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS order_lines (
  id serial PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders,
  position integer NOT NULL,
  type text NOT NULL,
  sku text NOT NULL,
  build_code text,
  name text NOT NULL,
  quantity integer NOT NULL,
  unit_cents integer NOT NULL,
  line_cents integer NOT NULL,
  spares integer NOT NULL
);
CREATE TABLE IF NOT EXISTS order_events (
  id serial PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders,
  status text NOT NULL,
  at timestamptz NOT NULL,
  by_email text NOT NULL
);
CREATE TABLE IF NOT EXISTS protection_plans (
  line_id integer PRIMARY KEY REFERENCES order_lines,
  order_number text NOT NULL REFERENCES orders,
  term_years integer NOT NULL,
  price_cents integer NOT NULL,
  tax_cents integer NOT NULL,
  protected_until timestamptz NOT NULL,
  voided boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS registrations (
  serial text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users,
  order_number text NOT NULL REFERENCES orders,
  line_id integer NOT NULL REFERENCES order_lines,
  board_name text NOT NULL,
  country text NOT NULL,
  registered_at timestamptz NOT NULL,
  board_ends_on date NOT NULL,
  battery_ends_on date NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id integer NOT NULL REFERENCES users,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL,
  order_number text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS trade_ins (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users,
  status text NOT NULL,
  brand text NOT NULL,
  model_year integer NOT NULL,
  condition text NOT NULL,
  serial text NOT NULL,
  note text NOT NULL,
  quote_cents integer,
  quote_expires_at timestamptz,
  reject_reason text,
  order_number text,
  submitted_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id integer PRIMARY KEY,
  name text NOT NULL,
  city text NOT NULL,
  country text NOT NULL,
  lat text NOT NULL,
  lon text NOT NULL,
  timezone text NOT NULL,
  opening_hours text NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (
  id serial PRIMARY KEY,
  location_id integer NOT NULL REFERENCES locations,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id serial PRIMARY KEY,
  slot_id integer NOT NULL REFERENCES slots,
  user_id integer NOT NULL REFERENCES users,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_credits (
  user_id integer PRIMARY KEY REFERENCES users,
  amount_cents integer NOT NULL,
  expires_at timestamptz NOT NULL,
  used_order_number text
);
CREATE TABLE IF NOT EXISTS events (
  id integer PRIMARY KEY,
  title text NOT NULL,
  location_id integer NOT NULL REFERENCES locations,
  starts_on date NOT NULL,
  ends_on date NOT NULL
);
CREATE TABLE IF NOT EXISTS callbacks (
  id serial PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  email_norm text NOT NULL,
  phone text NOT NULL,
  timezone text NOT NULL,
  preferred_start timestamptz NOT NULL,
  topic text NOT NULL,
  message text NOT NULL,
  build_code text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS cases (
  id serial PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  email text NOT NULL,
  email_norm text NOT NULL,
  order_number text,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL,
  opened_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS lookup_misses (
  id bigserial PRIMARY KEY,
  email_norm text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS lookup_misses_email ON lookup_misses (email_norm, at);
CREATE TABLE IF NOT EXISTS newsletter_signups (
  email_norm text PRIMARY KEY,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS partner_applications (
  id serial PRIMARY KEY,
  email_norm text NOT NULL UNIQUE,
  business_name text NOT NULL,
  country text NOT NULL,
  kind text NOT NULL,
  website text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS reset_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users,
  token_hash text NOT NULL UNIQUE,
  mail_token text,
  issued_at timestamptz NOT NULL,
  used_at timestamptz,
  invalidated boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_addr text NOT NULL,
  template text NOT NULL,
  reference text,
  subject text NOT NULL,
  body text NOT NULL,
  reset_token_id integer REFERENCES reset_tokens,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS sender_heartbeats (
  instance text PRIMARY KEY,
  mail_ok boolean NOT NULL,
  seen_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (status, next_attempt_at, id);
`;
