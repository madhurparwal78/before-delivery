import type { Pool } from 'pg';

/**
 * Postgres schema for Lockset. Applied on every start without losing data:
 * every statement is additive (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  handle text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'invited',
  aliases text[] NOT NULL DEFAULT '{}',
  term_starts_on date,
  term_ends_on date,
  left_at timestamptz,
  first_signed_in_at timestamptz,
  created_seq bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS people_email_uidx ON people (email);
CREATE UNIQUE INDEX IF NOT EXISTS people_handle_uidx ON people (handle);

CREATE TABLE IF NOT EXISTS vaults (
  id text PRIMARY KEY,
  name text NOT NULL,
  formerly text,
  off_when_travelling boolean NOT NULL DEFAULT false,
  position int NOT NULL,
  created_seq bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS vaults_name_uidx ON vaults (lower(name));

CREATE TABLE IF NOT EXISTS vault_scopes (
  person_id text NOT NULL REFERENCES people(id),
  vault_id text NOT NULL REFERENCES vaults(id),
  PRIMARY KEY (person_id, vault_id)
);

CREATE TABLE IF NOT EXISTS vendors (
  id text PRIMARY KEY,
  name text NOT NULL,
  formerly text,
  domain text NOT NULL,
  created_seq bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS vendors_domain_uidx ON vendors (lower(domain));

CREATE TABLE IF NOT EXISTS vendor_renames (
  id text PRIMARY KEY,
  vendor_id text NOT NULL REFERENCES vendors(id),
  old_name text NOT NULL,
  new_name text NOT NULL,
  by_person_id text,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_renames (
  id text PRIMARY KEY,
  vault_id text NOT NULL REFERENCES vaults(id),
  old_name text NOT NULL,
  new_name text NOT NULL,
  by_person_id text,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id text PRIMARY KEY,
  vault_id text NOT NULL REFERENCES vaults(id),
  vendor_id text NOT NULL REFERENCES vendors(id),
  label text NOT NULL,
  username text NOT NULL,
  secret_enc bytea NOT NULL,
  secret_fingerprint text NOT NULL,
  last_turned_on date,
  out_of_policy_since date,
  created_seq bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS credentials_uidx ON credentials (vault_id, vendor_id, lower(username));

CREATE TABLE IF NOT EXISTS credential_holders (
  credential_id text NOT NULL REFERENCES credentials(id),
  person_id text NOT NULL REFERENCES people(id),
  holder_left boolean NOT NULL DEFAULT false,
  PRIMARY KEY (credential_id, person_id)
);

CREATE TABLE IF NOT EXISTS rules (
  id text PRIMARY KEY,
  vault_id text NOT NULL REFERENCES vaults(id),
  min_length int NOT NULL,
  effective_on date NOT NULL,
  state text NOT NULL,
  version int NOT NULL,
  drafted_by text NOT NULL,
  signed_by text,
  created_seq bigint NOT NULL,
  state_changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rotations (
  id text PRIMARY KEY,
  credential_id text NOT NULL REFERENCES credentials(id),
  interval_days int NOT NULL,
  at_time text NOT NULL,
  first_run_on date NOT NULL,
  created_seq bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rotations_credential_uidx ON rotations (credential_id);

CREATE TABLE IF NOT EXISTS turns (
  id text PRIMARY KEY,
  credential_id text NOT NULL REFERENCES credentials(id),
  rotation_id text REFERENCES rotations(id),
  kind text NOT NULL,
  due_by date NOT NULL,
  at timestamptz,
  state text NOT NULL,
  shifted boolean NOT NULL DEFAULT false,
  became_due_at timestamptz,
  turned_at timestamptz,
  confirmed_by text,
  created_seq bigint NOT NULL,
  office_date date NOT NULL,
  office_time text NOT NULL,
  offset_abbrev text NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_credential_idx ON turns (credential_id, state);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_reason text
);

CREATE TABLE IF NOT EXISTS sign_in_failures (
  id text PRIMARY KEY,
  handle text NOT NULL,
  at timestamptz NOT NULL,
  locked_until timestamptz
);
CREATE INDEX IF NOT EXISTS sign_in_failures_handle_idx ON sign_in_failures (handle, at);

CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY,
  quarter text NOT NULL,
  opened_on date NOT NULL,
  overdue_from date NOT NULL,
  status text NOT NULL,
  signed_off_by text,
  signed_off_at timestamptz
);

CREATE TABLE IF NOT EXISTS review_lines (
  id text PRIMARY KEY,
  review_id text NOT NULL REFERENCES reviews(id),
  person_id text NOT NULL REFERENCES people(id),
  vault_id text NOT NULL REFERENCES vaults(id),
  decision text NOT NULL DEFAULT 'undecided',
  decided_by text,
  decided_via text,
  position int NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS review_lines_uidx ON review_lines (review_id, person_id, vault_id);

CREATE TABLE IF NOT EXISTS travel_windows (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_seq bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS seat_changes (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  change text NOT NULL,
  state text NOT NULL,
  since timestamptz NOT NULL,
  kb_subscription_id text,
  kb_bundle_id text,
  confirmed_at timestamptz
);
CREATE INDEX IF NOT EXISTS seat_changes_person_idx ON seat_changes (person_id, state);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id text PRIMARY KEY,
  person_id text NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status int NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_uidx ON idempotency_keys (person_id, endpoint, key);

CREATE TABLE IF NOT EXISTS audit_seq_state (
  id boolean PRIMARY KEY DEFAULT true,
  last_seq bigint NOT NULL
);
INSERT INTO audit_seq_state (id, last_seq)
VALUES (true, 0)
ON CONFLICT (id) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS row_seq_seq START 1000000;

CREATE TABLE IF NOT EXISTS audit_entries (
  id text PRIMARY KEY,
  seq bigint NOT NULL,
  at timestamptz NOT NULL,
  office_day date NOT NULL,
  office_time text NOT NULL,
  offset_abbrev text NOT NULL,
  actor_kind text NOT NULL,
  actor_person_id text,
  actor_name text,
  action text NOT NULL,
  subject_kind text NOT NULL,
  subject_id text,
  subject_name text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_seq_uidx ON audit_entries (seq);
CREATE INDEX IF NOT EXISTS audit_day_idx ON audit_entries (office_day, seq);

CREATE TABLE IF NOT EXISTS imports (
  id text PRIMARY KEY,
  filename text NOT NULL,
  created_at timestamptz NOT NULL,
  counts jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS import_rows (
  id text PRIMARY KEY,
  import_id text NOT NULL REFERENCES imports(id),
  row int NOT NULL,
  outcome text NOT NULL,
  credential_id text,
  reason text,
  names jsonb NOT NULL DEFAULT '[]'::jsonb,
  vault_name text,
  login_for text,
  website text,
  username text,
  last_changed text,
  who_knows jsonb,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS import_rows_uidx ON import_rows (import_id, row);

CREATE TABLE IF NOT EXISTS breach_checks (
  id text PRIMARY KEY,
  ran_at timestamptz NOT NULL,
  office_day date NOT NULL,
  feed_ok boolean NOT NULL,
  counts jsonb NOT NULL,
  credential_health jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS held_row_secrets (
  import_id text NOT NULL REFERENCES imports(id),
  row_number int NOT NULL,
  held_secret bytea NOT NULL,
  PRIMARY KEY (import_id, row_number)
);
`;

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
