CREATE TABLE IF NOT EXISTS settings (
  id                   smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  packing_cutoff_local text NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  email    text PRIMARY KEY,
  name     text NOT NULL,
  password text NOT NULL,
  role     text NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS batch_code_seq START 415;
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS subscription_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS refund_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS credit_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS contact_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS notice_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS stepup_number_seq START 1;

CREATE TABLE IF NOT EXISTS batches (
  code      text PRIMARY KEY,
  scent     text NOT NULL,
  state     text NOT NULL,
  poured_on date NOT NULL,
  cure_days integer NOT NULL,
  bars_cut  integer,
  drop_at   timestamptz
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id         bigserial PRIMARY KEY,
  batch_code text NOT NULL REFERENCES batches (code),
  kind       text NOT NULL,
  bars       integer[] NOT NULL,
  ref        text,
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_movements_batch_idx ON stock_movements (batch_code, id);

CREATE TABLE IF NOT EXISTS customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL UNIQUE,
  locale              text NOT NULL,
  killbill_account_id text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id    text NOT NULL,
  batch_code text NOT NULL REFERENCES batches (code),
  bar        integer NOT NULL,
  status     text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS holds_cart_idx ON holds (cart_id);
CREATE INDEX IF NOT EXISTS holds_batch_idx ON holds (batch_code, status);

CREATE TABLE IF NOT EXISTS stepup_codes (
  number     text PRIMARY KEY,
  email      text NOT NULL,
  code       text NOT NULL,
  issued_at  timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at   timestamptz
);

CREATE INDEX IF NOT EXISTS stepup_codes_email_idx ON stepup_codes (email);

CREATE TABLE IF NOT EXISTS stepup_requests (
  id    bigserial PRIMARY KEY,
  email text NOT NULL,
  at    timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS stepup_requests_email_idx ON stepup_requests (email, at);

CREATE TABLE IF NOT EXISTS stepup_lockouts (
  email        text PRIMARY KEY,
  failures     integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS orders (
  number              text PRIMARY KEY,
  customer_id         uuid NOT NULL REFERENCES customers (id),
  email               text NOT NULL,
  locale              text NOT NULL,
  status              text NOT NULL,
  fulfilment          text NOT NULL,
  placed_at           timestamptz NOT NULL,
  ship_on             date NOT NULL,
  shipping            jsonb NOT NULL,
  subtotal_cents      integer NOT NULL,
  shipping_cents      integer NOT NULL,
  taxes               jsonb NOT NULL,
  total_cents         integer NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  killbill_invoice_id text NOT NULL,
  killbill_payment_id text NOT NULL,
  killbill_items      jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS order_lines (
  order_number     text NOT NULL REFERENCES orders (number),
  batch_code       text NOT NULL REFERENCES batches (code),
  scent            text NOT NULL,
  bar              integer NOT NULL,
  unit_price_cents integer NOT NULL,
  refunded         boolean NOT NULL DEFAULT false,
  PRIMARY KEY (order_number, batch_code, bar)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  number                   text PRIMARY KEY,
  customer_id              uuid NOT NULL REFERENCES customers (id),
  locale                   text NOT NULL,
  state                    text NOT NULL,
  scent                    text NOT NULL,
  cadence                  text NOT NULL,
  pending_cadence          text,
  started_on               date NOT NULL,
  next_bill_date           date,
  skipped_bill_date        date,
  paused_from              date,
  bill_anchor              date NOT NULL,
  shipping                 jsonb NOT NULL,
  version                  integer NOT NULL DEFAULT 1,
  killbill_subscription_id text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live_per_customer
  ON subscriptions (customer_id)
  WHERE state IN ('active', 'paused');

CREATE TABLE IF NOT EXISTS subscription_invoices (
  subscription_number text NOT NULL REFERENCES subscriptions (number),
  killbill_invoice_id text NOT NULL,
  invoice_date        date NOT NULL,
  total_cents         integer NOT NULL,
  payment_key         text NOT NULL,
  PRIMARY KEY (subscription_number, killbill_invoice_id)
);

CREATE TABLE IF NOT EXISTS refunds (
  number               text PRIMARY KEY,
  order_number         text NOT NULL REFERENCES orders (number),
  status               text NOT NULL,
  restock              boolean NOT NULL,
  bars                 jsonb NOT NULL,
  amount_cents         integer NOT NULL,
  alloc_bars_cents     integer NOT NULL,
  alloc_shipping_cents integer NOT NULL,
  alloc_taxes          jsonb NOT NULL,
  reason               text NOT NULL,
  killbill_ref         text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds (order_number, number);

CREATE TABLE IF NOT EXISTS credits (
  number       text PRIMARY KEY,
  target       text NOT NULL,
  customer_id  uuid NOT NULL REFERENCES customers (id),
  status       text NOT NULL,
  amount_cents integer NOT NULL,
  reason       text NOT NULL,
  killbill_ref text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credits_target_idx ON credits (target);

CREATE TABLE IF NOT EXISTS idempotency_records (
  route      text NOT NULL,
  scope      text NOT NULL,
  key        text NOT NULL,
  body_hash  text NOT NULL,
  state      text NOT NULL,
  status     integer,
  response   json,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (route, scope, key)
);

CREATE TABLE IF NOT EXISTS notices (
  number      text PRIMARY KEY,
  key         text NOT NULL UNIQUE,
  kind        text NOT NULL,
  recipient   text NOT NULL,
  locale      text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL,
  enqueued_at timestamptz NOT NULL,
  due_at      timestamptz NOT NULL,
  attempts    jsonb NOT NULL DEFAULT '[]'::jsonb,
  claimed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS notices_pending_idx ON notices (status, enqueued_at, number);

CREATE TABLE IF NOT EXISTS audit_entries (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,
  role         text NOT NULL,
  action       text NOT NULL,
  target       text NOT NULL,
  reason       text NOT NULL,
  amount_cents integer NOT NULL,
  killbill_ref text,
  outcome      text NOT NULL
);

CREATE OR REPLACE FUNCTION audit_entries_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_entries is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_entries_no_row_change ON audit_entries;
CREATE TRIGGER audit_entries_no_row_change
  BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only();

DROP TRIGGER IF EXISTS audit_entries_no_truncate ON audit_entries;
CREATE TRIGGER audit_entries_no_truncate
  BEFORE TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_append_only();

CREATE TABLE IF NOT EXISTS reconciliation_snapshots (
  month      text PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  lines      jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_accepts (
  key            text PRIMARY KEY,
  month          text NOT NULL,
  accepted_cents integer NOT NULL,
  at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orphan_refunds (
  payment_id   text PRIMARY KEY,
  amount_cents integer NOT NULL,
  killbill_ref text,
  at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  number     text PRIMARY KEY,
  name       text NOT NULL,
  email      text NOT NULL,
  topic      text NOT NULL,
  message    text NOT NULL,
  locale     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
