export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS operators (
  id text PRIMARY KEY,
  name text NOT NULL,
  order_prefix text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  name text NOT NULL,
  city text NOT NULL,
  region text NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  timezone text NOT NULL,
  vat_rate integer NOT NULL,
  suspended boolean NOT NULL DEFAULT false,
  suspension_reason text
);

CREATE TABLE IF NOT EXISTS user_stores (
  user_id uuid NOT NULL REFERENCES users(id),
  store_id text NOT NULL REFERENCES stores(id),
  PRIMARY KEY (user_id, store_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_attempts_email_at ON sign_in_attempts (email, at DESC);

CREATE TABLE IF NOT EXISTS hours_plans (
  store_id text NOT NULL REFERENCES stores(id),
  effective_from date NOT NULL,
  days jsonb NOT NULL,
  PRIMARY KEY (store_id, effective_from)
);

CREATE TABLE IF NOT EXISTS products (
  operator_id text NOT NULL REFERENCES operators(id),
  sku text NOT NULL,
  name text NOT NULL,
  unit_price_milli integer NOT NULL,
  PRIMARY KEY (operator_id, sku)
);

CREATE TABLE IF NOT EXISTS stock (
  store_id text NOT NULL REFERENCES stores(id),
  sku text NOT NULL,
  on_hand integer NOT NULL,
  held integer NOT NULL,
  PRIMARY KEY (store_id, sku)
);

CREATE TABLE IF NOT EXISTS carts (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  store_id text REFERENCES stores(id),
  area_lat double precision,
  area_lon double precision
);

CREATE TABLE IF NOT EXISTS cart_lines (
  user_id uuid NOT NULL REFERENCES users(id),
  sku text NOT NULL,
  quantity integer NOT NULL,
  added_seq bigserial,
  PRIMARY KEY (user_id, sku)
);

CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  user_id uuid NOT NULL REFERENCES users(id),
  store_id text NOT NULL REFERENCES stores(id),
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text
);
CREATE INDEX IF NOT EXISTS holds_active ON holds (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS holds_store_active ON holds (store_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS hold_lines (
  hold_id uuid NOT NULL REFERENCES holds(id),
  sku text NOT NULL,
  quantity integer NOT NULL,
  PRIMARY KEY (hold_id, sku)
);

CREATE TABLE IF NOT EXISTS order_numbers (
  operator_id text PRIMARY KEY REFERENCES operators(id),
  next_number integer NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  store_id text NOT NULL REFERENCES stores(id),
  user_id uuid NOT NULL REFERENCES users(id),
  number text NOT NULL,
  status text NOT NULL,
  slot_start_utc timestamptz NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  total_cents integer NOT NULL,
  vat_cents integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (operator_id, number)
);
CREATE INDEX IF NOT EXISTS orders_slot ON orders (store_id, slot_start_utc) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS orders_listing ON orders (operator_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS order_lines (
  order_id uuid NOT NULL REFERENCES orders(id),
  sku text NOT NULL,
  name text NOT NULL,
  quantity integer NOT NULL,
  unit_price_milli integer NOT NULL,
  line_total_cents integer NOT NULL,
  vat_rate integer NOT NULL,
  vat_cents integer NOT NULL,
  PRIMARY KEY (order_id, sku)
);

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  number text NOT NULL,
  sequence integer NOT NULL,
  status text NOT NULL,
  reason text NOT NULL,
  refund_cents integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (order_id, sequence)
);

CREATE TABLE IF NOT EXISTS return_lines (
  return_id uuid NOT NULL REFERENCES returns(id),
  sku text NOT NULL,
  quantity integer NOT NULL,
  refund_cents integer NOT NULL,
  PRIMARY KEY (return_id, sku)
);

CREATE TABLE IF NOT EXISTS order_events (
  order_id uuid NOT NULL,
  seq integer NOT NULL,
  type text NOT NULL,
  at timestamptz NOT NULL,
  data jsonb NOT NULL,
  digest text NOT NULL,
  PRIMARY KEY (order_id, seq)
);

CREATE TABLE IF NOT EXISTS order_view (
  order_id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  store_id text NOT NULL,
  number text NOT NULL,
  status text NOT NULL,
  total_cents integer NOT NULL,
  refunded_cents integer NOT NULL,
  last_seq integer NOT NULL
);

CREATE TABLE IF NOT EXISTS slot_locks (
  store_id text NOT NULL,
  slot_start_utc timestamptz NOT NULL,
  PRIMARY KEY (store_id, slot_start_utc)
);

CREATE TABLE IF NOT EXISTS request_keys (
  operator_id text NOT NULL,
  user_id uuid NOT NULL,
  request_key text NOT NULL,
  scope text NOT NULL,
  body_hash text NOT NULL,
  state text NOT NULL,
  status_code integer,
  response_body text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (operator_id, user_id, request_key)
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  sent_at timestamptz,
  abandoned boolean NOT NULL DEFAULT false
);

CREATE OR REPLACE FUNCTION tramela_fold(source text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $fn$
  SELECT lower(translate(source,
    'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy'))
$fn$;
`;
