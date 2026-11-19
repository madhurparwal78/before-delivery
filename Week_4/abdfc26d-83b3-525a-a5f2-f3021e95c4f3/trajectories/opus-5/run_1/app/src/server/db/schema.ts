/** The whole schema, applied idempotently by every instance on every boot. */
export const schemaSql = `
CREATE TABLE IF NOT EXISTS app_users (
  id             uuid PRIMARY KEY,
  username       text NOT NULL UNIQUE,
  display_name   text NOT NULL,
  email          text NOT NULL,
  roles          text[] NOT NULL DEFAULT '{}',
  seller_address text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pieces (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  title             text NOT NULL,
  creator_id        uuid NOT NULL REFERENCES app_users(id),
  state             text NOT NULL CHECK (state IN ('draft','published','withdrawn')),
  version           integer NOT NULL DEFAULT 1,
  fragment_source   text NOT NULL,
  uniforms          jsonb NOT NULL,
  timeline          jsonb NOT NULL,
  remix_of_id       uuid REFERENCES pieces(id),
  edition_count     integer,
  price_cents       integer,
  export_render_id  uuid,
  featured          boolean NOT NULL DEFAULT false,
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pieces_state_published_idx ON pieces (state, published_at DESC);
CREATE INDEX IF NOT EXISTS pieces_creator_idx ON pieces (creator_id);

CREATE TABLE IF NOT EXISTS piece_assets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id   uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('font','model','audio')),
  filename   text NOT NULL,
  bytes      integer NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS piece_assets_piece_idx ON piece_assets (piece_id, created_at);

CREATE TABLE IF NOT EXISTS render_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id        uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  creator_id      uuid NOT NULL REFERENCES app_users(id),
  state           text NOT NULL CHECK (state IN ('accepted','queued','rendering','stored','ready','failed','timed_out','credits_released')),
  failure_reason  text CHECK (failure_reason IN ('provider_error','timeout','malformed','storage_error','cancelled')),
  cost_credits    integer NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  format          text NOT NULL CHECK (format IN ('mp4','webm')),
  resolution      text NOT NULL CHECK (resolution IN ('720p','1080p')),
  duration_s      integer NOT NULL,
  aspect          text NOT NULL CHECK (aspect IN ('16:9','9:16','1:1','4:5')),
  sha256          text,
  object_key      text,
  history         jsonb NOT NULL DEFAULT '[]'::jsonb,
  credits_settled boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS render_jobs_piece_idx ON render_jobs (piece_id, created_at DESC);
CREATE INDEX IF NOT EXISTS render_jobs_state_idx ON render_jobs (state);

CREATE TABLE IF NOT EXISTS credit_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL CHECK (kind IN ('grant','pack','reserve','capture','release')),
  user_id    uuid NOT NULL REFERENCES app_users(id),
  render_id  uuid REFERENCES render_jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_entries_user_idx ON credit_entries (user_id, created_at);

CREATE TABLE IF NOT EXISTS credit_rows (
  id       bigserial PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES credit_entries(id) ON DELETE CASCADE,
  account  text NOT NULL,
  amount   integer NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_rows_account_idx ON credit_rows (account);
CREATE INDEX IF NOT EXISTS credit_rows_entry_idx ON credit_rows (entry_id);

CREATE TABLE IF NOT EXISTS edition_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id           uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  collector_id       uuid NOT NULL REFERENCES app_users(id),
  edition_number     integer NOT NULL,
  edition_count      integer NOT NULL,
  state              text NOT NULL CHECK (state IN ('held','paying','paid','invoiced','receipted','refunded','failed','expired')),
  expires_at         timestamptz,
  billing_name       text,
  email              text,
  billing_country    text,
  net_cents          integer NOT NULL,
  vat_rate_percent   integer NOT NULL DEFAULT 0,
  vat_cents          integer NOT NULL DEFAULT 0,
  gross_cents        integer NOT NULL DEFAULT 0,
  invoice_number     text UNIQUE,
  invoice_status     text NOT NULL DEFAULT 'none' CHECK (invoice_status IN ('none','pending','ready')),
  invoice_object_key text,
  receipt_status     text NOT NULL DEFAULT 'none' CHECK (receipt_status IN ('none','queued','sent')),
  refunded_net_cents integer NOT NULL DEFAULT 0,
  paid_at            timestamptz,
  killbill_invoice_id text,
  killbill_payment_id text,
  invoice_claimed_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- One winner per edition number: at most one live claim on a piece's number.
CREATE UNIQUE INDEX IF NOT EXISTS edition_orders_live_number_idx
  ON edition_orders (piece_id, edition_number)
  WHERE state IN ('held','paying','paid','invoiced','receipted');
CREATE INDEX IF NOT EXISTS edition_orders_collector_idx ON edition_orders (collector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS edition_orders_piece_idx ON edition_orders (piece_id);
CREATE INDEX IF NOT EXISTS edition_orders_state_idx ON edition_orders (state);
CREATE INDEX IF NOT EXISTS edition_orders_kb_invoice_idx ON edition_orders (killbill_invoice_id);

CREATE TABLE IF NOT EXISTS order_refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES edition_orders(id) ON DELETE CASCADE,
  credit_note_number text NOT NULL UNIQUE,
  net_cents          integer NOT NULL,
  vat_cents          integer NOT NULL,
  gross_cents        integer NOT NULL,
  reason             text NOT NULL DEFAULT '',
  object_key         text,
  note_status        text NOT NULL DEFAULT 'pending' CHECK (note_status IN ('pending','ready')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_refunds_order_idx ON order_refunds (order_id, created_at);

CREATE TABLE IF NOT EXISTS split_rows (
  id            bigserial PRIMARY KEY,
  order_id      uuid NOT NULL REFERENCES edition_orders(id) ON DELETE CASCADE,
  party         text NOT NULL CHECK (party IN ('creator','remixer','platform')),
  holder_user_id uuid REFERENCES app_users(id),
  holder_name   text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('sale','refund')),
  amount_cents  integer NOT NULL,
  refund_id     uuid REFERENCES order_refunds(id) ON DELETE CASCADE,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS split_rows_order_idx ON split_rows (order_id, id);
CREATE INDEX IF NOT EXISTS split_rows_holder_idx ON split_rows (holder_user_id, occurred_at);

CREATE TABLE IF NOT EXISTS number_sequences (
  kind       text NOT NULL,
  year       integer NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, year)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id       uuid NOT NULL,
  method        text NOT NULL,
  path          text NOT NULL,
  idem_key      text NOT NULL,
  request_hash  text NOT NULL,
  completed     boolean NOT NULL DEFAULT false,
  status_code   integer,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  PRIMARY KEY (user_id, method, path, idem_key)
);
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_records (expires_at);

CREATE TABLE IF NOT EXISTS processed_billing_events (
  identity   text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient       text NOT NULL,
  subject         text NOT NULL,
  body_text       text NOT NULL,
  attachment_key  text,
  attachment_name text,
  -- Set on a receipt, so the order becomes receipted once mail accepts it.
  receipt_for_order_id uuid REFERENCES edition_orders(id) ON DELETE CASCADE,
  state           text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_by      text,
  claimed_at      timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox_messages (state, next_attempt_at);

CREATE TABLE IF NOT EXISTS creator_plans (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES app_users(id),
  code                    text NOT NULL CHECK (code IN ('studio-monthly','pro-monthly')),
  state                   text NOT NULL CHECK (state IN ('pending_payment','active','cancelling','ended')),
  ends_on                 date,
  killbill_account_id     text,
  killbill_subscription_id text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS creator_plans_live_idx
  ON creator_plans (user_id) WHERE state IN ('pending_payment','active','cancelling');
CREATE INDEX IF NOT EXISTS creator_plans_user_idx ON creator_plans (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plan_invoice_grants (
  killbill_invoice_id text PRIMARY KEY,
  plan_id             uuid NOT NULL REFERENCES creator_plans(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_pack_purchases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES app_users(id),
  pack                text NOT NULL CHECK (pack IN ('pack-500')),
  state               text NOT NULL CHECK (state IN ('paying','paid','failed')),
  credits             integer NOT NULL,
  price_cents         integer NOT NULL,
  killbill_invoice_id text,
  killbill_payment_id text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_packs_user_idx ON credit_pack_purchases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_packs_kb_invoice_idx ON credit_pack_purchases (killbill_invoice_id);

CREATE TABLE IF NOT EXISTS killbill_accounts (
  user_id    uuid PRIMARY KEY REFERENCES app_users(id),
  account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statement_periods (
  period     text PRIMARY KEY,
  closed_at  timestamptz NOT NULL DEFAULT now(),
  creators   integer NOT NULL
);

CREATE TABLE IF NOT EXISTS statement_files (
  period     text NOT NULL,
  creator_id uuid NOT NULL REFERENCES app_users(id),
  object_key text NOT NULL,
  PRIMARY KEY (period, creator_id)
);

CREATE TABLE IF NOT EXISTS auth_login_flows (
  state         text PRIMARY KEY,
  code_verifier text NOT NULL,
  return_to     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);
`;
