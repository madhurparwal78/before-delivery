-- Applied on every start under an advisory lock; every statement is safe to repeat.

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('customer', 'operations', 'support')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  label text NOT NULL,
  name text NOT NULL,
  line1 text NOT NULL,
  line2 text NOT NULL DEFAULT '',
  city text NOT NULL,
  state text NOT NULL,
  postcode text NOT NULL,
  phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS airlines (
  code text PRIMARY KEY,
  name text NOT NULL,
  height_cm numeric NOT NULL,
  width_cm numeric NOT NULL,
  depth_cm numeric NOT NULL,
  weight_kg numeric NOT NULL,
  position int NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS featured_rank_seq;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('luggage', 'backpacks', 'totes', 'wallets', 'accessories')),
  material text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  featured_rank bigint NOT NULL DEFAULT nextval('featured_rank_seq'),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS variants (
  sku text PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products (id),
  colour text NOT NULL,
  colour_slug text NOT NULL,
  size_slug text NOT NULL,
  height_cm numeric NOT NULL,
  width_cm numeric NOT NULL,
  depth_cm numeric NOT NULL,
  weight_kg numeric NOT NULL,
  price int NOT NULL CHECK (price BETWEEN 1 AND 999999),
  compare_at int CHECK (compare_at IS NULL OR compare_at > price),
  version int NOT NULL DEFAULT 1,
  position int NOT NULL
);
CREATE INDEX IF NOT EXISTS variants_product ON variants (product_id, position);

CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products (id),
  colour text NOT NULL,
  alt text NOT NULL,
  content_type text NOT NULL,
  bytes int NOT NULL,
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'stored' CHECK (status = 'stored'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Stock ledger: every movement is two entries that sum to zero. Figures are sums, never stored.
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial,
  reason text NOT NULL,
  ref text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stock_entries (
  id bigserial PRIMARY KEY,
  movement_id uuid NOT NULL REFERENCES stock_movements (id),
  sku text NOT NULL REFERENCES variants (sku),
  location text NOT NULL CHECK (location IN ('bhiwandi', 'gurugram')),
  account text NOT NULL CHECK (account IN ('external', 'available', 'reserved', 'committed', 'dispatched')),
  quantity int NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_entries_figures ON stock_entries (sku, location, account);
CREATE INDEX IF NOT EXISTS stock_entries_movement ON stock_entries (movement_id);

CREATE OR REPLACE FUNCTION assert_movement_balanced() RETURNS trigger AS $$
BEGIN
  IF (SELECT sum(quantity) FROM stock_entries WHERE movement_id = NEW.movement_id) <> 0
     OR (SELECT count(*) FROM stock_entries WHERE movement_id = NEW.movement_id) <> 2 THEN
    RAISE EXCEPTION 'a stock movement is two entries that sum to zero' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS stock_movement_balanced ON stock_entries;
CREATE CONSTRAINT TRIGGER stock_movement_balanced AFTER INSERT ON stock_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_movement_balanced();

CREATE OR REPLACE FUNCTION assert_available_not_negative() RETURNS trigger AS $$
BEGIN
  IF NEW.account = 'available' AND
     (SELECT sum(quantity) FROM stock_entries WHERE sku = NEW.sku AND location = NEW.location AND account = 'available') < 0 THEN
    RAISE EXCEPTION 'available stock cannot go below zero' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS stock_available_not_negative ON stock_entries;
CREATE TRIGGER stock_available_not_negative AFTER INSERT ON stock_entries
  FOR EACH ROW EXECUTE FUNCTION assert_available_not_negative();

-- Live events: one gapless sequence, written in the same transaction as the change.
CREATE TABLE IF NOT EXISTS live_counter (id int PRIMARY KEY CHECK (id = 1), seq bigint NOT NULL);
INSERT INTO live_counter (id, seq) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS live_events (
  seq bigint PRIMARY KEY,
  type text NOT NULL,
  data jsonb NOT NULL,
  audience text NOT NULL CHECK (audience IN ('all', 'owner', 'staff')),
  owner text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status int NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS carts (
  owner text PRIMARY KEY,
  shipping_method text NOT NULL DEFAULT 'standard' CHECK (shipping_method IN ('standard', 'express')),
  discount_code text,
  gift_card_code text
);
CREATE TABLE IF NOT EXISTS cart_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  sku text NOT NULL REFERENCES variants (sku),
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  position bigserial,
  UNIQUE (owner, sku)
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  owner text NOT NULL,
  product_id uuid NOT NULL REFERENCES products (id),
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, product_id)
);

CREATE TABLE IF NOT EXISTS discount_codes (
  code text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value int NOT NULL,
  collection text,
  minimum int NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  usage_limit int,
  used_before int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gift_cards (code text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS gift_ledger (
  id bigserial PRIMARY KEY,
  group_id uuid NOT NULL,
  card_code text NOT NULL REFERENCES gift_cards (code),
  account text NOT NULL,
  amount int NOT NULL,
  reason text NOT NULL,
  ref text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gift_ledger_card ON gift_ledger (card_code);
CREATE OR REPLACE FUNCTION assert_group_balanced() RETURNS trigger AS $$
BEGIN
  IF (SELECT sum(amount) FROM gift_ledger WHERE group_id = NEW.group_id) <> 0
     OR (SELECT count(*) FROM gift_ledger WHERE group_id = NEW.group_id) <> 2 THEN
    RAISE EXCEPTION 'a gift card ledger group is two entries that sum to zero' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gift_group_balanced ON gift_ledger;
CREATE CONSTRAINT TRIGGER gift_group_balanced AFTER INSERT ON gift_ledger
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_group_balanced();

CREATE TABLE IF NOT EXISTS checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  step text NOT NULL DEFAULT 'contact' CHECK (step IN ('contact', 'delivery', 'shipping', 'payment')),
  contact jsonb,
  delivery jsonb,
  gift boolean NOT NULL DEFAULT false,
  gift_message text NOT NULL DEFAULT '',
  gift_card_shown int,
  reserved_at timestamptz,
  placed_order_id uuid,
  payment_failed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS checkout_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id uuid NOT NULL REFERENCES checkouts (id),
  sku text NOT NULL REFERENCES variants (sku),
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_price int,
  position bigserial
);
CREATE TABLE IF NOT EXISTS hold_chunks (
  id bigserial PRIMARY KEY,
  checkout_id uuid NOT NULL REFERENCES checkouts (id),
  sku text NOT NULL REFERENCES variants (sku),
  location text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'lapsed', 'committed'))
);
CREATE INDEX IF NOT EXISTS hold_chunks_active ON hold_chunks (checkout_id) WHERE state = 'active';

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 100001;
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale', 'exchange', 'replacement')),
  status text NOT NULL,
  payment_base text NOT NULL CHECK (payment_base IN ('pending', 'authorized', 'captured', 'failed')),
  placed_at timestamptz NOT NULL,
  delivered_at timestamptz,
  version int NOT NULL DEFAULT 1,
  email text,
  phone text,
  address jsonb,
  shipping_method text NOT NULL DEFAULT 'standard',
  gift boolean NOT NULL DEFAULT false,
  gift_message text NOT NULL DEFAULT '',
  discount_code text,
  gift_card_code text,
  subtotal int NOT NULL,
  discount int NOT NULL,
  shipping int NOT NULL,
  tax int NOT NULL,
  shipping_tax int NOT NULL,
  grand_total int NOT NULL,
  gift_card_amount int NOT NULL,
  card_amount int NOT NULL,
  card_last4 text,
  confirmation_emailed_at timestamptz
);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, placed_at DESC);
CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders (id),
  position int NOT NULL,
  sku text NOT NULL REFERENCES variants (sku),
  product_name text NOT NULL,
  colour text NOT NULL,
  size_slug text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  unit_price int NOT NULL,
  line_discount int NOT NULL,
  line_tax int NOT NULL,
  fulfillment text NOT NULL CHECK (fulfillment IN ('unfulfilled', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled')),
  carrier text,
  tracking_number text
);
CREATE INDEX IF NOT EXISTS order_lines_order ON order_lines (order_id, position);
CREATE TABLE IF NOT EXISTS order_allocations (
  id bigserial PRIMARY KEY,
  order_line_id uuid NOT NULL REFERENCES order_lines (id),
  location text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0)
);
CREATE TABLE IF NOT EXISTS order_events (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders (id),
  status text NOT NULL,
  at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders (id),
  amount int NOT NULL CHECK (amount > 0),
  card_amount int NOT NULL,
  gift_card_amount int NOT NULL,
  reason text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_order ON refunds (order_id);

CREATE SEQUENCE IF NOT EXISTS return_number_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS trial_number_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS claim_number_seq START 1001;
CREATE TABLE IF NOT EXISTS warranty_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_line_id uuid NOT NULL UNIQUE REFERENCES order_lines (id),
  user_id uuid NOT NULL REFERENCES users (id),
  covered_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('return', 'trial', 'claim')),
  number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users (id),
  order_line_id uuid NOT NULL REFERENCES order_lines (id),
  status text NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  quantity int,
  request_reason text,
  outcome text CHECK (outcome IS NULL OR outcome IN ('refund', 'exchange')),
  exchange_sku text REFERENCES variants (sku),
  exchange_order_id uuid REFERENCES orders (id),
  note text,
  registration_id uuid REFERENCES warranty_registrations (id),
  component text,
  description text,
  resolution_order_id uuid REFERENCES orders (id),
  refund_amount int,
  reject_reason text
);
CREATE INDEX IF NOT EXISTS cases_user ON cases (user_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS cases_line ON cases (order_line_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_return_or_trial ON cases (order_line_id)
  WHERE kind IN ('return', 'trial') AND status NOT IN ('rejected', 'refunded', 'exchanged');
CREATE UNIQUE INDEX IF NOT EXISTS one_open_claim ON cases (order_line_id, component)
  WHERE kind = 'claim' AND status NOT IN ('rejected', 'resolved');
CREATE TABLE IF NOT EXISTS case_history (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases (id),
  status text NOT NULL,
  at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (kind IN ('photo', 'receipt')),
  filename text NOT NULL,
  content_type text NOT NULL,
  bytes int NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'stored' CHECK (status = 'stored'),
  stored_at timestamptz NOT NULL,
  claim_id uuid REFERENCES cases (id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  text text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'emailed')),
  emailed_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_pending ON notifications (next_attempt_at) WHERE email_status = 'pending';

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial,
  actor_id uuid NOT NULL REFERENCES users (id),
  action text NOT NULL,
  entity text NOT NULL CHECK (entity IN ('product', 'variant', 'order', 'return', 'trial', 'warranty_claim', 'discount_code')),
  entity_id text NOT NULL,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log (entity, entity_id);
CREATE OR REPLACE FUNCTION audit_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit entries cannot be changed' USING ERRCODE = '23514';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_is_immutable();

CREATE TABLE IF NOT EXISTS search_dirty (
  slug text PRIMARY KEY,
  marked_at timestamptz NOT NULL DEFAULT now()
);
