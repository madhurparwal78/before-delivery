CREATE TABLE IF NOT EXISTS operators (
  id text PRIMARY KEY,
  name text NOT NULL,
  order_prefix text NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS people_email_idx ON people (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id),
  operator_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  email text NOT NULL,
  at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sign_in_attempts_email_idx ON sign_in_attempts (email, at);

CREATE TABLE IF NOT EXISTS stores (
  id text PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  name text NOT NULL,
  city text NOT NULL,
  region text NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  timezone text NOT NULL,
  hours_kind text NOT NULL,
  suspended boolean NOT NULL DEFAULT false,
  suspension_reason text
);

CREATE TABLE IF NOT EXISTS store_managers (
  store_id text NOT NULL REFERENCES stores(id),
  person_id uuid NOT NULL REFERENCES people(id),
  PRIMARY KEY (store_id, person_id)
);

CREATE TABLE IF NOT EXISTS hours_plans (
  store_id text NOT NULL REFERENCES stores(id),
  kind text NOT NULL,
  effective_from date NOT NULL,
  weekday integer NOT NULL,
  open boolean NOT NULL,
  opens time,
  closes time,
  PRIMARY KEY (store_id, kind, weekday)
);

CREATE TABLE IF NOT EXISTS products (
  operator_id text NOT NULL REFERENCES operators(id),
  sku text NOT NULL,
  name text NOT NULL,
  unit_price_milli integer NOT NULL,
  PRIMARY KEY (operator_id, sku)
);

CREATE TABLE IF NOT EXISTS stock_lines (
  store_id text NOT NULL REFERENCES stores(id),
  sku text NOT NULL,
  on_hand integer NOT NULL,
  held integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, sku)
);

CREATE TABLE IF NOT EXISTS carts (
  person_id uuid PRIMARY KEY REFERENCES people(id),
  store_id text,
  area_lat double precision,
  area_lon double precision
);

CREATE TABLE IF NOT EXISTS cart_lines (
  person_id uuid NOT NULL REFERENCES people(id),
  sku text NOT NULL,
  quantity integer NOT NULL,
  PRIMARY KEY (person_id, sku)
);

CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id),
  store_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text
);

CREATE TABLE IF NOT EXISTS hold_lines (
  hold_id uuid NOT NULL REFERENCES holds(id),
  sku text NOT NULL,
  quantity integer NOT NULL,
  PRIMARY KEY (hold_id, sku)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL REFERENCES operators(id),
  person_id uuid NOT NULL REFERENCES people(id),
  store_id text NOT NULL,
  number text NOT NULL,
  status text NOT NULL,
  slot_start_utc timestamptz NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  total_cents integer NOT NULL,
  vat_cents integer NOT NULL,
  created_at timestamptz NOT NULL,
  next_seq integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_number_idx ON orders (operator_id, number);

CREATE TABLE IF NOT EXISTS order_lines (
  order_id uuid NOT NULL REFERENCES orders(id),
  sku text NOT NULL,
  name text NOT NULL,
  quantity integer NOT NULL,
  unit_price_milli integer NOT NULL,
  line_total_cents integer NOT NULL,
  vat_rate integer NOT NULL,
  vat_cents integer NOT NULL,
  returned_quantity integer NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, sku)
);

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  number text NOT NULL,
  status text NOT NULL,
  reason text NOT NULL,
  refund_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  next_seq integer NOT NULL
);

CREATE TABLE IF NOT EXISTS return_lines (
  return_id uuid NOT NULL REFERENCES returns(id),
  sku text NOT NULL,
  quantity integer NOT NULL,
  refund_cents integer NOT NULL,
  PRIMARY KEY (return_id, sku)
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_outbox_order_idx ON mail_outbox (order_id);

CREATE TABLE IF NOT EXISTS request_keys (
  operator_id text NOT NULL,
  account_id uuid NOT NULL,
  request_key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body_hash text NOT NULL,
  in_progress boolean NOT NULL DEFAULT false,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, account_id, request_key)
);

CREATE TABLE IF NOT EXISTS operator_sequences (
  operator_id text PRIMARY KEY,
  last_number integer NOT NULL
);

-- Public tables checked by acceptance tests
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
