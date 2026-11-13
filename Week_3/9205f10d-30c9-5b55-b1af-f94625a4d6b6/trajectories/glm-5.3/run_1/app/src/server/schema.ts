import { Pool } from "pg";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agency (
  id text PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS organisation (
  id text PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  hourly_rate_cents integer NOT NULL
);

CREATE TABLE IF NOT EXISTS person (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('coordinator','interpreter','client_scheduler','billing_admin')),
  display_name text NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  phone text,
  home_area text,
  pay_rate_cents integer,
  organisation_id text REFERENCES organisation(id)
);

CREATE TABLE IF NOT EXISTS request (
  id text PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  organisation_id text NOT NULL REFERENCES organisation(id),
  setting text NOT NULL CHECK (setting IN ('medical','education','legal')),
  required_credential text NOT NULL CHECK (required_credential IN ('NIC','CDI','SC:L','EIPA')),
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  city text NOT NULL,
  consumer_name text NOT NULL,
  location_address text NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('draft','submitted','half_staffed','staffed','completed','invoiced','cancelled_early','cancelled_late')),
  team_size integer NOT NULL CHECK (team_size IN (1,2)),
  team_reason text,
  rotation_minutes integer NOT NULL,
  actual_minutes integer,
  free_cancel_until timestamptz NOT NULL,
  created_by text NOT NULL REFERENCES person(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seat (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (label IN ('A','B')),
  status text NOT NULL CHECK (status IN ('open','confirmed')),
  interpreter_id text REFERENCES person(id),
  confirmed_at timestamptz,
  UNIQUE (request_id, label)
);

CREATE TABLE IF NOT EXISTS credential (
  id text PRIMARY KEY,
  interpreter_id text NOT NULL REFERENCES person(id),
  credential_type text NOT NULL CHECK (credential_type IN ('NIC','CDI','SC:L','EIPA')),
  status text NOT NULL CHECK (status IN ('uploaded','verified','expired')),
  expires_on date,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  file_name text,
  storage_key text
);

CREATE TABLE IF NOT EXISTS charge (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES request(id),
  organisation_id text NOT NULL REFERENCES organisation(id),
  kind text NOT NULL CHECK (kind IN ('interpreting','late_cancellation')),
  billable_minutes integer NOT NULL,
  seats integer NOT NULL,
  hourly_rate_cents integer NOT NULL,
  amount_cents integer NOT NULL,
  billing_status text NOT NULL CHECK (billing_status IN ('pending','posted')),
  killbill_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS history_entry (
  id bigserial PRIMARY KEY,
  request_id text NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id text REFERENCES person(id),
  actor_name text NOT NULL,
  action text NOT NULL,
  detail text NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_key (
  key text NOT NULL,
  user_id text NOT NULL REFERENCES person(id),
  endpoint text NOT NULL,
  request_id text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id, endpoint)
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kb_posting (
  charge_id text PRIMARY KEY REFERENCES charge(id),
  attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS seat_request_idx ON seat(request_id);
CREATE INDEX IF NOT EXISTS request_org_idx ON request(organisation_id);
CREATE INDEX IF NOT EXISTS request_starts_idx ON request(starts_at);
CREATE INDEX IF NOT EXISTS credential_interp_idx ON credential(interpreter_id);
CREATE INDEX IF NOT EXISTS charge_org_idx ON charge(organisation_id);
CREATE INDEX IF NOT EXISTS email_outbox_pending_idx ON email_outbox(id) WHERE attempts >= 0;
`;

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
