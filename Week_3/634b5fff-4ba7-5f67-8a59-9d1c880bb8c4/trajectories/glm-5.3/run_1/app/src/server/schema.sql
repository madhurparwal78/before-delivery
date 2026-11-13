-- System of record. Applied idempotently on every serve.
CREATE TABLE IF NOT EXISTS boxes (
  number       INT PRIMARY KEY CHECK (number >= 1 AND number <= 240),
  plate        TEXT NOT NULL,
  box_state    TEXT NOT NULL DEFAULT 'available'
);

CREATE TABLE IF NOT EXISTS rate_changes (
  id               BIGSERIAL PRIMARY KEY,
  rate_bps         INT NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  effective_from   TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  reference            TEXT PRIMARY KEY,
  order_token          TEXT NOT NULL,
  number               INT NOT NULL REFERENCES boxes(number),
  plate                TEXT NOT NULL,
  method               TEXT NOT NULL CHECK (method IN ('card','bank')),
  payment_state        TEXT NOT NULL,
  box_state            TEXT NOT NULL,
  buyer_name           TEXT NOT NULL,
  buyer_email          TEXT NOT NULL,
  address_street       TEXT NOT NULL,
  address_postcode     TEXT NOT NULL,
  address_city         TEXT NOT NULL,
  gift_recipient_name  TEXT,
  gift_recipient_email TEXT,
  gift_message         TEXT,
  rate_bps             INT NOT NULL,
  total_ore            INT NOT NULL,
  gross_ore            INT NOT NULL,
  net_ore              INT NOT NULL,
  vat_ore              INT NOT NULL,
  charity_ore          INT NOT NULL,
  maker_ore            INT NOT NULL,
  courier_ore          INT NOT NULL,
  gateway_fee_ore      INT,
  authorised_at        TIMESTAMPTZ,
  paid_at              TIMESTAMPTZ,
  certificate_state    TEXT NOT NULL DEFAULT 'none',
  certificate_key      TEXT,
  tracking_code        TEXT,
  kb_account_id        TEXT,
  kb_invoice_id        TEXT,
  kb_payment_id        TEXT,
  gateway_payment_id   TEXT,
  gateway_transfer_id  TEXT,
  hold_token           TEXT,
  hold_expires_at      TIMESTAMPTZ,
  auth_expires_at      TIMESTAMPTZ,
  transfer_deadline_at TIMESTAMPTZ,
  transfer_iban        TEXT,
  transfer_reference   TEXT,
  challenge_id         TEXT,
  challenge_expires_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live claim per number, backed by the database.
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_live_claim
  ON orders (number)
  WHERE box_state IN ('held','claimed','awaiting_transfer','packed','shipped','returned');

CREATE TABLE IF NOT EXISTS split_lines (
  id            BIGSERIAL PRIMARY KEY,
  reference     TEXT NOT NULL REFERENCES orders(reference),
  kind          TEXT NOT NULL CHECK (kind IN ('sale','refund')),
  gross_ore     INT NOT NULL,
  net_ore       INT NOT NULL,
  vat_ore       INT NOT NULL,
  charity_ore   INT NOT NULL,
  maker_ore     INT NOT NULL,
  rate_bps      INT NOT NULL,
  posted_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refunds (
  refund_id     TEXT PRIMARY KEY,
  reference     TEXT NOT NULL REFERENCES orders(reference),
  state         TEXT NOT NULL CHECK (state IN ('pending','settled')),
  amount_ore    INT NOT NULL,
  net_ore       INT NOT NULL,
  vat_ore       INT NOT NULL,
  charity_ore   INT NOT NULL,
  maker_ore     INT NOT NULL,
  gateway_refund_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payment_events (
  event_id      TEXT PRIMARY KEY,
  reference     TEXT NOT NULL REFERENCES orders(reference),
  sequence      INT NOT NULL,
  type          TEXT NOT NULL,
  refund_id     TEXT,
  amount_ore    INT,
  decline_code  TEXT,
  applied_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key           TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  reference     TEXT NOT NULL,
  status        INT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statements (
  id                 TEXT PRIMARY KEY,
  month              TEXT NOT NULL,
  revision           INT NOT NULL,
  charity_total_ore  INT NOT NULL,
  maker_total_ore    INT NOT NULL,
  vat_total_ore      INT NOT NULL,
  object_key         TEXT NOT NULL,
  token              TEXT NOT NULL,
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_events (
  event_id      TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  reference     TEXT NOT NULL,
  box_number    INT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  published     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS pending_alerts (
  id            BIGSERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_alert_state (
  threshold     INT PRIMARY KEY,
  last_remaining INT
);

CREATE TABLE IF NOT EXISTS tale_passages (
  passage_id    TEXT PRIMARY KEY,
  chapter       TEXT NOT NULL,
  ordinal       INT NOT NULL,
  text          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenge_attempts (
  challenge_id   TEXT PRIMARY KEY,
  reference      TEXT NOT NULL REFERENCES orders(reference),
  attempt_key    TEXT NOT NULL,
  payment_id     TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS plate_art (
  plate          TEXT PRIMARY KEY,
  object_key     TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  bytes          INT NOT NULL,
  width          INT NOT NULL,
  height         INT NOT NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_effects (
  reference      TEXT NOT NULL,
  type           TEXT NOT NULL,
  effects        TEXT NOT NULL,
  PRIMARY KEY (reference, type)
);

CREATE TABLE IF NOT EXISTS delayed_retries (
  event_id       TEXT PRIMARY KEY,
  payload        TEXT NOT NULL,
  not_before     TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS dismissed_events (
  event_id       TEXT PRIMARY KEY,
  note           TEXT NOT NULL,
  dismissed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);
