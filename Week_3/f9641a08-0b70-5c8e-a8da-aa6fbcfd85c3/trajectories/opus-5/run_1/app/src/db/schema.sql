CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('customer', 'operations', 'support')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  name text NOT NULL,
  line1 text NOT NULL,
  line2 text NOT NULL DEFAULT '',
  city text NOT NULL,
  state text NOT NULL,
  postcode text NOT NULL,
  phone text NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  material text NOT NULL,
  material_slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  featured_rank integer NOT NULL,
  published_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variants (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  colour text NOT NULL,
  colour_slug text NOT NULL,
  size text NOT NULL,
  size_slug text NOT NULL,
  height_cm numeric(6,1) NOT NULL,
  width_cm numeric(6,1) NOT NULL,
  depth_cm numeric(6,1) NOT NULL,
  weight_kg numeric(6,2) NOT NULL,
  price integer NOT NULL,
  compare_at integer,
  position integer NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour text NOT NULL,
  alt text NOT NULL,
  position integer NOT NULL,
  content_type text NOT NULL,
  storage_key text,
  bytes integer NOT NULL DEFAULT 0,
  sha256 text,
  study text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY,
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  reason text NOT NULL,
  ref text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_entries (
  id bigserial PRIMARY KEY,
  movement_id uuid NOT NULL REFERENCES stock_movements(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  account text NOT NULL CHECK (account IN ('external', 'available', 'reserved', 'committed', 'dispatched')),
  location text NOT NULL CHECK (location IN ('bhiwandi', 'gurugram')),
  quantity integer NOT NULL
);

CREATE INDEX IF NOT EXISTS stock_entries_variant_idx ON stock_entries (variant_id, account, location);
CREATE INDEX IF NOT EXISTS stock_movements_variant_idx ON stock_movements (variant_id, at DESC);

CREATE OR REPLACE FUNCTION stock_entry_guard() RETURNS trigger AS $$
DECLARE total bigint;
BEGIN
  SELECT coalesce(sum(quantity), 0) INTO total FROM stock_entries WHERE movement_id = NEW.movement_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'stock movement % does not sum to zero', NEW.movement_id;
  END IF;
  IF NEW.account = 'available' THEN
    SELECT coalesce(sum(quantity), 0) INTO total FROM stock_entries
      WHERE variant_id = NEW.variant_id AND location = NEW.location AND account = 'available';
    IF total < 0 THEN
      RAISE EXCEPTION 'available stock cannot go below zero';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_entry_guard_trigger ON stock_entries;
CREATE CONSTRAINT TRIGGER stock_entry_guard_trigger
  AFTER INSERT ON stock_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stock_entry_guard();

CREATE TABLE IF NOT EXISTS carts (
  id uuid PRIMARY KEY,
  session_id text UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  shipping_method text NOT NULL DEFAULT 'standard',
  discount_code text,
  gift_card_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_lines (
  id uuid PRIMARY KEY,
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);

CREATE TABLE IF NOT EXISTS wishlists (
  id uuid PRIMARY KEY,
  session_id text UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  wishlist_id uuid NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wishlist_id, product_id)
);

CREATE TABLE IF NOT EXISTS checkouts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step text NOT NULL DEFAULT 'contact',
  email text,
  phone text,
  address jsonb,
  shipping_method text NOT NULL DEFAULT 'standard',
  shipping_chosen boolean NOT NULL DEFAULT false,
  gift boolean NOT NULL DEFAULT false,
  gift_message text NOT NULL DEFAULT '',
  discount_code text,
  gift_card_code text,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  hold_reserved_at timestamptz,
  hold_released_at timestamptz,
  order_number text,
  payment_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  number text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL DEFAULT 'standard',
  status text NOT NULL,
  payment_status text NOT NULL,
  placed_at timestamptz NOT NULL,
  delivered_at timestamptz,
  confirmation_emailed_at timestamptz,
  email text NOT NULL,
  phone text,
  address jsonb,
  shipping_method text NOT NULL DEFAULT 'standard',
  gift boolean NOT NULL DEFAULT false,
  gift_message text NOT NULL DEFAULT '',
  discount_code text,
  gift_card_code text,
  totals jsonb NOT NULL,
  shipping_tax integer NOT NULL DEFAULT 0,
  payment_amount integer NOT NULL DEFAULT 0,
  card_amount integer NOT NULL DEFAULT 0,
  gift_card_amount integer NOT NULL DEFAULT 0,
  card_last4 text,
  refunded integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, placed_at DESC);

CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id),
  sku text NOT NULL,
  product text NOT NULL,
  product_slug text NOT NULL,
  category text NOT NULL,
  colour text NOT NULL,
  size text NOT NULL,
  quantity integer NOT NULL,
  unit_price integer NOT NULL,
  line_subtotal integer NOT NULL,
  line_discount integer NOT NULL,
  line_tax integer NOT NULL,
  fulfillment text NOT NULL DEFAULT 'unfulfilled',
  carrier text,
  tracking_number text,
  returned_quantity integer NOT NULL DEFAULT 0,
  refunded_amount integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_number, position);

CREATE TABLE IF NOT EXISTS order_timeline (
  id bigserial PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  status text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  amount integer NOT NULL,
  card_amount integer NOT NULL,
  gift_card_amount integer NOT NULL,
  reason text NOT NULL,
  ref text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gift_cards (
  code text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gift_card_entries (
  id bigserial PRIMARY KEY,
  group_id uuid NOT NULL,
  code text NOT NULL REFERENCES gift_cards(code) ON DELETE CASCADE,
  account text NOT NULL,
  amount integer NOT NULL,
  reason text NOT NULL,
  ref text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_card_entries_code_idx ON gift_card_entries (code);

CREATE OR REPLACE FUNCTION gift_card_entry_guard() RETURNS trigger AS $$
DECLARE total bigint;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO total FROM gift_card_entries WHERE group_id = NEW.group_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'gift card ledger group % does not sum to zero', NEW.group_id;
  END IF;
  SELECT coalesce(sum(amount), 0) INTO total FROM gift_card_entries
    WHERE code = NEW.code AND account = 'card';
  IF total < 0 THEN
    RAISE EXCEPTION 'gift card balance cannot go below zero';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gift_card_entry_guard_trigger ON gift_card_entries;
CREATE CONSTRAINT TRIGGER gift_card_entry_guard_trigger
  AFTER INSERT ON gift_card_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION gift_card_entry_guard();

CREATE TABLE IF NOT EXISTS discount_codes (
  code text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value integer NOT NULL,
  collection text,
  minimum integer NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  usage_limit integer,
  used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS returns (
  number text PRIMARY KEY,
  order_line_id uuid NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  quantity integer NOT NULL,
  reason text NOT NULL,
  outcome text NOT NULL,
  exchange_sku text,
  exchange_order_number text,
  refund_amount integer,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trials (
  number text PRIMARY KEY,
  order_line_id uuid NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  note text NOT NULL DEFAULT '',
  refund_amount integer,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_history (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  number text NOT NULL,
  status text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_history_idx ON case_history (kind, number, id);

CREATE TABLE IF NOT EXISTS warranty_registrations (
  id uuid PRIMARY KEY,
  order_line_id uuid NOT NULL UNIQUE REFERENCES order_lines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  covered_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo', 'receipt')),
  filename text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  status text NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now(),
  claim_number text
);

CREATE TABLE IF NOT EXISTS warranty_claims (
  number text PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES warranty_registrations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  component text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  reject_reason text,
  resolution_order_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL,
  body text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  email_status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, at DESC);

CREATE TABLE IF NOT EXISTS request_keys (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  scope text NOT NULL,
  route text NOT NULL,
  request_hash text NOT NULL,
  status integer,
  response jsonb,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, scope, route)
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id bigserial PRIMARY KEY,
  actor_id uuid NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_entries_entity_idx ON audit_entries (entity, entity_id, id DESC);

CREATE TABLE IF NOT EXISTS live_events (
  seq bigint PRIMARY KEY,
  type text NOT NULL,
  data jsonb NOT NULL,
  audience_user_id uuid,
  staff_only boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_index_queue (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now()
);
