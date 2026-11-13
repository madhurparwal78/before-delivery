export const schema = `
CREATE TABLE IF NOT EXISTS categories (
  slug text PRIMARY KEY,
  name text NOT NULL,
  gst_rate int NOT NULL,
  commission_percent numeric NOT NULL,
  return_days int NOT NULL
);

CREATE TABLE IF NOT EXISTS pincodes (
  pincode text PRIMARY KEY,
  city text,
  state text,
  serviceable boolean NOT NULL DEFAULT false,
  cod_available boolean NOT NULL DEFAULT false,
  remote boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sellers (
  seller_id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  password_hash text NOT NULL,
  pickup_city text NOT NULL,
  pickup_state text NOT NULL,
  gstin text NOT NULL,
  dispatch_days int NOT NULL,
  rating numeric NOT NULL,
  cod_allowed boolean NOT NULL DEFAULT true,
  ship_states text[] NOT NULL,
  ship_all_states boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS shoppers (
  account_id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  password_hash text NOT NULL,
  balance_paise bigint NOT NULL DEFAULT 0,
  balance_hold_paise bigint NOT NULL DEFAULT 0,
  role text NOT NULL DEFAULT 'shopper'
);

CREATE TABLE IF NOT EXISTS products (
  product_id text PRIMARY KEY,
  title text NOT NULL,
  brand text NOT NULL,
  category text NOT NULL REFERENCES categories(slug),
  rating numeric NOT NULL,
  description text NOT NULL DEFAULT '',
  specs jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS listings (
  listing_id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(product_id),
  seller_id text NOT NULL REFERENCES sellers(seller_id),
  price_paise bigint NOT NULL,
  cost_price_paise bigint NOT NULL DEFAULT 0,
  stock int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live','unlisted')),
  cod_allowed boolean NOT NULL DEFAULT true,
  no_cost_emi boolean NOT NULL DEFAULT false,
  return_note text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  deal_price_paise bigint,
  deal_ends_at timestamptz,
  created_seq bigint NOT NULL,
  kb_account_id uuid
);

CREATE TABLE IF NOT EXISTS listing_photos (
  photo_id text PRIMARY KEY,
  listing_id text NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  object_key text NOT NULL,
  position int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS addresses (
  address_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES shoppers(account_id) ON DELETE CASCADE,
  label text NOT NULL,
  name text NOT NULL,
  line1 text NOT NULL,
  line2 text NOT NULL DEFAULT '',
  city text NOT NULL,
  state text NOT NULL,
  pincode text NOT NULL,
  phone text NOT NULL,
  created_seq bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_cards (
  card_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES shoppers(account_id) ON DELETE CASCADE,
  network text NOT NULL,
  last4 text NOT NULL,
  expiry_month int NOT NULL,
  expiry_year int NOT NULL,
  name text NOT NULL,
  created_seq bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id text PRIMARY KEY,
  account_id text NOT NULL,
  role text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

CREATE TABLE IF NOT EXISTS signup_drafts (
  pending_id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_signins (
  pending_id text PRIMARY KEY,
  account_id text NOT NULL,
  role text NOT NULL,
  identifier text NOT NULL,
  code_hash text NOT NULL,
  tries int NOT NULL DEFAULT 0,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS code_sends (
  send_id bigserial PRIMARY KEY,
  identifier text NOT NULL,
  purpose text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_code_sends_identifier ON code_sends(identifier, sent_at);

CREATE TABLE IF NOT EXISTS rate_counters (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cart_lines (
  line_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES shoppers(account_id) ON DELETE CASCADE,
  listing_id text NOT NULL REFERENCES listings(listing_id),
  quantity int NOT NULL,
  selected boolean NOT NULL DEFAULT true,
  gift_wrap boolean NOT NULL DEFAULT false,
  gift_message text NOT NULL DEFAULT '',
  saved boolean NOT NULL DEFAULT false,
  created_seq bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cart_lines_account ON cart_lines(account_id);

CREATE TABLE IF NOT EXISTS wishlist_items (
  item_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES shoppers(account_id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(product_id),
  listing_id text NOT NULL REFERENCES listings(listing_id),
  created_seq bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wishlist_account ON wishlist_items(account_id);

CREATE TABLE IF NOT EXISTS share_links (
  token text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('wishlist','cart')),
  account_id text NOT NULL REFERENCES shoppers(account_id) ON DELETE CASCADE,
  display_name text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_share_links_account ON share_links(account_id, kind);

CREATE TABLE IF NOT EXISTS cart_settings (
  account_id text PRIMARY KEY REFERENCES shoppers(account_id) ON DELETE CASCADE,
  destination jsonb NOT NULL DEFAULT '{"address_id":null,"pincode":"560034"}',
  coupon_code text,
  method text,
  use_balance boolean NOT NULL DEFAULT false,
  emi_tenure_months int,
  speeds jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS coupons (
  code text PRIMARY KEY,
  kind text NOT NULL,
  value bigint NOT NULL,
  min_subtotal_paise bigint NOT NULL DEFAULT 0,
  max_discount_paise bigint,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS gift_cards (
  code text PRIMARY KEY,
  value_paise bigint NOT NULL,
  used_by text REFERENCES shoppers(account_id),
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idem_key text NOT NULL,
  account_id text NOT NULL REFERENCES shoppers(account_id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  status int NOT NULL,
  response_body jsonb NOT NULL,
  state text NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (idem_key, account_id)
);

CREATE TABLE IF NOT EXISTS orders (
  order_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES shoppers(account_id),
  address_id text NOT NULL,
  address_snapshot jsonb NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  payable_paise bigint NOT NULL,
  subtotal_paise bigint NOT NULL,
  discount_paise bigint NOT NULL,
  gift_wrap_paise bigint NOT NULL,
  delivery_paise bigint NOT NULL,
  cod_fee_paise bigint NOT NULL,
  emi_discount_paise bigint NOT NULL,
  balance_applied_paise bigint NOT NULL DEFAULT 0,
  due_paise bigint NOT NULL,
  coupon_code text,
  pincode text NOT NULL,
  idem_key text,
  created_seq bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id, created_seq);

CREATE TABLE IF NOT EXISTS order_timeline (
  order_id text NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  state text NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (order_id, state)
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(order_id),
  method text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz,
  initiated_at timestamptz,
  placed_at timestamptz NOT NULL DEFAULT now(),
  use_balance boolean NOT NULL DEFAULT false,
  emi_tenure_months int
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS payment_legs (
  leg_id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(payment_id) ON DELETE CASCADE,
  method text NOT NULL,
  amount_paise bigint NOT NULL,
  status text NOT NULL,
  kb_payment_id uuid,
  kb_txn_key text NOT NULL,
  shipment_id text
);
CREATE INDEX IF NOT EXISTS idx_legs_payment ON payment_legs(payment_id);

CREATE TABLE IF NOT EXISTS refunds (
  refund_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(order_id),
  payment_id text REFERENCES payments(payment_id),
  kind text NOT NULL,
  state text NOT NULL,
  amount_paise bigint NOT NULL,
  reason text NOT NULL DEFAULT '',
  shipment_line_id text,
  quantity int,
  created_at timestamptz NOT NULL DEFAULT now(),
  kb_txn_key text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);

CREATE TABLE IF NOT EXISTS refund_legs (
  refund_leg_id text PRIMARY KEY,
  refund_id text NOT NULL REFERENCES refunds(refund_id) ON DELETE CASCADE,
  method text NOT NULL,
  amount_paise bigint NOT NULL,
  status text NOT NULL,
  kb_payment_id uuid,
  kb_txn_key text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_refund_legs_refund ON refund_legs(refund_id);

CREATE TABLE IF NOT EXISTS shipments (
  shipment_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  seller_id text NOT NULL REFERENCES sellers(seller_id),
  state text NOT NULL,
  promise_date date NOT NULL,
  speed text NOT NULL DEFAULT 'standard',
  delivery_fee_paise bigint NOT NULL,
  cod_fee_paise bigint NOT NULL,
  gift_wrap_paise bigint NOT NULL,
  invoice_status text NOT NULL DEFAULT 'pending',
  label_status text NOT NULL DEFAULT 'pending',
  delivered_on date,
  created_seq bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_seller ON shipments(seller_id, created_seq);

CREATE TABLE IF NOT EXISTS shipment_timeline (
  shipment_id text NOT NULL REFERENCES shipments(shipment_id) ON DELETE CASCADE,
  state text NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (shipment_id, state)
);

CREATE TABLE IF NOT EXISTS shipment_lines (
  line_id text PRIMARY KEY,
  shipment_id text NOT NULL REFERENCES shipments(shipment_id) ON DELETE CASCADE,
  listing_id text NOT NULL,
  title text NOT NULL,
  quantity int NOT NULL,
  unit_price_paise bigint NOT NULL,
  coupon_share_paise bigint NOT NULL,
  line_total_paise bigint NOT NULL,
  gst_rate int NOT NULL,
  taxable_value_paise bigint NOT NULL,
  cgst_paise bigint NOT NULL,
  sgst_paise bigint NOT NULL,
  igst_paise bigint NOT NULL,
  returnable_until date,
  created_seq bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shipment_lines_shipment ON shipment_lines(shipment_id);

CREATE TABLE IF NOT EXISTS returns (
  return_id text PRIMARY KEY,
  shipment_line_id text NOT NULL REFERENCES shipment_lines(line_id),
  shipment_id text NOT NULL REFERENCES shipments(shipment_id),
  order_id text NOT NULL REFERENCES orders(order_id),
  account_id text NOT NULL REFERENCES shoppers(account_id),
  state text NOT NULL,
  quantity int NOT NULL,
  reason text NOT NULL DEFAULT '',
  decline_reason text NOT NULL DEFAULT '',
  refund_estimate_paise bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_returns_seller ON returns(shipment_id);

CREATE TABLE IF NOT EXISTS settlements (
  settlement_line_id text PRIMARY KEY,
  shipment_id text NOT NULL,
  shipment_line_id text NOT NULL,
  seller_id text NOT NULL,
  kind text NOT NULL,
  posted_on date NOT NULL,
  gross_paise bigint NOT NULL,
  commission_percent numeric NOT NULL,
  commission_paise bigint NOT NULL,
  commission_gst_paise bigint NOT NULL,
  tcs_paise bigint NOT NULL,
  tds_paise bigint NOT NULL,
  emi_subvention_paise bigint NOT NULL DEFAULT 0,
  net_paise bigint NOT NULL,
  status text NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  line_quantity int NOT NULL DEFAULT 1,
  refund_id text
);
CREATE INDEX IF NOT EXISTS idx_settlements_seller ON settlements(seller_id, posted_on);

CREATE TABLE IF NOT EXISTS documents (
  object_key text PRIMARY KEY,
  kind text NOT NULL,
  shipment_id text NOT NULL,
  built_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_accounts (
  account_id text PRIMARY KEY,
  kb_account_uuid uuid NOT NULL,
  kb_invoice_id uuid
);

CREATE TABLE IF NOT EXISTS payout_accounts (
  seller_id text PRIMARY KEY REFERENCES sellers(seller_id),
  account_holder text NOT NULL,
  ifsc text NOT NULL,
  account_number text NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_messages (
  shipment_line_id text PRIMARY KEY REFERENCES shipment_lines(line_id) ON DELETE CASCADE,
  message text NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_tasks (
  task_id bigserial PRIMARY KEY,
  kind text NOT NULL,
  ref text NOT NULL,
  payload jsonb NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_state (
  id int PRIMARY KEY DEFAULT 1,
  schema_ready boolean NOT NULL DEFAULT false,
  seeded_at timestamptz
);
INSERT INTO health_state (id, schema_ready) VALUES (1, false) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS seller_gst (
  seller_id text PRIMARY KEY REFERENCES sellers(seller_id),
  object_key text NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seed_markers (
  name text PRIMARY KEY,
  value text NOT NULL
);
`;
