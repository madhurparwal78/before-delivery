-- Roam House Atelier schema. Every stock figure and gift card balance is derived
-- from ledger entries; nothing is stored twice.

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','operations','support')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
  product_slug TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_token, product_slug)
);

CREATE TABLE IF NOT EXISTS products (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  material TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  version INT NOT NULL DEFAULT 1,
  featured_rank INT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variants (
  sku TEXT PRIMARY KEY,
  product_slug TEXT NOT NULL REFERENCES products(slug) ON DELETE CASCADE,
  colour TEXT NOT NULL,
  colour_slug TEXT NOT NULL,
  size TEXT NOT NULL,
  size_slug TEXT NOT NULL,
  height_cm INT NOT NULL,
  width_cm INT NOT NULL,
  depth_cm INT NOT NULL,
  weight_kg NUMERIC(4,2) NOT NULL,
  price INT NOT NULL CHECK (price >= 0),
  compare_at INT,
  version INT NOT NULL DEFAULT 1,
  position INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS variants_product_idx ON variants (product_slug, position);

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY,
  reason TEXT NOT NULL,
  ref TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_at_idx ON stock_movements (at);

CREATE TABLE IF NOT EXISTS stock_entries (
  id BIGSERIAL PRIMARY KEY,
  movement_id BIGINT NOT NULL REFERENCES stock_movements(id),
  sku TEXT NOT NULL,
  location TEXT NOT NULL CHECK (location IN ('bhiwandi','gurugram')),
  account TEXT NOT NULL CHECK (account IN ('external','available','reserved','committed','dispatched')),
  quantity INT NOT NULL CHECK (quantity <> 0)
);
CREATE INDEX IF NOT EXISTS stock_entries_sum_idx ON stock_entries (sku, location, account);
CREATE INDEX IF NOT EXISTS stock_entries_movement_idx ON stock_entries (movement_id);

-- Every movement's entries sum to zero.
CREATE OR REPLACE FUNCTION movement_sums_zero() RETURNS trigger AS $$
BEGIN
  IF (SELECT COALESCE(SUM(quantity), 0) FROM stock_entries WHERE movement_id = NEW.id) <> 0 THEN
    RAISE EXCEPTION 'movement_not_balanced';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS movement_balance_guard ON stock_movements;
CREATE CONSTRAINT TRIGGER movement_balance_guard AFTER INSERT ON stock_movements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION movement_sums_zero();

-- Available can never go below zero.
CREATE OR REPLACE FUNCTION available_never_negative() RETURNS trigger AS $$
BEGIN
  IF NEW.account = 'available' AND
     (SELECT COALESCE(SUM(quantity), 0) FROM stock_entries
       WHERE sku = NEW.sku AND location = NEW.location AND account = 'available') < 0 THEN
    RAISE EXCEPTION 'available_negative';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS available_guard ON stock_entries;
CREATE CONSTRAINT TRIGGER available_guard AFTER INSERT ON stock_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION available_never_negative();

CREATE TABLE IF NOT EXISTS carts (
  id BIGSERIAL PRIMARY KEY,
  session_token TEXT NOT NULL UNIQUE REFERENCES sessions(token) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  discount_code TEXT,
  gift_card_code TEXT,
  shipping_method TEXT NOT NULL DEFAULT 'standard' CHECK (shipping_method IN ('standard','express')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_lines (
  id BIGSERIAL PRIMARY KEY,
  cart_id BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, sku)
);

CREATE TABLE IF NOT EXISTS addresses (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  line1 TEXT NOT NULL DEFAULT '',
  line2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkouts (
  id BIGSERIAL PRIMARY KEY,
  session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  step TEXT NOT NULL CHECK (step IN ('contact','delivery','shipping','payment')),
  email TEXT,
  phone TEXT,
  address_id BIGINT REFERENCES addresses(id),
  address JSONB,
  shipping_method TEXT NOT NULL DEFAULT 'standard' CHECK (shipping_method IN ('standard','express')),
  gift BOOLEAN NOT NULL DEFAULT FALSE,
  gift_message TEXT,
  lines JSONB NOT NULL,
  totals JSONB NOT NULL,
  discount_code TEXT,
  gift_card_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holds (
  id BIGSERIAL PRIMARY KEY,
  checkout_id BIGINT NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active','committed','released','lapsed')),
  reserved_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS holds_checkout_idx ON holds (checkout_id);
CREATE INDEX IF NOT EXISTS holds_status_idx ON holds (status, expires_at);

CREATE TABLE IF NOT EXISTS hold_lines (
  id BIGSERIAL PRIMARY KEY,
  hold_id BIGINT NOT NULL REFERENCES holds(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  location TEXT NOT NULL CHECK (location IN ('bhiwandi','gurugram')),
  quantity INT NOT NULL
);
CREATE INDEX IF NOT EXISTS hold_lines_sku_idx ON hold_lines (sku);
CREATE INDEX IF NOT EXISTS hold_lines_hold_idx ON hold_lines (hold_id);

CREATE TABLE IF NOT EXISTS orders (
  number TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('placed','packed','partially_shipped','shipped','out_for_delivery','delivered','cancelled')),
  kind TEXT NOT NULL DEFAULT 'order' CHECK (kind IN ('order','exchange','replacement')),
  email TEXT NOT NULL,
  phone TEXT,
  address JSONB NOT NULL,
  shipping_method TEXT NOT NULL CHECK (shipping_method IN ('standard','express')),
  gift BOOLEAN NOT NULL DEFAULT FALSE,
  gift_message TEXT,
  subtotal INT NOT NULL,
  discount INT NOT NULL,
  shipping INT NOT NULL,
  shipping_tax INT NOT NULL,
  tax INT NOT NULL,
  gift_card_amount INT NOT NULL,
  total INT NOT NULL,
  discount_code TEXT,
  gift_card_code TEXT,
  placed_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  confirmation_emailed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, placed_at DESC);

CREATE TABLE IF NOT EXISTS order_lines (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  product TEXT NOT NULL,
  colour TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INT NOT NULL,
  unit_price INT NOT NULL,
  line_subtotal INT NOT NULL,
  line_discount INT NOT NULL,
  line_tax INT NOT NULL,
  fulfillment TEXT NOT NULL CHECK (fulfillment IN ('unfulfilled','packed','shipped','out_for_delivery','delivered','cancelled')),
  carrier TEXT,
  tracking_number TEXT,
  refunded_quantity INT NOT NULL DEFAULT 0,
  returned_quantity INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_id);
CREATE INDEX IF NOT EXISTS order_lines_sku_idx ON order_lines (sku);

CREATE TABLE IF NOT EXISTS order_timeline (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  status TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS order_timeline_order_idx ON order_timeline (order_number, at);

CREATE TABLE IF NOT EXISTS payments (
  order_number TEXT PRIMARY KEY REFERENCES orders(number) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','authorized','captured','partially_refunded','refunded','failed')),
  amount INT NOT NULL,
  card_amount INT NOT NULL,
  gift_card_amount INT NOT NULL,
  card_last4 TEXT,
  refunded INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id BIGSERIAL PRIMARY KEY,
  checkout_id BIGINT NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('failed','captured')),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  order_line_id BIGINT,
  amount INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cancellation','return','trial')),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_at_idx ON refunds (at);

CREATE TABLE IF NOT EXISTS return_cases (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  order_line_id BIGINT NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('requested','approved','rejected','in_transit','received','inspected','refunded','exchanged')),
  version INT NOT NULL DEFAULT 1,
  quantity INT NOT NULL,
  reason TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('refund','exchange')),
  exchange_sku TEXT,
  exchange_order_number TEXT,
  rejection_reason TEXT,
  refund_amount INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trial_cases (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  order_line_id BIGINT NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('requested','approved','rejected','returned','refunded')),
  version INT NOT NULL DEFAULT 1,
  note TEXT,
  rejection_reason TEXT,
  refund_amount INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_history (
  id BIGSERIAL PRIMARY KEY,
  case_type TEXT NOT NULL CHECK (case_type IN ('return','trial','warranty')),
  case_id BIGINT NOT NULL,
  status TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_history_case_idx ON case_history (case_type, case_id, at);

CREATE TABLE IF NOT EXISTS warranty_registrations (
  id BIGSERIAL PRIMARY KEY,
  order_line_id BIGINT NOT NULL UNIQUE REFERENCES order_lines(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  covered_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('photo','receipt')),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('stored')),
  stored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warranty_claims (
  id BIGSERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  registration_id BIGINT NOT NULL REFERENCES warranty_registrations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('submitted','under_review','approved','rejected','repair','replacement','resolved')),
  version INT NOT NULL DEFAULT 1,
  component TEXT NOT NULL CHECK (component IN ('Wheels','Handle','Shell','Zipper','Lock')),
  description TEXT NOT NULL,
  resolution_order_number TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id BIGINT NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  evidence_id BIGINT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (claim_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS discount_codes (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value INT NOT NULL,
  collection TEXT,
  minimum INT NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  usage_limit INT,
  used INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discount_code_uses (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL REFERENCES discount_codes(code),
  order_number TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_cards (
  code TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gift_card_ledger (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  code TEXT NOT NULL REFERENCES gift_cards(code),
  account TEXT NOT NULL,
  amount INT NOT NULL CHECK (amount <> 0),
  reason TEXT NOT NULL,
  ref TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gift_card_ledger_code_idx ON gift_card_ledger (code, at);

CREATE OR REPLACE FUNCTION gift_group_sums_zero() RETURNS trigger AS $$
BEGIN
  IF (SELECT COALESCE(SUM(amount), 0) FROM gift_card_ledger WHERE group_id = NEW.group_id) <> 0 THEN
    RAISE EXCEPTION 'gift_group_not_balanced';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gift_group_guard ON gift_card_ledger;
CREATE CONSTRAINT TRIGGER gift_group_guard AFTER INSERT ON gift_card_ledger
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gift_group_sums_zero();

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending','sending','emailed')),
  email_claimed_at TIMESTAMPTZ,
  emailed_at TIMESTAMPTZ,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, at DESC);
CREATE INDEX IF NOT EXISTS notifications_pending_idx ON notifications (email_status) WHERE email_status <> 'emailed';

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  route TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INT,
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id, route)
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('product','variant','order','return','trial','warranty_claim','discount_code')),
  entity_id TEXT NOT NULL,
  before JSONB,
  after JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_entries (entity, entity_id, at DESC);

CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_no_update ON audit_entries;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();

CREATE TABLE IF NOT EXISTS live_events (
  seq BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  scope_user BIGINT,
  scope_session TEXT,
  staff_visible BOOLEAN NOT NULL DEFAULT FALSE,
  data JSONB NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_events_at_idx ON live_events (at);

CREATE TABLE IF NOT EXISTS airlines (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  height_cm INT NOT NULL,
  width_cm INT NOT NULL,
  depth_cm INT NOT NULL,
  weight_kg NUMERIC(4,1) NOT NULL
);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_slug TEXT NOT NULL REFERENCES products(slug) ON DELETE CASCADE,
  colour TEXT NOT NULL,
  colour_slug TEXT NOT NULL,
  alt TEXT NOT NULL,
  position INT NOT NULL,
  content_type TEXT NOT NULL,
  bytes BYTEA,
  sha256 TEXT NOT NULL,
  storage TEXT NOT NULL CHECK (storage IN ('db','s3')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_images_idx ON product_images (product_slug, colour_slug, position);
