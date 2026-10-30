/**
 * Schema applied idempotently on every serve. Safe when two instances start
 * together against one database.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('broker','beekeeper','grower')),
  name text NOT NULL,
  business text,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growers (
  id text PRIMARY KEY,
  name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL
);

CREATE TABLE IF NOT EXISTS orchards (
  id text PRIMARY KEY,
  grower_id text NOT NULL REFERENCES growers(id),
  name text NOT NULL,
  county text NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id text PRIMARY KEY,
  orchard_id text NOT NULL REFERENCES orchards(id),
  name text NOT NULL,
  acres numeric(6,1) NOT NULL,
  position int NOT NULL,
  UNIQUE (orchard_id, name)
);

CREATE TABLE IF NOT EXISTS rule_sets (
  id text PRIMARY KEY,
  name text NOT NULL,
  effective_from date NOT NULL,
  threshold_reduced int NOT NULL,
  threshold_standard int NOT NULL,
  threshold_bonus int NOT NULL,
  price_none_cents int NOT NULL,
  price_reduced_cents int NOT NULL,
  price_standard_cents int NOT NULL,
  price_bonus_cents int NOT NULL,
  commission_bps int NOT NULL,
  deposit_per_hive_cents int NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  orchard_id text NOT NULL REFERENCES orchards(id),
  grower_id text NOT NULL REFERENCES growers(id),
  status text NOT NULL CHECK (status IN ('draft','open','filled','placed','inspected','settled','cancelled')),
  settlement_status text NOT NULL DEFAULT 'none' CHECK (settlement_status IN ('none','queued','settled')),
  bloom_start date NOT NULL,
  bloom_end date NOT NULL,
  delivery_deadline date NOT NULL,
  rule_set_id text NOT NULL REFERENCES rule_sets(id),
  deposit_cents int NOT NULL,
  kb_account_id text,
  kb_deposit_invoice_id text,
  kb_balance_invoice_id text,
  kb_credit_invoice_id text,
  report_key text,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_blocks (
  order_id text NOT NULL REFERENCES orders(id),
  block_id text NOT NULL REFERENCES blocks(id),
  hives int NOT NULL CHECK (hives >= 1),
  PRIMARY KEY (order_id, block_id)
);

CREATE TABLE IF NOT EXISTS drops (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  beekeeper_id text NOT NULL REFERENCES users(id),
  yard_name text NOT NULL,
  hives int NOT NULL CHECK (hives >= 1),
  status text NOT NULL CHECK (status IN ('committed','delivered','inspected','disputed','accepted')),
  block_id text REFERENCES blocks(id),
  delivered_at timestamptz,
  delivered_on date,
  dispute_reason text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS samples (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  block_id text NOT NULL REFERENCES blocks(id),
  drop_id text NOT NULL REFERENCES drops(id),
  colony_label text NOT NULL,
  frames_tenths int NOT NULL CHECK (frames_tenths >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, block_id, colony_label)
);

CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  sample_id text NOT NULL REFERENCES samples(id),
  s3_key text NOT NULL,
  content_type text NOT NULL,
  ext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inspection_links (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  token_hash text NOT NULL,
  inspector_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('issued','used','signed','expired')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  signed_at timestamptz
);

CREATE TABLE IF NOT EXISTS settlements (
  order_id text PRIMARY KEY REFERENCES orders(id),
  status text NOT NULL CHECK (status IN ('queued','settled')),
  payment_received_on date NOT NULL,
  payable_cents int NOT NULL,
  commission_bps int NOT NULL,
  commission_cents int NOT NULL,
  shares jsonb NOT NULL,
  settled_at timestamptz,
  kb_payment_external_key text,
  lease_until timestamptz,
  lease_owner text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  ref text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status int NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, ref, key)
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id text PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','sent')) DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  lease_until timestamptz,
  locked_by text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS file_links (
  token_hash text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('photo','report')),
  photo_id text REFERENCES photos(id),
  order_id text REFERENCES orders(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  entity text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  actor text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seed_marker (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drops_order ON drops(order_id);
CREATE INDEX IF NOT EXISTS idx_drops_beekeeper ON drops(beekeeper_id);
CREATE INDEX IF NOT EXISTS idx_samples_order ON samples(order_id);
CREATE INDEX IF NOT EXISTS idx_samples_block ON samples(block_id);
CREATE INDEX IF NOT EXISTS idx_links_order ON inspection_links(order_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_file_links_expiry ON file_links(expires_at);
`;
