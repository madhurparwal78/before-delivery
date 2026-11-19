import type { Tx } from "./db.js";

// Applied idempotently on every start, under an advisory lock so instances sharing a database never race.

const DDL = `
CREATE TABLE IF NOT EXISTS seed_applied (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  email text NOT NULL,
  seller_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pieces (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  creator_id text NOT NULL REFERENCES users(id),
  state text NOT NULL CHECK (state IN ('draft', 'published', 'withdrawn')),
  version integer NOT NULL DEFAULT 1,
  fragment_source text NOT NULL,
  uniforms jsonb NOT NULL,
  timeline jsonb NOT NULL,
  remix_of_id uuid REFERENCES pieces(id),
  edition_count integer,
  price_cents integer,
  export_render_id uuid,
  featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES pieces(id),
  kind text NOT NULL CHECK (kind IN ('font', 'model', 'audio')),
  filename text NOT NULL,
  bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renders (
  id uuid PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES pieces(id),
  creator_id text NOT NULL REFERENCES users(id),
  state text NOT NULL,
  failure_reason text,
  cost_credits integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  format text NOT NULL,
  resolution text NOT NULL,
  duration_s integer NOT NULL,
  aspect text NOT NULL,
  sha256 text,
  history jsonb NOT NULL,
  fragment_source text NOT NULL,
  uniforms jsonb NOT NULL,
  timeline jsonb NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS renders_piece ON renders (piece_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  piece_id uuid NOT NULL REFERENCES pieces(id),
  collector_id text NOT NULL REFERENCES users(id),
  edition integer NOT NULL,
  state text NOT NULL,
  expires_at timestamptz,
  billing_name text,
  email text,
  billing_country text,
  net_cents integer NOT NULL,
  vat_rate_percent integer NOT NULL DEFAULT 0,
  vat_cents integer NOT NULL DEFAULT 0,
  gross_cents integer NOT NULL,
  invoice_number text UNIQUE,
  invoice_status text NOT NULL DEFAULT 'none',
  receipt_status text NOT NULL DEFAULT 'none',
  refunded_net_cents integer NOT NULL DEFAULT 0,
  refunded_vat_cents integer NOT NULL DEFAULT 0,
  paid_at timestamptz,
  seed boolean NOT NULL DEFAULT false,
  kb_account_id text,
  kb_invoice_id text,
  kb_payment_id text,
  invoice_claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_per_number ON orders (piece_id, edition)
  WHERE state IN ('held', 'paying', 'paid', 'invoiced', 'receipted');
CREATE INDEX IF NOT EXISTS orders_collector ON orders (collector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_state ON orders (state);

CREATE TABLE IF NOT EXISTS split_rows (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  party text NOT NULL CHECK (party IN ('creator', 'remixer', 'platform')),
  holder_id text REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('sale', 'refund')),
  amount_cents integer NOT NULL,
  refund_id uuid,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS split_rows_order ON split_rows (order_id);
CREATE INDEX IF NOT EXISTS split_rows_holder ON split_rows (holder_id, at);

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  credit_note_number text NOT NULL UNIQUE,
  net_cents integer NOT NULL,
  vat_cents integer NOT NULL,
  gross_cents integer NOT NULL,
  reason text NOT NULL,
  pdf_status text NOT NULL DEFAULT 'pending',
  claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS number_sequences (
  kind text NOT NULL,
  year integer NOT NULL,
  last integer NOT NULL,
  PRIMARY KEY (kind, year)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('grant', 'pack', 'reserve', 'capture', 'release')),
  render_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_once_per_render ON ledger_entries (render_id, kind) WHERE render_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS ledger_rows (
  entry_id uuid NOT NULL REFERENCES ledger_entries(id),
  account text NOT NULL,
  amount integer NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_rows_account ON ledger_rows (account);

CREATE TABLE IF NOT EXISTS credit_purchases (
  id uuid PRIMARY KEY,
  creator_id text NOT NULL REFERENCES users(id),
  state text NOT NULL CHECK (state IN ('paying', 'paid', 'failed')),
  credits integer NOT NULL,
  price_cents integer NOT NULL,
  kb_invoice_id text,
  ledger_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY,
  creator_id text NOT NULL REFERENCES users(id),
  code text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending_payment', 'active', 'cancelling', 'ended')),
  ends_on date,
  kb_account_id text NOT NULL,
  subscription_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS plans_one_open ON plans (creator_id) WHERE state IN ('pending_payment', 'active', 'cancelling');

CREATE TABLE IF NOT EXISTS plan_grants (
  subscription_invoice_id text PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES plans(id),
  ledger_entry_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, method, path, key)
);

CREATE TABLE IF NOT EXISTS processed_events (
  identity text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('receipt', 'render_ready', 'refund_notice', 'statement')),
  to_address text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  attachment_name text,
  attachment bytea,
  order_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_attempt_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS statement_periods (
  period text PRIMARY KEY,
  closed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS statements (
  period text NOT NULL REFERENCES statement_periods(period),
  creator_id text NOT NULL REFERENCES users(id),
  total_cents integer NOT NULL,
  pdf_status text NOT NULL DEFAULT 'pending',
  claimed_until timestamptz,
  PRIMARY KEY (period, creator_id)
);
`;

export async function migrate(client: Tx): Promise<void> {
  await client.query(DDL);
}
