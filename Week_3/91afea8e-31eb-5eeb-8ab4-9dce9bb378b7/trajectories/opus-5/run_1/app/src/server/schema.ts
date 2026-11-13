/** The single schema. Applied idempotently on every serve. */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_state (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  role text NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  balance_paise bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sellers (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  display_name text NOT NULL,
  legal_name text NOT NULL,
  gstin text NOT NULL,
  pickup_pincode text NOT NULL,
  pickup_city text NOT NULL,
  pickup_state text NOT NULL,
  dispatch_days int NOT NULL,
  rating numeric NOT NULL,
  cod_allowed boolean NOT NULL,
  ship_states text[] NOT NULL
);

CREATE TABLE IF NOT EXISTS payout_accounts (
  seller_id text PRIMARY KEY REFERENCES sellers(id),
  account_holder text NOT NULL,
  ifsc text NOT NULL,
  account_number text NOT NULL
);

CREATE TABLE IF NOT EXISTS addresses (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  label text NOT NULL,
  name text NOT NULL,
  line1 text NOT NULL,
  line2 text NOT NULL DEFAULT '',
  city text NOT NULL,
  pincode text NOT NULL,
  phone text NOT NULL,
  created_seq bigserial
);

CREATE TABLE IF NOT EXISTS cards (
  card_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  network text NOT NULL,
  last4 text NOT NULL,
  expiry_month int NOT NULL,
  expiry_year int NOT NULL,
  name text NOT NULL,
  created_seq bigserial
);

CREATE TABLE IF NOT EXISTS categories (
  slug text PRIMARY KEY,
  name text NOT NULL,
  gst_rate numeric NOT NULL,
  commission_percent numeric NOT NULL,
  return_days int NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pincodes (
  pincode text PRIMARY KEY,
  city text NOT NULL,
  state text NOT NULL,
  serviceable boolean NOT NULL,
  cod boolean NOT NULL,
  remote boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  title text NOT NULL,
  brand text NOT NULL,
  category_slug text NOT NULL REFERENCES categories(slug),
  rating numeric NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_seq bigserial
);

CREATE TABLE IF NOT EXISTS listings (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  seller_id text NOT NULL REFERENCES sellers(id),
  price_paise bigint NOT NULL,
  cost_price_paise bigint NOT NULL,
  stock int NOT NULL,
  status text NOT NULL DEFAULT 'live',
  cod_allowed boolean NOT NULL DEFAULT true,
  no_cost_emi boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  return_note text NOT NULL DEFAULT '',
  deal_price_paise bigint,
  deal_ends_at timestamptz,
  created_seq bigserial,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_seller_idx ON listings(seller_id);
CREATE INDEX IF NOT EXISTS listings_product_idx ON listings(product_id);
CREATE INDEX IF NOT EXISTS listings_updated_idx ON listings(updated_at);

CREATE TABLE IF NOT EXISTS listing_photos (
  photo_id text PRIMARY KEY,
  listing_id text NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  ext text NOT NULL,
  created_seq bigserial
);

CREATE TABLE IF NOT EXISTS seller_documents (
  seller_id text PRIMARY KEY REFERENCES sellers(id),
  ext text NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coupons (
  code text PRIMARY KEY,
  percent numeric,
  max_discount_paise bigint,
  flat_paise bigint,
  min_subtotal_paise bigint NOT NULL,
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS gift_cards (
  code text PRIMARY KEY,
  amount_paise bigint NOT NULL,
  redeemed_by text REFERENCES accounts(id),
  redeemed_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);

CREATE TABLE IF NOT EXISTS access_tokens (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_codes (
  id text PRIMARY KEY,
  purpose text NOT NULL,
  identifier text NOT NULL,
  account_id text REFERENCES accounts(id),
  signup jsonb,
  code_hash text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  tries int NOT NULL DEFAULT 0,
  consumed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS auth_codes_identifier_idx ON auth_codes(identifier, purpose);

CREATE TABLE IF NOT EXISTS code_sends (
  id bigserial PRIMARY KEY,
  identifier text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS code_sends_identifier_idx ON code_sends(identifier, sent_at);

CREATE TABLE IF NOT EXISTS rate_events (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_events_idx ON rate_events(bucket, key, at);

CREATE TABLE IF NOT EXISTS idempotency_records (
  account_id text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  state text NOT NULL,
  status int,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, key)
);

CREATE TABLE IF NOT EXISTS cart_lines (
  line_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  listing_id text NOT NULL REFERENCES listings(id),
  quantity int NOT NULL,
  selected boolean NOT NULL DEFAULT true,
  gift_wrap boolean NOT NULL DEFAULT false,
  gift_message text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'cart',
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS cart_lines_account_idx ON cart_lines(account_id, state);

CREATE TABLE IF NOT EXISTS cart_state (
  account_id text PRIMARY KEY REFERENCES accounts(id),
  address_id text,
  pincode text,
  payment_method text,
  use_balance boolean NOT NULL DEFAULT false,
  emi_tenure_months int,
  coupon_code text
);

CREATE TABLE IF NOT EXISTS cart_speeds (
  account_id text NOT NULL REFERENCES accounts(id),
  seller_id text NOT NULL REFERENCES sellers(id),
  speed text NOT NULL,
  PRIMARY KEY (account_id, seller_id)
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  item_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  product_id text NOT NULL REFERENCES products(id),
  listing_id text NOT NULL REFERENCES listings(id),
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS wishlist_account_idx ON wishlist_items(account_id);

CREATE TABLE IF NOT EXISTS share_links (
  token text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  kind text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS share_links_owner_idx ON share_links(account_id, kind);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  placed_at timestamptz NOT NULL DEFAULT now(),
  payable_paise bigint NOT NULL,
  status text NOT NULL,
  coupon_code text,
  address jsonb NOT NULL,
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS orders_account_idx ON orders(account_id);

CREATE TABLE IF NOT EXISTS payments (
  payment_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  account_id text NOT NULL REFERENCES accounts(id),
  method text,
  status text NOT NULL,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  provider_ref text
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);

CREATE TABLE IF NOT EXISTS payment_legs (
  leg_id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(payment_id),
  order_id text NOT NULL REFERENCES orders(id),
  shipment_id text,
  method text NOT NULL,
  amount_paise bigint NOT NULL,
  status text NOT NULL,
  external_key text NOT NULL,
  kb_payment_id text,
  kb_recorded boolean NOT NULL DEFAULT false,
  refunded_paise bigint NOT NULL DEFAULT 0,
  card_last4 text,
  card_network text,
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS payment_legs_order_idx ON payment_legs(order_id);

CREATE TABLE IF NOT EXISTS shipments (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  seller_id text NOT NULL REFERENCES sellers(id),
  account_id text NOT NULL REFERENCES accounts(id),
  state text NOT NULL,
  promise_date date NOT NULL,
  speed text NOT NULL,
  delivery_fee_paise bigint NOT NULL,
  cod_fee_paise bigint NOT NULL,
  gift_wrap_paise bigint NOT NULL,
  payment_kind text NOT NULL,
  invoice_stored boolean NOT NULL DEFAULT false,
  label_stored boolean NOT NULL DEFAULT false,
  delivered_on date,
  cod_recorded boolean NOT NULL DEFAULT false,
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS shipments_order_idx ON shipments(order_id);
CREATE INDEX IF NOT EXISTS shipments_seller_idx ON shipments(seller_id);

CREATE TABLE IF NOT EXISTS shipment_lines (
  line_id text PRIMARY KEY,
  shipment_id text NOT NULL REFERENCES shipments(id),
  listing_id text NOT NULL REFERENCES listings(id),
  title text NOT NULL,
  quantity int NOT NULL,
  unit_price_paise bigint NOT NULL,
  coupon_share_paise bigint NOT NULL,
  line_total_paise bigint NOT NULL,
  gst_rate numeric NOT NULL,
  taxable_value_paise bigint NOT NULL,
  cgst_paise bigint NOT NULL,
  sgst_paise bigint NOT NULL,
  igst_paise bigint NOT NULL,
  gift_wrap boolean NOT NULL DEFAULT false,
  gift_message text NOT NULL DEFAULT '',
  emi_subvention_paise bigint NOT NULL DEFAULT 0,
  refunded_paise bigint NOT NULL DEFAULT 0,
  refunded_quantity int NOT NULL DEFAULT 0,
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS shipment_lines_shipment_idx ON shipment_lines(shipment_id);

CREATE TABLE IF NOT EXISTS shipment_timeline (
  id bigserial PRIMARY KEY,
  shipment_id text NOT NULL REFERENCES shipments(id),
  state text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS returns (
  id text PRIMARY KEY,
  shipment_line_id text NOT NULL REFERENCES shipment_lines(line_id),
  shipment_id text NOT NULL REFERENCES shipments(id),
  account_id text NOT NULL REFERENCES accounts(id),
  seller_id text NOT NULL REFERENCES sellers(id),
  quantity int NOT NULL,
  reason text NOT NULL DEFAULT '',
  state text NOT NULL,
  refund_id text,
  decline_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS returns_line_idx ON returns(shipment_line_id);

CREATE TABLE IF NOT EXISTS refunds (
  id text PRIMARY KEY,
  kind text NOT NULL,
  order_id text NOT NULL REFERENCES orders(id),
  shipment_id text NOT NULL REFERENCES shipments(id),
  shipment_line_id text,
  quantity int,
  amount_paise bigint NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refund_legs (
  id text PRIMARY KEY,
  refund_id text NOT NULL REFERENCES refunds(id),
  leg_id text NOT NULL REFERENCES payment_legs(leg_id),
  method text NOT NULL,
  amount_paise bigint NOT NULL,
  status text NOT NULL,
  balance_credited boolean NOT NULL DEFAULT false,
  created_seq bigserial
);

CREATE TABLE IF NOT EXISTS settlement_lines (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(id),
  shipment_id text NOT NULL REFERENCES shipments(id),
  line_id text NOT NULL REFERENCES shipment_lines(line_id),
  kind text NOT NULL,
  posted_on date NOT NULL,
  gross_paise bigint NOT NULL,
  commission_percent numeric NOT NULL,
  commission_paise bigint NOT NULL,
  commission_gst_paise bigint NOT NULL,
  tcs_paise bigint NOT NULL,
  tds_paise bigint NOT NULL,
  emi_subvention_paise bigint NOT NULL,
  net_paise bigint NOT NULL,
  refund_id text,
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS settlement_seller_idx ON settlement_lines(seller_id, posted_on);
`;
