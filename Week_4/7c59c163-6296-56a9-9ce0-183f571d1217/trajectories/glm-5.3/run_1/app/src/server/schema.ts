import type { Pool } from './db.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  taker_fee_bps INTEGER NOT NULL DEFAULT 125,
  maker_fee_bps INTEGER NOT NULL DEFAULT 0,
  flagship_market_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY,
  venue_id UUID REFERENCES venues(id),
  keycloak_id TEXT UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  roles TEXT[] NOT NULL DEFAULT '{}',
  killbill_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_venue_email ON members (venue_id, lower(email));

CREATE TABLE IF NOT EXISTS markets (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  kind TEXT NOT NULL CHECK (kind IN ('pair','event')),
  symbol TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  closes_at TIMESTAMPTZ,
  outcome TEXT,
  last_price INTEGER,
  seed_last_price INTEGER,
  auto_closed BOOLEAN NOT NULL DEFAULT false,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, symbol)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  member_id UUID NOT NULL REFERENCES members(id),
  mode TEXT,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  outcome TEXT,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  filled_quantity INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  hold_cents INTEGER NOT NULL DEFAULT 0,
  reserved_units INTEGER NOT NULL DEFAULT 0,
  taker_fee_bps INTEGER NOT NULL,
  maker_fee_bps INTEGER NOT NULL,
  sequence BIGSERIAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_market_price ON orders (market_id, price, sequence);
CREATE INDEX IF NOT EXISTS orders_member ON orders (member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fills (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  member_id UUID NOT NULL REFERENCES members(id),
  mode TEXT,
  side TEXT NOT NULL,
  outcome TEXT,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  notional_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  liquidity TEXT NOT NULL,
  filled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fills_member ON fills (member_id, filled_at DESC);
CREATE INDEX IF NOT EXISTS fills_market ON fills (market_id, filled_at);

CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trades_venue_at ON trades (venue_id, at);

CREATE TABLE IF NOT EXISTS spot_holdings (
  member_id UUID NOT NULL REFERENCES members(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, market_id)
);

CREATE TABLE IF NOT EXISTS event_holdings (
  member_id UUID NOT NULL REFERENCES members(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  outcome TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, market_id, outcome)
);

CREATE TABLE IF NOT EXISTS margin_positions (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  member_id UUID NOT NULL REFERENCES members(id),
  side TEXT NOT NULL CHECK (side IN ('long','short')),
  quantity INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL,
  collateral_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  liquidated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS margin_positions_open ON margin_positions (market_id, member_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  kind TEXT NOT NULL,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journal_entries_venue ON journal_entries (venue_id, created_at);

CREATE TABLE IF NOT EXISTS journal_legs (
  id UUID PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES journal_entries(id),
  venue_id UUID NOT NULL REFERENCES venues(id),
  account TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_legs_account ON journal_legs (venue_id, account);

CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  member_id UUID NOT NULL REFERENCES members(id),
  amount_cents INTEGER NOT NULL,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  card_last4 TEXT NOT NULL,
  killbill_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deposits_member ON deposits (member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY,
  deposit_id UUID NOT NULL REFERENCES deposits(id),
  venue_id UUID NOT NULL REFERENCES venues(id),
  member_id UUID NOT NULL REFERENCES members(id),
  amount_cents INTEGER NOT NULL,
  killbill_transaction_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES members(id),
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES members(id),
  endpoint TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  body_json JSONB NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, endpoint, idem_key)
);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  keycloak_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS id_documents (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  member_id UUID NOT NULL REFERENCES members(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statements (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id),
  member_id UUID NOT NULL REFERENCES members(id),
  month TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, month)
);

CREATE TABLE IF NOT EXISTS statement_runs (
  venue_id UUID NOT NULL REFERENCES venues(id),
  month TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, month)
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  member_id UUID PRIMARY KEY REFERENCES members(id),
  venue_id UUID NOT NULL REFERENCES venues(id),
  url TEXT NOT NULL,
  svix_endpoint_id TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS builder_billing (
  member_id UUID PRIMARY KEY REFERENCES members(id),
  plan TEXT NOT NULL DEFAULT 'sandbox',
  state TEXT NOT NULL DEFAULT 'active',
  overdue_state TEXT,
  state_recorded_at TIMESTAMPTZ,
  final_notice_sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outgoing_queue (
  id UUID PRIMARY KEY,
  venue_id UUID,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_by TEXT,
  claimed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outgoing_queue_pending ON outgoing_queue (next_attempt_at) WHERE claimed_until IS NULL;

CREATE TABLE IF NOT EXISTS seed_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
}
