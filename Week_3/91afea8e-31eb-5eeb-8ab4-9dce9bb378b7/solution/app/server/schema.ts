import { pool } from "./db.js";

const SCHEMA_LOCK = 7_000_001;

const DDL = `
CREATE TABLE IF NOT EXISTS categories (
  slug text PRIMARY KEY, name text NOT NULL, gst_rate int NOT NULL, commission_percent int NOT NULL, return_days int NOT NULL
);
CREATE TABLE IF NOT EXISTS pincodes (
  pincode text PRIMARY KEY, city text NOT NULL, state text NOT NULL, serviceable boolean NOT NULL, cod boolean NOT NULL, remote boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS banks (code text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS sellers (
  id text PRIMARY KEY, name text NOT NULL, gstin text NOT NULL, pickup_pincode text NOT NULL, pickup_city text NOT NULL,
  pickup_state text NOT NULL, dispatch_days int NOT NULL, rating double precision NOT NULL, cod boolean NOT NULL,
  ship_to_states text[] NOT NULL, payout_holder text, payout_ifsc text, payout_masked text, gst_certificate_key text
);
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY, role text NOT NULL, name text NOT NULL, first_name text NOT NULL, email text NOT NULL,
  phone text NOT NULL, password_hash text NOT NULL, seller_id text REFERENCES sellers(id),
  balance_paise bigint NOT NULL DEFAULT 0, kb_account_id text, created_at bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS accounts_phone ON accounts (phone);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);
CREATE TABLE IF NOT EXISTS access_tokens (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS half_signed_in_sessions (
  id text PRIMARY KEY, kind text NOT NULL, account_id text, identifier text NOT NULL, phone text NOT NULL,
  payload jsonb, expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_codes (
  owner_id text NOT NULL, purpose text NOT NULL, code text NOT NULL, issued_at bigint NOT NULL, tries int NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, purpose)
);
CREATE TABLE IF NOT EXISTS code_sends (id bigserial PRIMARY KEY, identifier text NOT NULL, at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS code_sends_identifier ON code_sends (identifier, at);
CREATE TABLE IF NOT EXISTS rate_hits (id bigserial PRIMARY KEY, bucket text NOT NULL, at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_bucket ON rate_hits (bucket, at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id text NOT NULL, key text NOT NULL, request_hash text NOT NULL, status int, body jsonb, created_at bigint NOT NULL,
  PRIMARY KEY (account_id, key)
);
CREATE TABLE IF NOT EXISTS addresses (
  id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, label text NOT NULL, name text NOT NULL,
  line1 text NOT NULL, line2 text NOT NULL, city text NOT NULL, state text NOT NULL, pincode text NOT NULL, phone text NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS cards (
  id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, network text NOT NULL, last4 text NOT NULL,
  expiry_month int NOT NULL, expiry_year int NOT NULL, name text NOT NULL, seq bigserial
);
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY, title text NOT NULL, brand text NOT NULL, category text NOT NULL REFERENCES categories(slug),
  rating double precision NOT NULL DEFAULT 0, description text NOT NULL DEFAULT '', specs jsonb NOT NULL DEFAULT '{}'
);
CREATE SEQUENCE IF NOT EXISTS listing_ids START 2001;
CREATE SEQUENCE IF NOT EXISTS listing_order START 1;
CREATE TABLE IF NOT EXISTS listings (
  id text PRIMARY KEY, product_id text NOT NULL REFERENCES products(id), seller_id text NOT NULL REFERENCES sellers(id),
  price_paise bigint NOT NULL, cost_price_paise bigint NOT NULL, stock int NOT NULL, status text NOT NULL,
  description text NOT NULL DEFAULT '', return_note text NOT NULL DEFAULT '', cod_allowed boolean NOT NULL, no_cost_emi boolean NOT NULL,
  deal_price_paise bigint, deal_ends_at bigint, created_seq bigint NOT NULL DEFAULT nextval('listing_order')
);
CREATE UNIQUE INDEX IF NOT EXISTS listings_created_seq ON listings (created_seq);
CREATE INDEX IF NOT EXISTS listings_seller ON listings (seller_id, status);
CREATE INDEX IF NOT EXISTS listings_product ON listings (product_id);
CREATE TABLE IF NOT EXISTS listing_photos (
  id text PRIMARY KEY, listing_id text NOT NULL REFERENCES listings(id) ON DELETE CASCADE, ext text NOT NULL, seq bigserial
);
CREATE TABLE IF NOT EXISTS search_outbox (listing_id text PRIMARY KEY, queued_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS carts (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, destination_address_id text, destination_pincode text,
  coupon_code text, payment_method text, use_balance boolean NOT NULL DEFAULT false, emi_tenure_months int
);
CREATE TABLE IF NOT EXISTS cart_lines (
  id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, listing_id text NOT NULL REFERENCES listings(id),
  quantity int NOT NULL, selected boolean NOT NULL DEFAULT true, gift_wrap boolean NOT NULL DEFAULT false,
  gift_message text NOT NULL DEFAULT '', saved boolean NOT NULL DEFAULT false, seq bigserial
);
CREATE INDEX IF NOT EXISTS cart_lines_account ON cart_lines (account_id, saved, seq);
CREATE TABLE IF NOT EXISTS cart_speeds (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, seller_id text NOT NULL, speed text NOT NULL,
  PRIMARY KEY (account_id, seller_id)
);
CREATE TABLE IF NOT EXISTS wishlist_items (
  id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, product_id text NOT NULL REFERENCES products(id),
  listing_id text NOT NULL REFERENCES listings(id), seq bigserial, UNIQUE (account_id, product_id)
);
CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, kind text NOT NULL, token text NOT NULL UNIQUE,
  display_name text NOT NULL, expires_at bigint NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS coupons (
  code text PRIMARY KEY, kind text NOT NULL, value int NOT NULL, cap_paise bigint, min_subtotal_paise bigint NOT NULL, expired boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS gift_cards (code text PRIMARY KEY, amount_paise bigint NOT NULL, redeemed_by text, redeemed_at bigint);
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY, seq bigserial, account_id text NOT NULL REFERENCES accounts(id), address jsonb NOT NULL,
  payable_paise bigint NOT NULL, placed_at bigint NOT NULL, payment_id text NOT NULL, emi_tenure_months int
);
CREATE INDEX IF NOT EXISTS orders_account ON orders (account_id, seq);
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY, order_id text NOT NULL, method text, status text NOT NULL, initiated_at bigint NOT NULL, expires_at bigint,
  provider_reference_started boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS payments_open ON payments (status);
CREATE TABLE IF NOT EXISTS payment_legs (
  id text PRIMARY KEY, payment_id text NOT NULL, order_id text NOT NULL, shipment_id text, method text NOT NULL,
  amount_paise bigint NOT NULL, status text NOT NULL, kb_key text NOT NULL, kb_recorded boolean NOT NULL DEFAULT false,
  card_last4 text, card_network text, seq bigserial
);
CREATE INDEX IF NOT EXISTS payment_legs_order ON payment_legs (order_id);
CREATE TABLE IF NOT EXISTS shipments (
  id text PRIMARY KEY, seq bigserial, order_id text NOT NULL REFERENCES orders(id), seller_id text NOT NULL REFERENCES sellers(id),
  state text NOT NULL, promise_date text, speed text NOT NULL, delivery_fee_paise bigint NOT NULL, cod_fee_paise bigint NOT NULL,
  gift_wrap_paise bigint NOT NULL, emi_discount_paise bigint NOT NULL DEFAULT 0, balance_share_paise bigint NOT NULL DEFAULT 0,
  delivered_on text, invoice_stored boolean NOT NULL DEFAULT false, label_stored boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS shipments_order ON shipments (order_id);
CREATE INDEX IF NOT EXISTS shipments_seller ON shipments (seller_id, seq);
CREATE TABLE IF NOT EXISTS shipment_events (id bigserial PRIMARY KEY, shipment_id text NOT NULL, state text NOT NULL, at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS shipment_events_shipment ON shipment_events (shipment_id);
CREATE TABLE IF NOT EXISTS shipment_lines (
  id text PRIMARY KEY, shipment_id text NOT NULL REFERENCES shipments(id), listing_id text NOT NULL, title text NOT NULL,
  category text NOT NULL, quantity int NOT NULL, unit_price_paise bigint NOT NULL, coupon_share_paise bigint NOT NULL,
  line_total_paise bigint NOT NULL, gst_rate int NOT NULL, taxable_value_paise bigint NOT NULL, cgst_paise bigint NOT NULL,
  sgst_paise bigint NOT NULL, igst_paise bigint NOT NULL, commission_percent int NOT NULL, emi_share_paise bigint NOT NULL DEFAULT 0,
  gift_wrap boolean NOT NULL DEFAULT false, gift_message text NOT NULL DEFAULT '', seq bigserial
);
CREATE INDEX IF NOT EXISTS shipment_lines_shipment ON shipment_lines (shipment_id);
CREATE TABLE IF NOT EXISTS returns (
  id text PRIMARY KEY, seq bigserial, shipment_line_id text NOT NULL REFERENCES shipment_lines(id), quantity int NOT NULL,
  reason text NOT NULL, state text NOT NULL, decline_reason text, refund_paise bigint, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  id text PRIMARY KEY, shipment_id text NOT NULL, shipment_line_id text, return_id text, source text NOT NULL,
  quantity int NOT NULL DEFAULT 0, amount_paise bigint NOT NULL, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS refund_legs (
  id text PRIMARY KEY, refund_id text NOT NULL REFERENCES refunds(id), leg_id text NOT NULL REFERENCES payment_legs(id),
  amount_paise bigint NOT NULL, status text NOT NULL, credits_balance boolean NOT NULL, credited boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS refund_legs_pending ON refund_legs (status);
CREATE TABLE IF NOT EXISTS pending_reversals (id text PRIMARY KEY, payment_key text NOT NULL, amount_paise bigint NOT NULL);
CREATE TABLE IF NOT EXISTS settlement_lines (
  id text PRIMARY KEY, seq bigserial, seller_id text NOT NULL, shipment_id text NOT NULL, line_id text NOT NULL, kind text NOT NULL,
  posted_on text NOT NULL, gross_paise bigint NOT NULL, commission_percent int NOT NULL, commission_paise bigint NOT NULL,
  commission_gst_paise bigint NOT NULL, tcs_paise bigint NOT NULL, tds_paise bigint NOT NULL, emi_subvention_paise bigint NOT NULL,
  net_paise bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS settlement_seller ON settlement_lines (seller_id, posted_on);
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(DDL);
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
  } finally {
    client.release();
  }
}
