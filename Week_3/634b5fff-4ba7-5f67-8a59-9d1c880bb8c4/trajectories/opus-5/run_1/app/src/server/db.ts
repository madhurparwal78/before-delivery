import { Pool, type PoolClient } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 16 });

export async function query<T>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(text, values as unknown[]);
  return result.rows as T[];
}

export async function one<T>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS boxes (
  number integer PRIMARY KEY,
  plate text NOT NULL,
  state text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS passages (
  passage_id text PRIMARY KEY,
  chapter text NOT NULL,
  text text NOT NULL,
  ordinal integer NOT NULL
);

CREATE TABLE IF NOT EXISTS plate_art (
  plate text PRIMARY KEY,
  object_key text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS charity_rates (
  id bigserial PRIMARY KEY,
  rate_basis_points integer NOT NULL,
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  reference text PRIMARY KEY,
  box_number integer NOT NULL REFERENCES boxes(number),
  plate text NOT NULL,
  method text NOT NULL,
  payment_state text NOT NULL,
  order_token text NOT NULL,
  hold_token text NOT NULL,
  buyer_name text NOT NULL,
  buyer_email text NOT NULL,
  street text NOT NULL,
  postcode text NOT NULL,
  city text NOT NULL,
  is_gift boolean NOT NULL DEFAULT false,
  recipient_name text,
  recipient_email text,
  gift_message text,
  rate_basis_points integer NOT NULL,
  gross_ore integer NOT NULL,
  courier_ore integer NOT NULL,
  total_ore integer NOT NULL,
  net_ore integer NOT NULL,
  vat_ore integer NOT NULL,
  charity_ore integer NOT NULL,
  maker_ore integer NOT NULL,
  payment_id text,
  transfer_id text,
  challenge_id text,
  challenge_expires_at timestamptz,
  authorised_at timestamptz,
  auth_expires_at timestamptz,
  transfer_deadline_at timestamptz,
  capture_requested boolean NOT NULL DEFAULT false,
  gateway_captured boolean NOT NULL DEFAULT false,
  ledger_captured boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  killbill_account_id text,
  killbill_invoice_id text,
  ledger_authorised boolean NOT NULL DEFAULT false,
  certificate_state text NOT NULL DEFAULT 'none',
  certificate_key text,
  tracking_code text,
  live_claim boolean NOT NULL DEFAULT false,
  last_sequence integer NOT NULL DEFAULT 0,
  authorised_too_late boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_one_live_claim
  ON orders (box_number) WHERE live_claim;

CREATE INDEX IF NOT EXISTS orders_hold_token ON orders (hold_token);

CREATE TABLE IF NOT EXISTS refunds (
  refund_id text PRIMARY KEY,
  reference text NOT NULL REFERENCES orders(reference),
  state text NOT NULL,
  amount_ore integer NOT NULL,
  net_ore integer NOT NULL,
  vat_ore integer NOT NULL,
  charity_ore integer NOT NULL,
  maker_ore integer NOT NULL,
  gateway_refund_id text,
  gateway_confirmed boolean NOT NULL DEFAULT false,
  ledger_recorded boolean NOT NULL DEFAULT false,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS split_lines (
  id bigserial PRIMARY KEY,
  reference text NOT NULL REFERENCES orders(reference),
  box_number integer NOT NULL,
  kind text NOT NULL,
  refund_id text,
  gross_ore integer NOT NULL,
  net_ore integer NOT NULL,
  vat_ore integer NOT NULL,
  charity_ore integer NOT NULL,
  maker_ore integer NOT NULL,
  rate_basis_points integer NOT NULL,
  posted_at timestamptz NOT NULL,
  posted_month text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS split_lines_one_sale
  ON split_lines (reference) WHERE kind = 'sale';
CREATE UNIQUE INDEX IF NOT EXISTS split_lines_one_refund
  ON split_lines (refund_id) WHERE refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_callbacks (
  event_id text PRIMARY KEY,
  reference text,
  sequence integer NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  outcome text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS fulfilment_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  reference text NOT NULL,
  box_number integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  published_at timestamptz,
  deliveries integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending',
  last_error text,
  failed_at timestamptz,
  dismissal_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_effects (
  event_id text NOT NULL,
  effect text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, effect)
);

CREATE TABLE IF NOT EXISTS statements (
  id text PRIMARY KEY,
  month text NOT NULL,
  revision integer NOT NULL,
  charity_total_ore integer NOT NULL,
  maker_total_ore integer NOT NULL,
  vat_total_ore integer NOT NULL,
  lines jsonb NOT NULL,
  pdf_key text NOT NULL,
  token text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_alerts (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS stock_thresholds (
  threshold integer PRIMARY KEY,
  armed boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS lookup_attempts (
  id bigserial PRIMARY KEY,
  client text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lookup_attempts_client ON lookup_attempts (client, attempted_at);

CREATE TABLE IF NOT EXISTS pending_webhooks (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS search_backlog (
  box_number integer PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}
