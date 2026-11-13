import { pool } from "./db.js";
import { seedOnce } from "./seed.js";

/** Applied every time the app starts serving; every statement is idempotent. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS agency (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS organisations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  hourly_rate_cents integer NOT NULL CHECK (hourly_rate_cents > 0)
);

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role text NOT NULL CHECK (role IN ('coordinator', 'interpreter', 'client_scheduler', 'billing_admin')),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  organisation_id text REFERENCES organisations(id),
  phone text,
  home_area text,
  pay_rate_cents integer
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  expires_at timestamptz NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS request_reference_seq START 1001;

CREATE TABLE IF NOT EXISTS requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reference text NOT NULL UNIQUE,
  organisation_id text NOT NULL REFERENCES organisations(id),
  setting text NOT NULL CHECK (setting IN ('medical', 'education', 'legal')),
  required_credential text NOT NULL CHECK (required_credential IN ('NIC', 'CDI', 'SC:L', 'EIPA')),
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 30 AND 480),
  consumer_name text NOT NULL,
  location_address text NOT NULL,
  city text NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'half-staffed', 'staffed', 'completed', 'invoiced',
                                         'cancelled_early', 'cancelled_late')),
  team_size integer CHECK (team_size IN (1, 2)),
  rotation_minutes integer CHECK (rotation_minutes BETWEEN 20 AND 30),
  team_reason text,
  actual_minutes integer CHECK (actual_minutes BETWEEN 1 AND 720),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_starts_at ON requests (starts_at);

CREATE TABLE IF NOT EXISTS seats (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_id text NOT NULL REFERENCES requests(id),
  label text NOT NULL CHECK (label IN ('A', 'B')),
  interpreter_id text REFERENCES people(id),
  confirmed_at timestamptz,
  UNIQUE (request_id, label)
);
CREATE INDEX IF NOT EXISTS seats_interpreter ON seats (interpreter_id);

CREATE TABLE IF NOT EXISTS credentials (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  interpreter_id text NOT NULL REFERENCES people(id),
  credential_type text NOT NULL CHECK (credential_type IN ('NIC', 'CDI', 'SC:L', 'EIPA')),
  verified_at timestamptz,
  expires_on date,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  file_name text,
  storage_key text
);
CREATE INDEX IF NOT EXISTS credentials_interpreter ON credentials (interpreter_id);

CREATE TABLE IF NOT EXISTS history (
  id bigserial PRIMARY KEY,
  request_id text NOT NULL REFERENCES requests(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  detail text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS history_request ON history (request_id, id);

CREATE TABLE IF NOT EXISTS charges (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  position bigserial,
  request_id text NOT NULL REFERENCES requests(id),
  kind text NOT NULL CHECK (kind IN ('interpreting', 'late_cancellation')),
  billable_minutes integer NOT NULL,
  seats integer NOT NULL,
  hourly_rate_cents integer NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  killbill_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, kind)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id text NOT NULL REFERENCES people(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  status_code integer NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, key)
);

CREATE TABLE IF NOT EXISTS outgoing_emails (
  id bigserial PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outgoing_emails_unsent ON outgoing_emails (id) WHERE sent_at IS NULL;
`;

/** Several instances may start against one database: one advisory lock serialises schema and seed. */
const SCHEMA_LOCK = 41730001;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(SCHEMA);
    await seedOnce(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
    client.release();
  }
}
