/**
 * Schema and seed data are applied on every start. An advisory lock makes that
 * safe and idempotent when two instances start at once against one database.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS products (
  slug             TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  family           TEXT NOT NULL,
  description      TEXT NOT NULL,
  watts            INTEGER NOT NULL,
  cri              INTEGER NOT NULL,
  ip_rating        TEXT NOT NULL,
  default_variant  TEXT NOT NULL,
  sort_order       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS variants (
  code                TEXT PRIMARY KEY,
  product_slug        TEXT NOT NULL REFERENCES products(slug),
  finish              TEXT NOT NULL,
  finish_name         TEXT NOT NULL,
  beam_deg            INTEGER NOT NULL,
  cct_k               INTEGER NOT NULL,
  lumens              INTEGER NOT NULL,
  candela             INTEGER NOT NULL,
  retail_price_cents  INTEGER NOT NULL,
  trade_price_cents   INTEGER NOT NULL,
  was_price_cents     INTEGER,
  clearance           BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS variants_product_idx ON variants(product_slug);

-- Stock on hand is always the sum of a clearance variant's movements.
CREATE TABLE IF NOT EXISTS stock_movements (
  id            BIGSERIAL PRIMARY KEY,
  variant_code  TEXT NOT NULL REFERENCES variants(code),
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('seed','sale','release','adjust')),
  order_key     TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_variant_idx ON stock_movements(variant_code);

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('retail','trade','admin')),
  trade_status   TEXT CHECK (trade_status IN ('submitted','approved','declined')),
  dial_mode      TEXT NOT NULL DEFAULT 'auto',
  kb_account_id  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name   TEXT NOT NULL,
  nzbn            TEXT NOT NULL,
  occupation      TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('submitted','approved','declined')),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ,
  decline_reason  TEXT
);

CREATE TABLE IF NOT EXISTS favourites (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant_code  TEXT NOT NULL REFERENCES variants(code),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, variant_code)
);

CREATE TABLE IF NOT EXISTS orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_key        TEXT NOT NULL UNIQUE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL,
  payment_method   TEXT CHECK (payment_method IN ('card','account')),
  price_tier       TEXT NOT NULL CHECK (price_tier IN ('retail','trade')),
  subtotal_cents   INTEGER NOT NULL DEFAULT 0,
  gst_cents        INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0,
  captured_cents   INTEGER NOT NULL DEFAULT 0,
  refunded_cents   INTEGER NOT NULL DEFAULT 0,
  card_last4       TEXT,
  purchase_order   TEXT,
  delivery         JSONB,
  kb_payment_id    TEXT,
  kb_invoice_id    TEXT,
  invoice_number   TEXT,
  invoice_date     DATE,
  due_date         DATE,
  confirmation_sent_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id);
-- A caller has at most one open cart at a time.
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_open_cart
  ON orders(user_id) WHERE status IN ('cart','declined','gateway_unavailable');

CREATE TABLE IF NOT EXISTS order_lines (
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_code      TEXT NOT NULL REFERENCES variants(code),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents  INTEGER NOT NULL,
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, variant_code)
);

CREATE TABLE IF NOT EXISTS refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  seq                INTEGER NOT NULL,
  amount_cents       INTEGER NOT NULL,
  reason             TEXT NOT NULL,
  kb_transaction_id  TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, seq)
);

-- One charge per checkout: a key is scoped to the caller and the endpoint.
CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint       TEXT NOT NULL,
  key            TEXT NOT NULL,
  body_hash      TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('running','done')),
  status_code    INTEGER,
  response_body  JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  client_name        TEXT,
  owner_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ceiling_height_mm  INTEGER NOT NULL,
  room_width_mm      INTEGER NOT NULL,
  room_depth_mm      INTEGER NOT NULL,
  cover_key          TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_lines (
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  variant_code  TEXT NOT NULL REFERENCES variants(code),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, variant_code)
);

-- Ordinals count a variant's placements from 1 and are never reused in a project,
-- so the counter outlives the placements themselves.
CREATE TABLE IF NOT EXISTS project_variant_ordinals (
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  variant_code  TEXT NOT NULL REFERENCES variants(code),
  next_ordinal  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, variant_code)
);

CREATE TABLE IF NOT EXISTS placements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  variant_code  TEXT NOT NULL REFERENCES variants(code),
  ordinal       INTEGER NOT NULL,
  x_mm          INTEGER NOT NULL,
  y_mm          INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS placements_project_idx ON placements(project_id);

CREATE TABLE IF NOT EXISTS project_collaborators (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS quote_shares (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price_display  TEXT NOT NULL CHECK (price_display IN ('trade','retail','none')),
  recipients     JSONB NOT NULL,
  message        TEXT,
  pdf_status     TEXT NOT NULL CHECK (pdf_status IN ('pending','waiting_for_storage','ready')),
  pdf_key        TEXT,
  emails_sent_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_shares_unfinished_idx ON quote_shares(pdf_status)
  WHERE pdf_status IN ('pending','waiting_for_storage');

CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  occupation    TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  consent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS newsletter_email_idx ON newsletter_subscriptions(email);
`;
