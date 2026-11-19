-- One transaction-safe schema, applied idempotently on every boot.
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text UNIQUE NOT NULL,
  display_name text NOT NULL,
  email text NOT NULL,
  roles text[] NOT NULL DEFAULT '{}',
  seller_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pieces (
  slug text PRIMARY KEY,
  title text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  engine text NOT NULL DEFAULT 'GLSL',
  creator_id text NOT NULL REFERENCES users(id),
  fragment_source text NOT NULL,
  uniforms jsonb NOT NULL,
  timeline jsonb NOT NULL,
  remix_of_slug text,
  edition_count integer,
  price_cents integer,
  export_render_id text,
  featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  piece_slug text NOT NULL REFERENCES pieces(slug),
  kind text NOT NULL,
  filename text NOT NULL,
  bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renders (
  id text PRIMARY KEY,
  piece_slug text NOT NULL REFERENCES pieces(slug),
  state text NOT NULL,
  failure_reason text,
  cost_credits integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  format text NOT NULL,
  resolution text NOT NULL,
  duration_s integer NOT NULL,
  aspect text NOT NULL,
  sha256 text,
  history jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  piece_slug text NOT NULL REFERENCES pieces(slug),
  collector_id text NOT NULL REFERENCES users(id),
  edition integer NOT NULL,
  state text NOT NULL,
  expires_at timestamptz,
  billing_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  billing_country text NOT NULL DEFAULT '',
  net_cents integer NOT NULL,
  vat_rate_percent integer NOT NULL DEFAULT 0,
  vat_cents integer NOT NULL DEFAULT 0,
  gross_cents integer NOT NULL,
  invoice_number text,
  invoice_status text NOT NULL DEFAULT 'none',
  receipt_status text NOT NULL DEFAULT 'none',
  refunded_net_cents integer NOT NULL DEFAULT 0,
  paid_at timestamptz,
  killbill_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS split_rows (
  id bigserial PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  refund_id text,
  party text NOT NULL,
  holder_id text NOT NULL,
  kind text NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  net_cents integer NOT NULL,
  vat_cents integer NOT NULL,
  gross_cents integer NOT NULL,
  credit_note_number text NOT NULL,
  credit_note_pdf boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT '',
  killbill_refund_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_entries (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  render_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_rows (
  id bigserial PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES credit_entries(id),
  account text NOT NULL,
  amount integer NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  year integer PRIMARY KEY,
  last_invoice integer NOT NULL DEFAULT 0,
  last_credit_note integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS idempotency (
  user_key text NOT NULL,
  path text NOT NULL,
  idem_key text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  in_progress boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, path, idem_key)
);

CREATE TABLE IF NOT EXISTS callback_events (
  identity text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  user_id text PRIMARY KEY REFERENCES users(id),
  code text NOT NULL,
  state text NOT NULL,
  ends_on date,
  killbill_account_id text,
  killbill_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_invoices (
  subscription_invoice_id text PRIMARY KEY,
  plan_user_id text NOT NULL,
  credits integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_packs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  state text NOT NULL,
  credits integer NOT NULL,
  price_cents integer NOT NULL,
  killbill_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statements (
  period text PRIMARY KEY,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS statement_sends (
  period text NOT NULL,
  user_id text NOT NULL,
  PRIMARY KEY (period, user_id)
);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'waiting',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_renders_state ON renders(state);
CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(state);
CREATE INDEX IF NOT EXISTS idx_orders_collector ON orders(collector_id);
CREATE INDEX IF NOT EXISTS idx_pieces_state ON pieces(state);

-- Enforce one active (held or paying) order per edition number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_active_hold
  ON orders (piece_slug, edition)
  WHERE state IN ('held', 'paying');

