import type { Queryable } from './db.js';

// Applied idempotently on every boot.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('coordinator','interpreter','requester','consumer','billing')),
  org_id text,
  passcode_hash text NOT NULL,
  killbill_account_id text
);
CREATE INDEX IF NOT EXISTS users_org_idx ON users (org_id);

CREATE TABLE IF NOT EXISTS orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  killbill_account_id text
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS consumers (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS interpreters (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id text PRIMARY KEY,
  interpreter_id text NOT NULL REFERENCES interpreters(id),
  type text NOT NULL CHECK (type IN ('NIC','CDI','SC:L','EIPA-4.0')),
  number text NOT NULL,
  expires_on text NOT NULL,
  scan_key text NOT NULL,
  scan_filename text NOT NULL,
  warning_sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS consumer_preferences (
  consumer_id text NOT NULL REFERENCES consumers(id),
  interpreter_id text NOT NULL REFERENCES interpreters(id),
  kind text NOT NULL CHECK (kind IN ('preferred','blocked')),
  PRIMARY KEY (consumer_id, interpreter_id)
);

CREATE TABLE IF NOT EXISTS requests (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  org_id text NOT NULL REFERENCES orgs(id),
  title text NOT NULL,
  setting text NOT NULL CHECK (setting IN ('medical','legal','education','community')),
  location text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  consumer_id text NOT NULL REFERENCES consumers(id),
  notes text NOT NULL DEFAULT '',
  logged_after boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('draft','submitted','partially_staffed','staffed','completed','invoiced','cancelled_on_time','cancelled_late')),
  cancellation_fee_cents integer,
  cancel_quote jsonb,
  seats_total integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_start_idx ON requests (start_at);
CREATE INDEX IF NOT EXISTS requests_org_idx ON requests (org_id);

CREATE TABLE IF NOT EXISTS seats (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES requests(id),
  position integer NOT NULL,
  status text NOT NULL CHECK (status IN ('open','offered','accepted')),
  interpreter_id text REFERENCES interpreters(id),
  held_by_user_id text REFERENCES users(id),
  UNIQUE (request_id, position)
);
CREATE INDEX IF NOT EXISTS seats_request_idx ON seats (request_id);

CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY,
  message_id text NOT NULL UNIQUE,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sending','sent')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  sent_at timestamptz,
  sending_owner text,
  last_error text
);

CREATE TABLE IF NOT EXISTS offers (
  id text PRIMARY KEY,
  seat_id text NOT NULL REFERENCES seats(id),
  interpreter_id text NOT NULL REFERENCES interpreters(id),
  coordinator_user_id text REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('active','accepted','declined','expired','withdrawn')),
  token text NOT NULL UNIQUE,
  sent_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  email_state text NOT NULL DEFAULT 'queued' CHECK (email_state IN ('queued','sent')),
  outbox_id text REFERENCES outbox(id)
);
CREATE INDEX IF NOT EXISTS offers_seat_idx ON offers (seat_id);
CREATE INDEX IF NOT EXISTS offers_interpreter_idx ON offers (interpreter_id);

CREATE TABLE IF NOT EXISTS timesheets (
  id text PRIMARY KEY,
  seat_id text NOT NULL REFERENCES seats(id),
  interpreter_id text NOT NULL REFERENCES interpreters(id),
  request_id text NOT NULL REFERENCES requests(id),
  actual_start timestamptz NOT NULL,
  actual_end timestamptz NOT NULL,
  signature_name text NOT NULL,
  billed_hours text NOT NULL,
  status text NOT NULL CHECK (status IN ('submitted','approved')),
  hourly_rate_cents integer,
  amount_cents integer,
  killbill_invoice_id text,
  approved_at timestamptz,
  pdf_key text,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS timesheets_seat_idx ON timesheets (seat_id);

CREATE TABLE IF NOT EXISTS prep_files (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES requests(id),
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS prep_files_request_idx ON prep_files (request_id);

CREATE TABLE IF NOT EXISTS rates (
  setting text PRIMARY KEY CHECK (setting IN ('medical','legal','education','community')),
  hourly_rate_cents integer NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_user_id text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  from_status text,
  to_status text,
  detail jsonb
);
CREATE INDEX IF NOT EXISTS audit_request_idx ON audit_log (entity_id);

CREATE INDEX IF NOT EXISTS outbox_state_idx ON outbox (state, next_attempt_at);

CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  scope text NOT NULL,
  status integer NOT NULL,
  body text NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);
`;

export async function applySchema(client: Queryable): Promise<void> {
  await client.query(SCHEMA_SQL);
}
