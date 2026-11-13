import { query } from './db.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS agency (
     id text PRIMARY KEY,
     name text NOT NULL,
     time_zone text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS organisations (
     id text PRIMARY KEY,
     code text NOT NULL UNIQUE,
     name text NOT NULL,
     hourly_rate numeric(12,2) NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS people (
     id text PRIMARY KEY,
     role text NOT NULL,
     display_name text NOT NULL,
     full_name text NOT NULL,
     email text NOT NULL UNIQUE,
     password_hash text NOT NULL,
     phone text,
     home_area text,
     pay_rate numeric(12,2),
     organisation_id text REFERENCES organisations(id)
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id text PRIMARY KEY,
     person_id text NOT NULL REFERENCES people(id),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS requests (
     id text PRIMARY KEY,
     reference text NOT NULL UNIQUE,
     organisation_id text NOT NULL REFERENCES organisations(id),
     setting text NOT NULL,
     required_credential text NOT NULL,
     starts_at timestamptz NOT NULL,
     duration_minutes integer NOT NULL,
     city text NOT NULL,
     location_address text NOT NULL,
     consumer_name text NOT NULL,
     notes text NOT NULL DEFAULT '',
     status text NOT NULL,
     team_size integer NOT NULL,
     rotation_minutes integer NOT NULL,
     team_reason text,
     actual_minutes integer,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS seats (
     id text PRIMARY KEY,
     request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
     label text NOT NULL,
     status text NOT NULL,
     interpreter_id text REFERENCES people(id),
     confirmed_at timestamptz,
     UNIQUE (request_id, label)
   )`,
  `CREATE TABLE IF NOT EXISTS credentials (
     id text PRIMARY KEY,
     interpreter_id text NOT NULL REFERENCES people(id),
     credential_type text NOT NULL,
     verified boolean NOT NULL DEFAULT false,
     expires_on date,
     uploaded_at timestamptz NOT NULL DEFAULT now(),
     file_name text,
     storage_key text
   )`,
  `CREATE TABLE IF NOT EXISTS charges (
     id text PRIMARY KEY,
     request_id text NOT NULL REFERENCES requests(id),
     kind text NOT NULL,
     billable_minutes integer NOT NULL,
     seats integer NOT NULL,
     hourly_rate numeric(12,2) NOT NULL,
     amount numeric(12,2) NOT NULL,
     billing_status text NOT NULL,
     killbill_invoice_id text,
     created_at timestamptz NOT NULL DEFAULT now(),
     attempts integer NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS request_history (
     id bigserial PRIMARY KEY,
     request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
     at timestamptz NOT NULL DEFAULT now(),
     actor text NOT NULL,
     action text NOT NULL,
     detail text NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     person_id text NOT NULL REFERENCES people(id),
     key text NOT NULL,
     endpoint text NOT NULL,
     request_id text NOT NULL,
     body_hash text NOT NULL,
     response_status integer NOT NULL,
     response_body text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (person_id, key)
   )`,
  `CREATE TABLE IF NOT EXISTS outgoing_emails (
     id text PRIMARY KEY,
     to_address text NOT NULL,
     subject text NOT NULL,
     body text NOT NULL,
     sent_at timestamptz,
     attempts integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS killbill_accounts (
     organisation_id text PRIMARY KEY REFERENCES organisations(id),
     killbill_account_id text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS counters (
     name text PRIMARY KEY,
     value bigint NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS requests_starts_at_idx ON requests (starts_at, reference)`,
  `CREATE INDEX IF NOT EXISTS seats_interpreter_idx ON seats (interpreter_id)`,
  `CREATE INDEX IF NOT EXISTS credentials_interpreter_idx ON credentials (interpreter_id)`,
  `CREATE INDEX IF NOT EXISTS charges_pending_idx ON charges (billing_status)`,
  `CREATE INDEX IF NOT EXISTS outgoing_emails_pending_idx ON outgoing_emails (sent_at)`,
  `CREATE INDEX IF NOT EXISTS request_history_request_idx ON request_history (request_id, id)`,
];

export async function applySchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await query(statement);
  }
}
