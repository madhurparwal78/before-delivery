// PostgreSQL schema, applied idempotently every time the app serves.

export const schemaSql = `
CREATE TABLE IF NOT EXISTS operators (
  id text PRIMARY KEY,
  name text NOT NULL,
  prefix text NOT NULL,
  order_seq integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('lead', 'manager', 'care', 'shopper')),
  operator_id text NOT NULL REFERENCES operators (id),
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS shops (
  id text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators (id),
  name text NOT NULL,
  city text NOT NULL,
  region text NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  timezone text NOT NULL,
  vat_rate integer NOT NULL,
  suspended boolean NOT NULL DEFAULT false,
  suspension_reason text,
  hours jsonb NOT NULL,
  upcoming_from date,
  upcoming_hours jsonb
);

CREATE TABLE IF NOT EXISTS user_shops (
  user_id uuid NOT NULL REFERENCES users (id),
  store_id text NOT NULL REFERENCES shops (id),
  PRIMARY KEY (user_id, store_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_attempts_email_at ON sign_in_attempts (email, at);

CREATE TABLE IF NOT EXISTS products (
  sku text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators (id),
  name text NOT NULL,
  unit_price_milli integer NOT NULL
);

CREATE TABLE IF NOT EXISTS stock (
  store_id text NOT NULL REFERENCES shops (id),
  sku text NOT NULL REFERENCES products (sku),
  on_hand integer NOT NULL CHECK (on_hand >= 0),
  held integer NOT NULL DEFAULT 0 CHECK (held >= 0),
  PRIMARY KEY (store_id, sku),
  CHECK (held <= on_hand)
);

CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  operator_id text NOT NULL REFERENCES operators (id),
  store_id text NOT NULL REFERENCES shops (id),
  status text NOT NULL CHECK (status IN ('active', 'released', 'converted')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text CHECK (release_reason IN ('window_ended', 'deleted', 'cart_changed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_active_per_shopper ON holds (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS holds_active_expiry ON holds (expires_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS hold_lines (
  hold_id uuid NOT NULL REFERENCES holds (id),
  sku text NOT NULL REFERENCES products (sku),
  quantity integer NOT NULL,
  PRIMARY KEY (hold_id, sku)
);

CREATE TABLE IF NOT EXISTS carts (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  store_id text REFERENCES shops (id),
  area_lat double precision,
  area_lon double precision,
  hold_id uuid REFERENCES holds (id)
);

CREATE TABLE IF NOT EXISTS cart_lines (
  user_id uuid NOT NULL REFERENCES users (id),
  sku text NOT NULL REFERENCES products (sku),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  added_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, sku)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators (id),
  number text NOT NULL,
  store_id text NOT NULL REFERENCES shops (id),
  user_id uuid NOT NULL REFERENCES users (id),
  hold_id uuid NOT NULL REFERENCES holds (id),
  slot_start_utc timestamptz NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  total_cents integer NOT NULL,
  vat_cents integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (operator_id, number)
);
CREATE INDEX IF NOT EXISTS orders_operator_created ON orders (operator_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS orders_customer_email ON orders (lower(customer_email));
CREATE INDEX IF NOT EXISTS orders_store_slot ON orders (store_id, slot_start_utc);

CREATE TABLE IF NOT EXISTS order_lines (
  order_id uuid NOT NULL REFERENCES orders (id),
  sku text NOT NULL REFERENCES products (sku),
  name text NOT NULL,
  quantity integer NOT NULL,
  unit_price_milli integer NOT NULL,
  line_total_cents integer NOT NULL,
  vat_cents integer NOT NULL,
  PRIMARY KEY (order_id, sku)
);

CREATE TABLE IF NOT EXISTS order_events (
  order_id uuid NOT NULL REFERENCES orders (id),
  seq integer NOT NULL,
  type text NOT NULL,
  at timestamptz NOT NULL,
  data jsonb NOT NULL,
  digest text NOT NULL,
  PRIMARY KEY (order_id, seq)
);
CREATE INDEX IF NOT EXISTS order_events_at ON order_events (at);

CREATE TABLE IF NOT EXISTS order_view (
  order_id uuid PRIMARY KEY REFERENCES orders (id),
  operator_id text,
  store_id text,
  number text,
  status text,
  total_cents integer,
  refunded_cents integer,
  last_seq integer
);

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders (id),
  number text NOT NULL UNIQUE,
  seq integer NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'received', 'settled', 'declined')),
  reason text NOT NULL,
  refund_cents integer NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS return_lines (
  return_id uuid NOT NULL REFERENCES returns (id),
  sku text NOT NULL REFERENCES products (sku),
  quantity integer NOT NULL,
  refund_cents integer NOT NULL,
  PRIMARY KEY (return_id, sku)
);

CREATE TABLE IF NOT EXISTS request_keys (
  user_id uuid NOT NULL REFERENCES users (id),
  key text NOT NULL,
  body jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('in_progress', 'done')),
  status integer,
  response text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders (id),
  to_address text NOT NULL,
  from_header text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  sent_at timestamptz
);
`;
