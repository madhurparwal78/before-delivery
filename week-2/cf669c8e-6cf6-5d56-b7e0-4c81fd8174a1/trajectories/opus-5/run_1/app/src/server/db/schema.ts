/**
 * The schema, applied idempotently on every serve under an advisory lock.
 *
 * Races are carried by constraints rather than by application locks: a unique
 * index decides which instance holds a slot, owns an idempotency key, owns a
 * provider attempt, applies a transaction, or sends a mail.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  name          text NOT NULL,
  country       text NOT NULL,
  role          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- One shop-wide secret for the Kill Bill callback path, created once.
CREATE TABLE IF NOT EXISTS shop_secrets (
  name       text PRIMARY KEY,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 10001 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS orders (
  id               uuid PRIMARY KEY,
  number           text NOT NULL UNIQUE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  state            text NOT NULL,
  partly_refunded  boolean NOT NULL DEFAULT false,
  plan_version     integer NOT NULL DEFAULT 1,
  plan             jsonb NOT NULL,
  -- The full resolved donor, which the deposit gate compares to a fresh read.
  donor            jsonb,
  config           jsonb,
  bike_id          text,
  notices          jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivered_on     date,
  fee_quote_date   text,
  fit_verdict      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_lines (
  id            uuid PRIMARY KEY,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position      integer NOT NULL,
  code          text NOT NULL,
  name          text NOT NULL,
  gross_cents   integer NOT NULL,
  vat_rate_pct  integer NOT NULL,
  vat_cents     integer NOT NULL
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines(order_id, position);

CREATE TABLE IF NOT EXISTS order_stages (
  order_id             uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage                text NOT NULL,
  position             integer NOT NULL,
  due_date             date,
  amount_cents         integer NOT NULL,
  status               text NOT NULL,
  attempts             integer NOT NULL DEFAULT 0,
  confirmed_at         timestamptz,
  vat_corrected_cents  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, stage)
);

CREATE TABLE IF NOT EXISTS stage_allocations (
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage       text NOT NULL,
  line_id     uuid NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  gross_cents integer NOT NULL,
  vat_cents   integer NOT NULL,
  PRIMARY KEY (order_id, stage, line_id)
);

-- One row per provider attempt. The unique external key makes the row the
-- claim: whoever inserts it owns the Kill Bill call.
CREATE TABLE IF NOT EXISTS payments (
  id                     uuid PRIMARY KEY,
  order_id               uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage                  text NOT NULL,
  attempt                integer NOT NULL,
  external_key           text NOT NULL UNIQUE,
  killbill_payment_id    text,
  killbill_transaction_id text,
  amount_cents           integer NOT NULL,
  status                 text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);
CREATE INDEX IF NOT EXISTS payments_kb_payment_idx ON payments(killbill_payment_id);

CREATE TABLE IF NOT EXISTS refunds (
  id           uuid PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_id      uuid NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  status       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds(order_id, created_at);

CREATE TABLE IF NOT EXISTS refund_draws (
  id                      uuid PRIMARY KEY,
  refund_id               uuid NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  order_id                uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage                   text NOT NULL,
  line_id                 uuid NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  killbill_payment_id     text,
  external_key            text NOT NULL UNIQUE,
  killbill_transaction_id text,
  amount_cents            integer NOT NULL,
  vat_cents               integer NOT NULL,
  status                  text NOT NULL,
  sent                    boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_draws_refund_idx ON refund_draws(refund_id);
CREATE INDEX IF NOT EXISTS refund_draws_order_idx ON refund_draws(order_id);

CREATE TABLE IF NOT EXISTS killbill_accounts (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  account_id   text NOT NULL,
  external_key text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- A money request carrying one idempotency key makes one transaction. The
-- primary key is the claim; the owner fills in the stored answer.
CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key          text NOT NULL,
  endpoint     text NOT NULL,
  request_hash text NOT NULL,
  completed    boolean NOT NULL DEFAULT false,
  status_code  integer,
  body         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- A transaction's outcome is applied once, however many deliveries arrive.
CREATE TABLE IF NOT EXISTS applied_transactions (
  transaction_id text PRIMARY KEY,
  outcome        text NOT NULL,
  applied_at     timestamptz NOT NULL DEFAULT now()
);

-- Each mail is recorded as part of the fact it reports, so instances sharing
-- a database send it once.
CREATE TABLE IF NOT EXISTS mail_records (
  dedupe_key text PRIMARY KEY,
  kind       text NOT NULL,
  recipient  text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  sent       boolean NOT NULL DEFAULT false,
  attempts   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bike_slots (
  id         uuid PRIMARY KEY,
  bike_id    text NOT NULL,
  starts_at  timestamptz NOT NULL,
  local_date date NOT NULL,
  local_time text NOT NULL,
  UNIQUE (bike_id, starts_at)
);
CREATE INDEX IF NOT EXISTS bike_slots_date_idx ON bike_slots(local_date);

CREATE TABLE IF NOT EXISTS test_rides (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bike_id    text NOT NULL,
  slot_id    uuid NOT NULL REFERENCES bike_slots(id) ON DELETE CASCADE,
  state      text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_rides_user_idx ON test_rides(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS test_rides_slot_idx ON test_rides(slot_id);

-- A slot is held or booked by at most one ride.
CREATE UNIQUE INDEX IF NOT EXISTS test_rides_one_live_per_slot
  ON test_rides(slot_id)
  WHERE state IN ('held', 'confirmed', 'ridden', 'no-show');

-- A rider has at most one live hold.
CREATE UNIQUE INDEX IF NOT EXISTS test_rides_one_hold_per_rider
  ON test_rides(user_id)
  WHERE state = 'held';

CREATE TABLE IF NOT EXISTS seed_markers (
  name       text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

/** Guards schema and seed application against concurrent instance starts. */
export const SCHEMA_LOCK_KEY = 528_341_907;
