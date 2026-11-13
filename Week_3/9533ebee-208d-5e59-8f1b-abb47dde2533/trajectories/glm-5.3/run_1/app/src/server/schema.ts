import type { Pool } from './db.js';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS members (
  actor_id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_lower text NOT NULL UNIQUE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  actor_id text NOT NULL REFERENCES members(actor_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  code text PRIMARY KEY,
  name text NOT NULL,
  decimals int NOT NULL
);

CREATE TABLE IF NOT EXISTS postings (
  posting_id bigserial PRIMARY KEY,
  kind text NOT NULL,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legs (
  id bigserial PRIMARY KEY,
  posting_id bigint NOT NULL REFERENCES postings(posting_id),
  seq int NOT NULL,
  account text NOT NULL,
  asset text NOT NULL REFERENCES assets(code),
  amount numeric(78,0) NOT NULL,
  UNIQUE (posting_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_legs_account_asset ON legs (account, asset);

CREATE TABLE IF NOT EXISTS balances (
  account text NOT NULL,
  asset text NOT NULL REFERENCES assets(code),
  balance numeric(78,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (account, asset)
);

CREATE TABLE IF NOT EXISTS pools (
  asset text PRIMARY KEY REFERENCES assets(code),
  total_shares numeric(78,0) NOT NULL DEFAULT 0,
  borrow_index numeric(78,0) NOT NULL DEFAULT 1000000000000000000000000000000,
  index_brought_to bigint NOT NULL DEFAULT 0,
  params_version bigint NOT NULL DEFAULT 1,
  ltv_bps int NOT NULL,
  liquidation_threshold_bps int NOT NULL,
  liquidation_bonus_bps int NOT NULL,
  reserve_factor_bps int NOT NULL,
  close_factor_bps int NOT NULL,
  swap_fee_bps int NOT NULL,
  curve_base_bps int NOT NULL,
  curve_slope1_bps int NOT NULL,
  curve_kink_bps int NOT NULL,
  curve_slope2_bps int NOT NULL,
  warning_hf_num bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
  actor_id text NOT NULL REFERENCES members(actor_id),
  asset text NOT NULL REFERENCES assets(code),
  shares numeric(78,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (actor_id, asset)
);

CREATE TABLE IF NOT EXISTS price_posts (
  price_post_id uuid PRIMARY KEY,
  asset text NOT NULL REFERENCES assets(code),
  price numeric(78,0) NOT NULL,
  previous_price numeric(78,0) NOT NULL,
  posted_at timestamptz NOT NULL,
  posted_by text NOT NULL,
  source text NOT NULL,
  oracle_round bigint,
  evidence_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_posts_asset ON price_posts (asset, posted_at DESC);

CREATE TABLE IF NOT EXISTS current_prices (
  asset text PRIMARY KEY REFERENCES assets(code),
  price_post_id uuid NOT NULL REFERENCES price_posts(price_post_id)
);

CREATE TABLE IF NOT EXISTS oracle_status (
  asset text PRIMARY KEY REFERENCES assets(code),
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oracle_applied (
  asset text NOT NULL REFERENCES assets(code),
  round bigint NOT NULL,
  publish_time bigint NOT NULL,
  price numeric(78,0) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset, round)
);

CREATE TABLE IF NOT EXISTS positions (
  position_id text PRIMARY KEY,
  borrower_id text NOT NULL REFERENCES members(actor_id),
  collateral_asset text NOT NULL REFERENCES assets(code),
  debt_asset text NOT NULL REFERENCES assets(code),
  collateral_amount numeric(78,0) NOT NULL DEFAULT 0,
  debt numeric(78,0) NOT NULL DEFAULT 0,
  posted_debt numeric(78,0) NOT NULL DEFAULT 0,
  principal numeric(78,0) NOT NULL DEFAULT 0,
  reference_index numeric(78,0) NOT NULL DEFAULT 1000000000000000000000000000000,
  state text NOT NULL,
  grace_ends_at bigint,
  after_fill_mark boolean NOT NULL DEFAULT false,
  margin_armed boolean NOT NULL DEFAULT true,
  round bigint NOT NULL DEFAULT 0,
  last_interest_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_positions_borrower ON positions (borrower_id);

CREATE TABLE IF NOT EXISTS quotes (
  quote_id uuid PRIMARY KEY,
  trader_id text NOT NULL REFERENCES members(actor_id),
  from_asset text NOT NULL,
  to_asset text NOT NULL,
  amount_in numeric(78,0) NOT NULL,
  fee numeric(78,0) NOT NULL,
  fee_to_supply numeric(78,0) NOT NULL,
  fee_to_reserve numeric(78,0) NOT NULL,
  amount_out numeric(78,0) NOT NULL,
  price_from numeric(78,0) NOT NULL,
  price_to numeric(78,0) NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  swap_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  settlement_id uuid PRIMARY KEY,
  kind text NOT NULL,
  actor_id text NOT NULL,
  position_id text,
  asset text NOT NULL,
  amount numeric(78,0) NOT NULL,
  statement_key text NOT NULL,
  pdf_key text NOT NULL,
  pdf_rendered_at timestamptz,
  event_id uuid NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  notice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id bigserial PRIMARY KEY,
  actor_id text NOT NULL,
  endpoint text NOT NULL,
  idem_key text NOT NULL,
  body_fingerprint text NOT NULL,
  status int NOT NULL,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, endpoint, idem_key)
);

CREATE TABLE IF NOT EXISTS notices (
  notice_id uuid PRIMARY KEY,
  position_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notices_pending ON notices (status, created_at) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS events (
  event_id uuid PRIMARY KEY,
  position_id text,
  type text NOT NULL,
  sequence bigint,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_events_pending ON events (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS position_sequences (
  position_id text PRIMARY KEY,
  last_sequence bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS render_queue (
  id bigserial PRIMARY KEY,
  settlement_id uuid NOT NULL REFERENCES settlements(settlement_id),
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_by text,
  claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_render_pending ON render_queue (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS schema_lock (
  id int PRIMARY KEY DEFAULT 1,
  seeded_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function applySchema(db: Pool): Promise<void> {
  await db.withClient(async (client): Promise<void> => {
    // Serialise concurrent creators: a second server starting against the same
    // empty database must wait rather than race CREATE TABLE.
    await client.query('SELECT pg_advisory_lock(556677)');
    try {
      await client.query(SCHEMA_SQL);
    } finally {
      await client.query('SELECT pg_advisory_unlock(556677)');
    }
  });
}
