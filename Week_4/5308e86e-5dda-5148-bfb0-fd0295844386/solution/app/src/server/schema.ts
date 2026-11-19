/** The database schema, applied on every start; the audit trail refuses edits at the database. */
import { transaction } from "./db.js";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS companies (
     id uuid PRIMARY KEY,
     name text NOT NULL,
     created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY,
     email text NOT NULL UNIQUE,
     name text NOT NULL,
     password_hash text NOT NULL,
     created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memberships (
     user_id uuid PRIMARY KEY REFERENCES users(id),
     company_id uuid NOT NULL REFERENCES companies(id),
     role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')))`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id),
     created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_failures (
     email text NOT NULL,
     failed_at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS login_failures_email ON login_failures (email, failed_at)`,
  `CREATE TABLE IF NOT EXISTS accounts (
     id uuid PRIMARY KEY,
     position bigserial,
     company_id uuid NOT NULL REFERENCES companies(id),
     name text NOT NULL,
     kind text NOT NULL CHECK (kind IN ('checking', 'savings', 'treasury')),
     balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
     created_at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS accounts_company ON accounts (company_id, position)`,
  `CREATE TABLE IF NOT EXISTS transactions (
     id uuid PRIMARY KEY,
     company_id uuid NOT NULL REFERENCES companies(id),
     account_id uuid NOT NULL REFERENCES accounts(id),
     direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
     amount_cents bigint NOT NULL CHECK (amount_cents > 0),
     method text NOT NULL,
     counterparty text NOT NULL,
     memo text,
     transfer_id uuid,
     created_at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS transactions_account_feed ON transactions (account_id, created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS transactions_company_feed ON transactions (company_id, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS recipients (
     id uuid PRIMARY KEY,
     company_id uuid NOT NULL REFERENCES companies(id),
     kind text,
     method text,
     display_name text NOT NULL,
     status text NOT NULL CHECK (status IN ('active', 'pending', 'removed')),
     account_last4 text,
     email text,
     bank_fingerprint text,
     created_at timestamptz NOT NULL,
     removed_at timestamptz)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS recipients_active_bank ON recipients (company_id, bank_fingerprint) WHERE status = 'active'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS recipients_pending_email ON recipients (company_id, email) WHERE status = 'pending'`,
  `CREATE TABLE IF NOT EXISTS fx_quotes (
     id uuid PRIMARY KEY,
     company_id uuid NOT NULL REFERENCES companies(id),
     currency text NOT NULL,
     amount_cents bigint NOT NULL,
     rate text NOT NULL,
     foreign_amount_minor bigint NOT NULL,
     fee_cents bigint NOT NULL,
     total_debit_cents bigint NOT NULL,
     created_at timestamptz NOT NULL,
     expires_at timestamptz NOT NULL,
     used_by_payment uuid)`,
  `CREATE TABLE IF NOT EXISTS payments (
     id uuid PRIMARY KEY,
     company_id uuid NOT NULL REFERENCES companies(id),
     source_account_id uuid NOT NULL REFERENCES accounts(id),
     recipient_id uuid NOT NULL REFERENCES recipients(id),
     recipient_name text NOT NULL,
     method text NOT NULL,
     amount_cents bigint NOT NULL CHECK (amount_cents > 0),
     total_debit_cents bigint NOT NULL CHECK (total_debit_cents > 0),
     memo text,
     status text NOT NULL CHECK (status IN ('pending_approval', 'scheduled', 'posted', 'rejected', 'cancelled', 'failed', 'expired')),
     scheduled_for date,
     effective_date date,
     expires_at timestamptz,
     approve_by date,
     fx_quote_id uuid,
     approvals_required integer NOT NULL,
     created_by uuid NOT NULL REFERENCES users(id),
     created_at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS payments_company ON payments (company_id, created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS payments_hold ON payments (source_account_id) WHERE status = 'pending_approval'`,
  `CREATE INDEX IF NOT EXISTS payments_recipient ON payments (recipient_id)`,
  `CREATE INDEX IF NOT EXISTS payments_due ON payments (status, effective_date, expires_at)`,
  `CREATE TABLE IF NOT EXISTS payment_approvals (
     payment_id uuid NOT NULL REFERENCES payments(id),
     user_id uuid NOT NULL REFERENCES users(id),
     name text NOT NULL,
     approved_at timestamptz NOT NULL,
     PRIMARY KEY (payment_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS invoices (
     id uuid PRIMARY KEY,
     company_id uuid NOT NULL REFERENCES companies(id),
     number text NOT NULL,
     customer_name text NOT NULL,
     total_cents bigint NOT NULL,
     status text NOT NULL CHECK (status IN ('draft', 'sent', 'paid')),
     paid_into_account_id uuid REFERENCES accounts(id),
     created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS loans (
     id uuid PRIMARY KEY,
     company_id uuid NOT NULL REFERENCES companies(id),
     name text NOT NULL,
     principal_cents bigint NOT NULL,
     drawn_cents bigint NOT NULL DEFAULT 0 CHECK (drawn_cents <= principal_cents),
     funding_account_id uuid NOT NULL REFERENCES accounts(id),
     created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS plans (
     id uuid PRIMARY KEY,
     name text NOT NULL UNIQUE,
     monthly_cents bigint NOT NULL,
     annual_cents bigint NOT NULL,
     features jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS inquiries (
     id uuid PRIMARY KEY,
     email text NOT NULL,
     first_name text NOT NULL,
     last_name text NOT NULL,
     company text NOT NULL,
     message text NOT NULL,
     source text NOT NULL,
     created_at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS inquiries_email ON inquiries (email, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_heads (
     company_id uuid PRIMARY KEY REFERENCES companies(id),
     last_seq bigint NOT NULL,
     last_hash text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_events (
     company_id uuid NOT NULL REFERENCES companies(id),
     seq bigint NOT NULL,
     action text NOT NULL,
     payment_id uuid,
     amount_cents bigint NOT NULL,
     actor_email text NOT NULL,
     prev_hash text NOT NULL,
     hash text NOT NULL,
     created_at timestamptz NOT NULL,
     PRIMARY KEY (company_id, seq))`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     company_id uuid NOT NULL,
     endpoint text NOT NULL,
     key text NOT NULL,
     body_hash text NOT NULL,
     status integer,
     response text,
     created_at timestamptz NOT NULL,
     PRIMARY KEY (company_id, endpoint, key))`,
  `CREATE OR REPLACE FUNCTION refuse_audit_edit() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     RAISE EXCEPTION 'audit trail is append-only' USING ERRCODE = 'insufficient_privilege';
   END $$`,
  `DROP TRIGGER IF EXISTS audit_events_no_row_edit ON audit_events`,
  `CREATE TRIGGER audit_events_no_row_edit BEFORE UPDATE OR DELETE ON audit_events
     FOR EACH ROW EXECUTE FUNCTION refuse_audit_edit()`,
  `DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events`,
  `CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
     FOR EACH STATEMENT EXECUTE FUNCTION refuse_audit_edit()`,
];

const SCHEMA_LOCK = 7_301_001;

export async function applySchema(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    for (const statement of STATEMENTS) await tx.query(statement);
  });
}
