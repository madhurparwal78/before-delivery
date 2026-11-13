-- Quillmoor Reserve: the whole system of record.
-- Amounts, prices, share counts and indexes are exact integers held in
-- numeric(78,0) and read back as decimal strings.

CREATE TABLE schema_meta (
  id          integer PRIMARY KEY CHECK (id = 1),
  applied_at  timestamptz NOT NULL
);

CREATE TABLE actors (
  actor_id    text PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL,
  email_lower text NOT NULL UNIQUE,
  role        text NOT NULL CHECK (role IN
                ('risk_steward','liquidity_provider','borrower','trader','liquidator')),
  created_at  timestamptz NOT NULL
);

CREATE TABLE sessions (
  token      text PRIMARY KEY,
  actor_id   text NOT NULL REFERENCES actors(actor_id),
  created_at timestamptz NOT NULL
);

CREATE TABLE assets (
  asset                     text PRIMARY KEY CHECK (asset IN ('QUSD','MBTC','METH')),
  ltv_bps                   integer NOT NULL,
  liquidation_threshold_bps integer NOT NULL,
  liquidation_bonus_bps     integer NOT NULL,
  reserve_factor_bps        integer NOT NULL,
  close_factor_bps          integer NOT NULL,
  swap_fee_bps              integer NOT NULL,
  base_bps                  integer NOT NULL,
  slope1_bps                integer NOT NULL,
  kink_bps                  integer NOT NULL,
  slope2_bps                integer NOT NULL,
  borrow_index              numeric(78,0) NOT NULL,
  -- the whole second the borrow index was last brought forward to
  index_updated_at          timestamptz NOT NULL,
  total_shares              numeric(78,0) NOT NULL,
  -- the price post in force, set transactionally when a post is applied
  current_price_post_id     uuid,
  -- bumped on every risk save; the strong ETag validator
  risk_version              bigint NOT NULL
);

CREATE TABLE ledger_postings (
  posting_id uuid PRIMARY KEY,
  kind       text NOT NULL,
  ref        text,
  created_at timestamptz NOT NULL
);

CREATE INDEX ledger_postings_created_at ON ledger_postings (created_at DESC, posting_id DESC);

-- Postings are never edited or deleted; a correction is a new posting.
CREATE TABLE ledger_legs (
  leg_id     bigserial PRIMARY KEY,
  posting_id uuid NOT NULL REFERENCES ledger_postings(posting_id),
  leg_index  integer NOT NULL,
  account    text NOT NULL,
  asset      text NOT NULL,
  amount     numeric(78,0) NOT NULL CHECK (amount <> 0),
  created_at timestamptz NOT NULL,
  UNIQUE (posting_id, leg_index)
);

CREATE INDEX ledger_legs_account ON ledger_legs (asset, account);
CREATE INDEX ledger_legs_asset ON ledger_legs (asset);
CREATE INDEX ledger_legs_posting ON ledger_legs (posting_id);
-- supports the per-asset sum of every loan balance
CREATE INDEX ledger_legs_loan ON ledger_legs (asset) WHERE account LIKE 'loan:%';

CREATE TABLE lp_shares (
  actor_id text NOT NULL REFERENCES actors(actor_id),
  asset    text NOT NULL REFERENCES assets(asset),
  shares   numeric(78,0) NOT NULL,
  PRIMARY KEY (actor_id, asset)
);

-- position ids continue after the five seeded positions
CREATE SEQUENCE position_ids START 6;

CREATE TABLE positions (
  position_id         text PRIMARY KEY,
  borrower_id         text NOT NULL REFERENCES actors(actor_id),
  collateral_asset    text NOT NULL REFERENCES assets(asset),
  debt_asset          text NOT NULL REFERENCES assets(asset),
  -- accrual state: debt = ceil(principal * index_now / reference_index)
  principal           numeric(78,0) NOT NULL,
  reference_index     numeric(78,0) NOT NULL,
  state               text NOT NULL CHECK (state IN
                        ('healthy','warned','liquidatable_grace','liquidatable',
                         'partially_liquidated','closed')),
  grace_ends_at       timestamptz,
  after_fill_mark     boolean NOT NULL,
  margin_notice_armed boolean NOT NULL,
  round               integer NOT NULL,
  event_sequence      integer NOT NULL,
  created_at          timestamptz NOT NULL,
  CHECK (collateral_asset <> debt_asset)
);

CREATE INDEX positions_open ON positions (state) WHERE state <> 'closed';
CREATE INDEX positions_borrower ON positions (borrower_id);

CREATE TABLE price_posts (
  price_post_id  uuid PRIMARY KEY,
  asset          text NOT NULL REFERENCES assets(asset),
  price          numeric(78,0) NOT NULL CHECK (price > 0),
  previous_price numeric(78,0),
  posted_at      timestamptz NOT NULL,
  posted_by      text NOT NULL,
  source         text NOT NULL CHECK (source IN ('manual','oracle')),
  oracle_round   integer,
  evidence_key   text,
  created_at     timestamptz NOT NULL,
  -- insertion order, which breaks ties between posts in the same second
  seq_no         bigserial NOT NULL
);

-- an oracle round is applied at most once per asset, across every process
CREATE UNIQUE INDEX price_posts_oracle_round
  ON price_posts (asset, oracle_round) WHERE source = 'oracle';
CREATE INDEX price_posts_asset ON price_posts (asset, posted_at DESC, seq_no DESC);

CREATE TABLE quotes (
  quote_id       uuid PRIMARY KEY,
  actor_id       text NOT NULL REFERENCES actors(actor_id),
  from_asset     text NOT NULL REFERENCES assets(asset),
  to_asset       text NOT NULL REFERENCES assets(asset),
  amount_in      numeric(78,0) NOT NULL,
  fee            numeric(78,0) NOT NULL,
  fee_to_supply  numeric(78,0) NOT NULL,
  fee_to_reserve numeric(78,0) NOT NULL,
  amount_out     numeric(78,0) NOT NULL,
  price_from     numeric(78,0) NOT NULL,
  price_to       numeric(78,0) NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL
);

CREATE TABLE settlements (
  settlement_id        uuid PRIMARY KEY,
  kind                 text NOT NULL CHECK (kind IN ('draw','withdrawal','liquidation')),
  actor_id             text NOT NULL REFERENCES actors(actor_id),
  position_id          text REFERENCES positions(position_id),
  asset                text NOT NULL REFERENCES assets(asset),
  amount               numeric(78,0) NOT NULL,
  posting_id           uuid NOT NULL REFERENCES ledger_postings(posting_id),
  statement_key        text NOT NULL,
  text_statement_key   text NOT NULL,
  pdf_key              text NOT NULL,
  pdf_rendered_at      timestamptz,
  event_id             uuid NOT NULL,
  created_at           timestamptz NOT NULL,
  -- draw and liquidation
  debt_after           numeric(78,0),
  health_factor_after  numeric(78,0),
  state_after          text,
  -- withdrawal
  shares_burned        numeric(78,0),
  share_price_after    numeric(78,0),
  -- liquidation
  round                integer,
  borrower_id          text REFERENCES actors(actor_id),
  repaid               numeric(78,0),
  seized               numeric(78,0),
  bonus_amount         numeric(78,0),
  written_off          numeric(78,0),
  health_factor_before numeric(78,0),
  price_collateral     numeric(78,0),
  price_debt           numeric(78,0)
);

CREATE INDEX settlements_position ON settlements (position_id);

CREATE TABLE notices (
  notice_id       uuid PRIMARY KEY,
  position_id     text NOT NULL REFERENCES positions(position_id),
  settlement_id   uuid REFERENCES settlements(settlement_id),
  kind            text NOT NULL CHECK (kind IN ('margin','liquidation')),
  status          text NOT NULL CHECK (status IN ('queued','sent')),
  recipient       text NOT NULL,
  subject         text NOT NULL,
  body            text NOT NULL,
  attempts        integer NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  created_at      timestamptz NOT NULL,
  sent_at         timestamptz
);

CREATE INDEX notices_position ON notices (position_id, created_at);
CREATE INDEX notices_queued ON notices (next_attempt_at) WHERE status = 'queued';

-- the transactional outbox: one row per integrator event
CREATE TABLE outbox_events (
  event_id        uuid PRIMARY KEY,
  type            text NOT NULL CHECK (type IN ('settlement.committed','position.state_changed')),
  position_id     text REFERENCES positions(position_id),
  sequence        integer,
  occurred_at     timestamptz NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL CHECK (status IN ('queued','delivered')),
  attempts        integer NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL,
  seq_no          bigserial NOT NULL,
  UNIQUE (position_id, sequence)
);

CREATE INDEX outbox_queued ON outbox_events (next_attempt_at, seq_no) WHERE status = 'queued';

CREATE TABLE pdf_renders (
  settlement_id   uuid PRIMARY KEY REFERENCES settlements(settlement_id),
  status          text NOT NULL CHECK (status IN ('queued','rendered')),
  attempts        integer NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  rendered_at     timestamptz,
  created_at      timestamptz NOT NULL
);

CREATE INDEX pdf_renders_queued ON pdf_renders (next_attempt_at) WHERE status = 'queued';

-- Idempotency-Key semantics: scoped to the acting member and the endpoint
-- path, kept permanently, holding the first response with a status below 500.
CREATE TABLE idempotency_keys (
  actor_id    text NOT NULL REFERENCES actors(actor_id),
  path        text NOT NULL,
  key         text NOT NULL,
  fingerprint text NOT NULL,
  status      integer NOT NULL,
  -- the response is kept as its exact text, so a replay returns the same bytes
  body        text NOT NULL,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (actor_id, path, key)
);
