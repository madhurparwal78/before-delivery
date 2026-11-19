CREATE TABLE IF NOT EXISTS app_state (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  company_id text NOT NULL REFERENCES companies(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL,
  UNIQUE (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('checking', 'savings', 'treasury')),
  balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_company_idx ON accounts (company_id, position, created_at);

CREATE TABLE IF NOT EXISTS transactions (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  account_id text NOT NULL REFERENCES accounts(id),
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  method text NOT NULL CHECK (method IN ('ach', 'wire', 'rtp', 'check', 'card', 'transfer')),
  counterparty text NOT NULL,
  memo text,
  transfer_id text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_feed_idx ON transactions (company_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_account_idx ON transactions (account_id, created_at);

CREATE TABLE IF NOT EXISTS recipients (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  display_name text NOT NULL,
  kind text CHECK (kind IN ('person', 'business')),
  method text CHECK (method IN ('ach', 'wire', 'rtp', 'check')),
  status text NOT NULL CHECK (status IN ('active', 'pending', 'removed')),
  account_last4 text,
  account_fingerprint text,
  routing_number text,
  email text,
  created_at timestamptz NOT NULL,
  removed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS recipients_bank_account_idx
  ON recipients (company_id, account_fingerprint)
  WHERE status = 'active' AND account_fingerprint IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recipients_pending_email_idx
  ON recipients (company_id, email)
  WHERE status = 'pending' AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS recipients_company_idx ON recipients (company_id, created_at);

CREATE TABLE IF NOT EXISTS fx_quotes (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  currency text NOT NULL,
  amount_cents bigint NOT NULL,
  rate text NOT NULL,
  foreign_amount_minor bigint NOT NULL,
  fee_cents bigint NOT NULL,
  total_debit_cents bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  used_by_payment_id text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  source_account_id text NOT NULL REFERENCES accounts(id),
  recipient_id text NOT NULL REFERENCES recipients(id),
  recipient_name text NOT NULL,
  method text NOT NULL CHECK (method IN ('ach', 'wire', 'rtp', 'check')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  total_debit_cents bigint NOT NULL CHECK (total_debit_cents > 0),
  memo text,
  status text NOT NULL CHECK (status IN ('pending_approval', 'scheduled', 'posted', 'rejected', 'cancelled', 'failed', 'expired')),
  scheduled_for date,
  effective_date date,
  expires_at timestamptz,
  approve_by date,
  fx_quote_id text REFERENCES fx_quotes(id),
  approvals_required smallint NOT NULL,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_company_idx ON payments (company_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS payments_pending_idx ON payments (status, expires_at);
CREATE INDEX IF NOT EXISTS payments_scheduled_idx ON payments (status, effective_date);

CREATE TABLE IF NOT EXISTS payment_approvals (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(id),
  user_id text NOT NULL REFERENCES users(id),
  user_name text NOT NULL,
  approved_at timestamptz NOT NULL,
  UNIQUE (payment_id, user_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  number text NOT NULL,
  customer_name text NOT NULL,
  total_cents bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'sent', 'paid')),
  paid_into_account_id text REFERENCES accounts(id),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_company_idx ON invoices (company_id, position);

CREATE TABLE IF NOT EXISTS loans (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  principal_cents bigint NOT NULL,
  drawn_cents bigint NOT NULL DEFAULT 0,
  funding_account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS loans_company_idx ON loans (company_id, created_at);

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  monthly_cents bigint NOT NULL,
  annual_cents bigint NOT NULL,
  features jsonb NOT NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inquiries (
  id text PRIMARY KEY,
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  company text NOT NULL,
  message text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS inquiries_email_idx ON inquiries (email, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  seq bigint NOT NULL,
  action text NOT NULL,
  payment_id text,
  amount_cents bigint NOT NULL,
  actor_email text NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (company_id, seq)
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id),
  company_id text NOT NULL REFERENCES companies(id),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS login_failures (
  id text PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_email_idx ON login_failures (email, created_at);

CREATE TABLE IF NOT EXISTS login_attempt_locks (
  email text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS inquiry_email_locks (
  email text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  company_id text NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  request_fingerprint text NOT NULL,
  response_status integer NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, endpoint, key)
);

CREATE OR REPLACE FUNCTION tallwind_audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit trail is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only_row ON audit_events;
CREATE TRIGGER audit_events_append_only_row
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION tallwind_audit_append_only();

DROP TRIGGER IF EXISTS audit_events_append_only_truncate ON audit_events;
CREATE TRIGGER audit_events_append_only_truncate
  BEFORE TRUNCATE ON audit_events
  EXECUTE FUNCTION tallwind_audit_append_only();
