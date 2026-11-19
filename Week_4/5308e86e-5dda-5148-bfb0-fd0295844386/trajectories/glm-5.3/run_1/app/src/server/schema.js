// The schema, applied on every start and again whenever the database first
// becomes reachable. The audit protection is installed with it.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  PRIMARY KEY (user_id, company_id)
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('checking','savings','treasury')),
  balance_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('ach','wire','rtp','check','card','transfer')),
  counterparty TEXT NOT NULL,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'posted',
  transfer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  seq BIGSERIAL NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_account_created_idx ON transactions (account_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  display_name TEXT NOT NULL,
  kind TEXT,
  method TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','pending','removed')),
  account_last4 TEXT,
  routing_number TEXT,
  account_number_enc BYTEA,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS recipients_company_status_idx ON recipients (company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS recipients_bank_details_idx
  ON recipients (company_id, routing_number, account_number_enc)
  WHERE status = 'active' AND account_number_enc IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recipients_pending_invite_idx
  ON recipients (company_id, lower(email))
  WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  source_account_id TEXT NOT NULL REFERENCES accounts(id),
  recipient_id TEXT,
  recipient_name TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('ach','wire','rtp','check')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  memo TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','scheduled','posted','rejected','cancelled','failed','expired')),
  scheduled_for DATE,
  effective_date DATE,
  expires_at TIMESTAMPTZ,
  approve_by DATE,
  fx_quote_id TEXT,
  total_debit_cents BIGINT NOT NULL,
  approvals_required INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  posted_seq BIGSERIAL
);
CREATE INDEX IF NOT EXISTS payments_company_status_idx ON payments (company_id, status);
CREATE INDEX IF NOT EXISTS payments_due_idx ON payments (status, effective_date);
CREATE TABLE IF NOT EXISTS payment_approvals (
  payment_id TEXT NOT NULL REFERENCES payments(id),
  user_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (payment_id, user_id)
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  total_cents BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','sent','paid')),
  paid_into_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  principal_cents BIGINT NOT NULL,
  drawn_cents BIGINT NOT NULL DEFAULT 0,
  funding_account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS fx_quotes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  currency TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  rate TEXT NOT NULL,
  foreign_amount_minor BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL,
  total_debit_cents BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_by_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS sign_in_failures (
  email TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_failures_email_idx ON sign_in_failures (email, at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  company_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_body BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (company_id, endpoint, key)
);
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  company TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS inquiries_email_idx ON inquiries (email, created_at);
CREATE TABLE IF NOT EXISTS audit_events (
  company_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  action TEXT NOT NULL,
  payment_id TEXT,
  amount_cents BIGINT NOT NULL,
  actor_email TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (company_id, seq)
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_cents BIGINT NOT NULL,
  annual_cents BIGINT NOT NULL,
  features TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION audit_events_protect() RETURNS void AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE RULE audit_events_no_update AS ON UPDATE TO audit_events DO INSTEAD
  (SELECT audit_events_protect());
CREATE OR REPLACE RULE audit_events_no_delete AS ON DELETE TO audit_events DO INSTEAD
  (SELECT audit_events_protect());
DO $audit_grant$
BEGIN
  -- The owner role loses its own TRUNCATE right, so the app's credentials
  -- cannot truncate the trail; inserts and the SELECTs the app reads with
  -- stay allowed.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_name = 'audit_events' AND privilege_type = 'TRUNCATE'
      AND grantee = current_user
  ) THEN
    EXECUTE format('REVOKE TRUNCATE ON audit_events FROM %I', current_user);
  END IF;
END
$audit_grant$;
`;
