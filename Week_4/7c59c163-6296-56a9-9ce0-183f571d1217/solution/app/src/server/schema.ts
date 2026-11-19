import { pool } from "./db.js";

// Applied idempotently on every start.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS venues (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  time_zone text NOT NULL,
  taker_fee_bps integer NOT NULL,
  maker_fee_bps integer NOT NULL,
  flagship_symbol text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  venue_id uuid REFERENCES venues(id),
  username text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  roles text[] NOT NULL,
  killbill_account_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_venue_email ON members (venue_id, lower(email));
CREATE TABLE IF NOT EXISTS invites (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  roles text[] NOT NULL,
  venue_id uuid REFERENCES venues(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sign_in_attempts (
  state text PRIMARY KEY,
  binding_hash text NOT NULL,
  verifier text NOT NULL,
  nonce text NOT NULL,
  next_path text NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS markets (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  kind text NOT NULL,
  symbol text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  closes_at timestamptz,
  outcome text,
  last_price integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, symbol)
);
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  seq bigserial UNIQUE,
  venue_id uuid NOT NULL REFERENCES venues(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  member_id uuid NOT NULL REFERENCES members(id),
  mode text,
  side text NOT NULL,
  outcome text,
  price integer NOT NULL,
  book_side text NOT NULL,
  book_price integer NOT NULL,
  hold_kind text NOT NULL,
  quantity integer NOT NULL,
  filled_quantity integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  hold_cents bigint NOT NULL,
  taker_fee_bps integer NOT NULL,
  maker_fee_bps integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_book ON orders (market_id, book_side, book_price, seq) WHERE status IN ('resting', 'partially_filled');
CREATE INDEX IF NOT EXISTS orders_member ON orders (member_id, created_at DESC);
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  price integer NOT NULL,
  quantity integer NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trades_venue_at ON trades (venue_id, at);
CREATE TABLE IF NOT EXISTS fills (
  id uuid PRIMARY KEY,
  seq bigserial UNIQUE,
  venue_id uuid NOT NULL REFERENCES venues(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  member_id uuid NOT NULL REFERENCES members(id),
  trade_id uuid NOT NULL REFERENCES trades(id),
  mode text,
  side text NOT NULL,
  outcome text,
  price integer NOT NULL,
  quantity integer NOT NULL,
  notional_cents bigint NOT NULL,
  fee_cents bigint NOT NULL,
  liquidity text NOT NULL,
  filled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fills_member ON fills (member_id, seq DESC);
CREATE INDEX IF NOT EXISTS fills_venue_at ON fills (venue_id, filled_at);
CREATE TABLE IF NOT EXISTS spot_holdings (
  member_id uuid NOT NULL REFERENCES members(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  quantity integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, market_id)
);
CREATE TABLE IF NOT EXISTS margin_positions (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  member_id uuid NOT NULL REFERENCES members(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  side text NOT NULL,
  quantity integer NOT NULL,
  cost_cents bigint NOT NULL,
  collateral_cents bigint NOT NULL,
  status text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS margin_open_one ON margin_positions (member_id, market_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS event_positions (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  member_id uuid NOT NULL REFERENCES members(id),
  market_id uuid NOT NULL REFERENCES markets(id),
  outcome text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  UNIQUE (member_id, market_id, outcome)
);
CREATE TABLE IF NOT EXISTS deposits (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  member_id uuid NOT NULL REFERENCES members(id),
  amount_cents bigint NOT NULL,
  status text NOT NULL,
  card_last4 text NOT NULL,
  killbill_payment_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  deposit_id uuid NOT NULL REFERENCES deposits(id),
  amount_cents bigint NOT NULL,
  killbill_transaction_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  kind text NOT NULL,
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS journal_legs (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES journal_entries(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  account text NOT NULL,
  amount_cents bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_legs_account ON journal_legs (account);
CREATE INDEX IF NOT EXISTS journal_legs_entry ON journal_legs (entry_id);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  member_id uuid NOT NULL REFERENCES members(id),
  endpoint text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, endpoint, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  venue_id uuid REFERENCES venues(id),
  kind text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_attempt_at) WHERE done_at IS NULL;
CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  name text NOT NULL,
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS builder_billing (
  member_id uuid PRIMARY KEY REFERENCES members(id),
  plan text NOT NULL,
  state text NOT NULL,
  overdue_state text NOT NULL,
  pending_plan text,
  pending_effective_date text,
  invoices jsonb NOT NULL DEFAULT '[]',
  payment_failed_at timestamptz,
  final_notice_sent boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  member_id uuid PRIMARY KEY REFERENCES members(id),
  url text NOT NULL,
  svix_endpoint_id text NOT NULL,
  signing_secret text NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  member_id uuid NOT NULL REFERENCES members(id),
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS statement_runs (
  venue_id uuid NOT NULL REFERENCES venues(id),
  month text NOT NULL,
  members integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (venue_id, month)
);
CREATE TABLE IF NOT EXISTS statements (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues(id),
  member_id uuid NOT NULL REFERENCES members(id),
  month text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, month)
);
CREATE TABLE IF NOT EXISTS seed_steps (
  step text PRIMARY KEY,
  done_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(4173001)");
    await client.query(SCHEMA);
  } finally {
    await client.query("SELECT pg_advisory_unlock(4173001)").catch(() => undefined);
    client.release();
  }
}
