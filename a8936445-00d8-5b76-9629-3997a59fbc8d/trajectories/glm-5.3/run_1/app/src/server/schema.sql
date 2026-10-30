-- Schema for the system of record. Idempotent on every start against empty or existing databases.

CREATE TABLE IF NOT EXISTS kitchen (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  time_zone     TEXT NOT NULL,
  tax_rate_percent NUMERIC(5,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('operator','owner','cook')),
  tenant_id     TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('applied','documents_review','active','suspended','offboarded')),
  owner_name    TEXT NOT NULL,
  owner_email   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('hot_line','bake_deck','cold_prep')),
  hourly_rate_cents INT NOT NULL,
  dial_order    INT NOT NULL
);

CREATE TABLE IF NOT EXISTS shelves (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  monthly_rate_cents INT NOT NULL,
  tenant_id     TEXT REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS hour_packs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  minutes       INT NOT NULL,
  price_cents   INT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_versions (
  version       INT PRIMARY KEY,
  free_window_hours INT NOT NULL,
  late_fee_percent INT NOT NULL,
  effective_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS holds (
  ref           TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  station_id    TEXT NOT NULL REFERENCES stations(id),
  weeks         INT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id            TEXT PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,
  hold_ref      TEXT NOT NULL REFERENCES holds(ref) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  station_id    TEXT NOT NULL REFERENCES stations(id),
  date          DATE NOT NULL,
  start_local   TEXT NOT NULL,
  end_local     TEXT NOT NULL,
  start         TIMESTAMPTZ NOT NULL,
  "end"         TIMESTAMPTZ NOT NULL,
  elapsed_minutes INT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('held','confirmed','checked_in','completed','cancelled','no_show')),
  pay_with      TEXT CHECK (pay_with IN ('account','hour_pack')),
  amount_cents  INT,
  policy_version INT REFERENCES policy_versions(version),
  notes         TEXT NOT NULL DEFAULT '',
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  holdover_reported_minutes INT,
  holdover_billed_minutes INT,
  holdover_cents INT,
  cancelled_at  TIMESTAMPTZ,
  cancelled_late BOOLEAN,
  fee_cents     INT NOT NULL DEFAULT 0,
  fee_minutes   INT NOT NULL DEFAULT 0,
  fee_refunded  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_station_date ON bookings (station_id, date);
CREATE INDEX IF NOT EXISTS bookings_tenant ON bookings (tenant_id);

CREATE TABLE IF NOT EXISTS hour_ledger_entries (
  id            TEXT PRIMARY KEY,
  movement_id   TEXT NOT NULL,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  account       TEXT NOT NULL CHECK (account IN ('tenant_pack','kitchen_hours')),
  minutes       INT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('opening_balance','pack_purchase','booking','cancellation_return','fee_refund')),
  booking_id    TEXT REFERENCES bookings(id),
  created_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS hour_ledger_tenant ON hour_ledger_entries (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS purchases (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  pack_id       TEXT NOT NULL REFERENCES hour_packs(id),
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  kind          TEXT NOT NULL CHECK (kind IN ('certificate_of_insurance','food_handler_card','health_permit')),
  holder_name   TEXT,
  expires_on    DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending_review','approved','rejected')),
  file_name     TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INT NOT NULL,
  storage_key   TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL,
  reviewed_at   TIMESTAMPTZ,
  rejection_reason TEXT,
  reminder_sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS documents_tenant ON documents (tenant_id);

CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  period        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('issued','paid')),
  subtotal_cents INT NOT NULL,
  tax_rate_percent TEXT NOT NULL,
  tax_cents     INT NOT NULL,
  total_cents   INT NOT NULL,
  pdf_key       TEXT,
  issued_at     TIMESTAMPTZ NOT NULL,
  paid_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invoices_tenant ON invoices (tenant_id, issued_at);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id),
  position      INT NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL CHECK (kind IN ('station_time','holdover','late_fee','storage')),
  description   TEXT NOT NULL,
  booking_id    TEXT,
  shelf_id      TEXT,
  booking_ref    TEXT,
  amount_cents  INT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_booking_kind ON invoice_lines (booking_id, kind) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_shelf_period ON invoice_lines (shelf_id, description) WHERE shelf_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inspection_links (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  token         TEXT NOT NULL UNIQUE,
  issued_at     TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  replaced_by   TEXT
);
CREATE INDEX IF NOT EXISTS inspection_links_tenant ON inspection_links (tenant_id);

CREATE TABLE IF NOT EXISTS email_queue (
  id            TEXT PRIMARY KEY,
  to_email      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS email_queue_pending ON email_queue (sent_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS kb_reversals (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  kind          TEXT NOT NULL CHECK (kind IN ('charge','credit')),
  description   TEXT NOT NULL,
  amount_cents  INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  recorded_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stored_responses (
  user_id       TEXT NOT NULL,
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  status        INT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, method, path, key)
);

CREATE TABLE IF NOT EXISTS seed_state (
  id            TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL,
  actor_user_id TEXT,
  action        TEXT NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     TEXT,
  detail        JSONB NOT NULL
);

-- Updates for databases created before a column existed.
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
