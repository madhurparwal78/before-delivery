// The whole schema, applied once into an empty database (see prepareDatabase).
// Amounts, prices, shares and indexes are numeric(78,0) integers; nothing money-like is a float.

export const SCHEMA = `
CREATE TABLE members (
  actor_id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX members_email ON members (lower(email));

CREATE TABLE sessions (
  token text PRIMARY KEY,
  actor_id text NOT NULL REFERENCES members,
  created_at timestamptz NOT NULL
);

CREATE TABLE assets (
  asset text PRIMARY KEY,
  name text NOT NULL,
  decimals integer NOT NULL,
  listing integer NOT NULL,
  ltv_bps integer NOT NULL,
  liquidation_threshold_bps integer NOT NULL,
  liquidation_bonus_bps integer NOT NULL,
  reserve_factor_bps integer NOT NULL,
  close_factor_bps integer NOT NULL,
  swap_fee_bps integer NOT NULL,
  warning_health_factor_bps integer NOT NULL,
  base_bps integer NOT NULL,
  slope1_bps integer NOT NULL,
  kink_bps integer NOT NULL,
  slope2_bps integer NOT NULL,
  risk_version integer NOT NULL,
  borrow_index numeric(78,0) NOT NULL,
  index_second bigint NOT NULL,
  total_shares numeric(78,0) NOT NULL
);

CREATE TABLE share_holdings (
  actor_id text NOT NULL REFERENCES members,
  asset text NOT NULL REFERENCES assets,
  shares numeric(78,0) NOT NULL,
  PRIMARY KEY (actor_id, asset)
);

CREATE SEQUENCE posting_seq;
CREATE TABLE postings (
  posting_id text PRIMARY KEY,
  seq bigint NOT NULL UNIQUE,
  kind text NOT NULL,
  ref text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE legs (
  posting_id text NOT NULL REFERENCES postings,
  posting_seq bigint NOT NULL,
  leg_no integer NOT NULL,
  account text NOT NULL,
  asset text NOT NULL REFERENCES assets,
  amount numeric(78,0) NOT NULL CHECK (amount <> 0),
  PRIMARY KEY (posting_id, leg_no)
);
CREATE INDEX legs_by_asset ON legs (asset, posting_seq DESC);
CREATE TABLE account_balances (
  account text NOT NULL,
  asset text NOT NULL REFERENCES assets,
  balance numeric(78,0) NOT NULL,
  PRIMARY KEY (account, asset)
);

CREATE SEQUENCE price_post_seq;
CREATE TABLE price_posts (
  price_post_id uuid PRIMARY KEY,
  seq bigint NOT NULL UNIQUE,
  asset text NOT NULL REFERENCES assets,
  price numeric(78,0) NOT NULL,
  previous_price numeric(78,0),
  posted_at timestamptz NOT NULL,
  posted_by text NOT NULL,
  source text NOT NULL,
  oracle_round bigint,
  positions_below_one integer NOT NULL,
  evidence_key text
);
CREATE INDEX price_posts_latest ON price_posts (asset, seq DESC);
CREATE UNIQUE INDEX price_posts_oracle_round ON price_posts (asset, oracle_round) WHERE oracle_round IS NOT NULL;

CREATE SEQUENCE position_seq;
CREATE TABLE positions (
  position_id text PRIMARY KEY,
  seq bigint NOT NULL UNIQUE,
  borrower_id text NOT NULL REFERENCES members,
  collateral_asset text NOT NULL REFERENCES assets,
  debt_asset text NOT NULL REFERENCES assets,
  state text NOT NULL,
  grace_ends_at timestamptz,
  after_fill boolean NOT NULL,
  margin_armed boolean NOT NULL,
  round integer NOT NULL,
  principal numeric(78,0) NOT NULL,
  reference_index numeric(78,0) NOT NULL,
  event_seq integer NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE quotes (
  quote_id text PRIMARY KEY,
  trader_id text NOT NULL REFERENCES members,
  from_asset text NOT NULL REFERENCES assets,
  to_asset text NOT NULL REFERENCES assets,
  amount_in numeric(78,0) NOT NULL,
  fee numeric(78,0) NOT NULL,
  fee_to_supply numeric(78,0) NOT NULL,
  fee_to_reserve numeric(78,0) NOT NULL,
  amount_out numeric(78,0) NOT NULL,
  price_from numeric(78,0) NOT NULL,
  price_to numeric(78,0) NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  swap_id text UNIQUE
);

CREATE TABLE settlements (
  settlement_id uuid PRIMARY KEY,
  kind text NOT NULL,
  position_id text REFERENCES positions,
  event_id uuid NOT NULL,
  body jsonb NOT NULL,
  statement_text text NOT NULL,
  pdf_rendered_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX settlements_unrendered ON settlements (created_at) WHERE pdf_rendered_at IS NULL;

CREATE TABLE notices (
  notice_id text PRIMARY KEY,
  position_id text NOT NULL REFERENCES positions,
  kind text NOT NULL,
  settlement_id uuid,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE INDEX notices_queued ON notices (created_at) WHERE status = 'queued';

CREATE TABLE outbox (
  seq bigserial PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  position_id text,
  payload jsonb NOT NULL,
  delivered_at timestamptz
);
CREATE INDEX outbox_undelivered ON outbox (seq) WHERE delivered_at IS NULL;

CREATE TABLE idempotency_keys (
  actor_id text NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, endpoint, key)
);
`;
