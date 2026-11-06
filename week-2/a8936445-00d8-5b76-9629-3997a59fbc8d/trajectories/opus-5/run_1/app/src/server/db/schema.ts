import { pool } from './pool.js';

const DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  business_name text NOT NULL,
  owner_name text NOT NULL,
  owner_email text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  killbill_account_id text
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL,
  tenant_id text REFERENCES tenants(id),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  hourly_rate_cents integer NOT NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS shelves (
  id text PRIMARY KEY,
  name text NOT NULL,
  monthly_rate_cents integer NOT NULL,
  tenant_id text REFERENCES tenants(id),
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS hour_packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  minutes integer NOT NULL,
  price_cents integer NOT NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS cancellation_policies (
  version integer PRIMARY KEY,
  free_window_hours integer NOT NULL,
  late_fee_percent integer NOT NULL,
  effective_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS holds (
  ref text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  station_id text NOT NULL REFERENCES stations(id),
  weeks integer NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  released_at timestamptz
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  hold_ref text NOT NULL REFERENCES holds(ref) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id),
  station_id text NOT NULL REFERENCES stations(id),
  booking_date date NOT NULL,
  start_local text NOT NULL,
  end_local text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL,
  elapsed_minutes integer NOT NULL,
  status text NOT NULL,
  pay_with text,
  amount_cents integer,
  policy_version integer REFERENCES cancellation_policies(version),
  notes text NOT NULL DEFAULT '',
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  holdover_reported_minutes integer,
  holdover_billed_minutes integer,
  holdover_amount_cents integer,
  cancelled_at timestamptz,
  cancellation_late boolean,
  cancellation_fee_cents integer,
  cancellation_fee_minutes integer,
  cancellation_fee_refunded boolean NOT NULL DEFAULT false,
  station_time_invoice_id uuid,
  holdover_invoice_id uuid,
  late_fee_invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_station_idx ON bookings (station_id, start_at);
CREATE INDEX IF NOT EXISTS bookings_tenant_idx ON bookings (tenant_id, start_at);

CREATE TABLE IF NOT EXISTS hour_ledger_entries (
  id uuid PRIMARY KEY,
  movement_id uuid NOT NULL,
  tenant_id text NOT NULL REFERENCES tenants(id),
  account text NOT NULL,
  minutes integer NOT NULL,
  reason text NOT NULL,
  booking_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hour_ledger_tenant_idx ON hour_ledger_entries (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  kind text NOT NULL,
  holder_name text,
  expires_on date NOT NULL,
  status text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  storage_key text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  rejection_reason text,
  reminder_sent_at timestamptz,
  seed_pdf bytea
);
CREATE INDEX IF NOT EXISTS documents_tenant_idx ON documents (tenant_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS inspection_links (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY,
  number text NOT NULL UNIQUE,
  tenant_id text NOT NULL REFERENCES tenants(id),
  period text NOT NULL,
  status text NOT NULL,
  subtotal_cents integer NOT NULL,
  tax_rate_percent text NOT NULL,
  tax_cents integer NOT NULL,
  total_cents integer NOT NULL,
  pdf_key text NOT NULL,
  issued_at timestamptz NOT NULL,
  paid_at timestamptz
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position integer NOT NULL,
  kind text NOT NULL,
  description text NOT NULL,
  booking_ref text,
  shelf_id text,
  amount_cents integer NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id uuid NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  idempotency_key text NOT NULL,
  body_fingerprint text NOT NULL,
  response_status integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, method, path, idempotency_key)
);

CREATE TABLE IF NOT EXISTS email_queue (
  id uuid PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pending_reversals (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  record_kind text NOT NULL,
  amount_cents integer NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  entity text NOT NULL,
  entity_id text NOT NULL,
  from_state text,
  to_state text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS seed_state (
  id boolean PRIMARY KEY DEFAULT true,
  seed_day date NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seed_state_single CHECK (id)
);

CREATE SEQUENCE IF NOT EXISTS hold_ref_seq START WITH 1003;
`;

export async function applySchema(): Promise<void> {
  await pool.query(DDL);
}
