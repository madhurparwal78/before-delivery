export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  currency text NOT NULL,
  killbill_account_id text,
  overdue_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  email_lc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, role)
);
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_lc_key;
CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts(email_lc);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  kind text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signin_codes (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  code text NOT NULL,
  tries integer NOT NULL DEFAULT 0,
  used boolean NOT NULL DEFAULT false,
  dead boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signin_codes_contact_idx ON signin_codes(contact_id);

CREATE TABLE IF NOT EXISTS signin_code_requests (
  id uuid PRIMARY KEY,
  email_lc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signin_code_requests_email_idx ON signin_code_requests(email_lc, created_at);

CREATE SEQUENCE IF NOT EXISTS engagement_reference_seq START 1001;

CREATE TABLE IF NOT EXISTS engagements (
  id uuid PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  reference text NOT NULL UNIQUE,
  title text NOT NULL,
  state text NOT NULL,
  finals_out boolean NOT NULL DEFAULT false,
  revision_milestone text,
  quote_revision integer NOT NULL DEFAULT 0,
  fx_rate_e4 bigint,
  fx_locked_at timestamptz,
  cancelling boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS engagements_brand_idx ON engagements(brand_id);

CREATE TABLE IF NOT EXISTS quote_lines (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  shot_code text NOT NULL,
  quantity integer NOT NULL,
  locked_title text,
  locked_price_pence integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, shot_code)
);

CREATE TABLE IF NOT EXISTS intake_files (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  size_bytes bigint NOT NULL,
  status text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  measurement text,
  measure_failures integer NOT NULL DEFAULT 0,
  measured boolean NOT NULL DEFAULT false,
  unit text,
  dim_x numeric(24,12),
  dim_y numeric(24,12),
  dim_z numeric(24,12),
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS intake_files_engagement_idx ON intake_files(engagement_id);

CREATE TABLE IF NOT EXISTS stills (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  shot_code text NOT NULL,
  milestone text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, shot_code, milestone)
);

CREATE TABLE IF NOT EXISTS review_links (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  milestone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS review_links_engagement_idx ON review_links(engagement_id);

CREATE TABLE IF NOT EXISTS revision_rounds (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  round integer NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, milestone, round)
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  status text NOT NULL,
  number text,
  killbill_invoice_id text,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  first_failed_at timestamptz,
  overdue_at timestamptz,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, milestone)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount_minor bigint NOT NULL,
  sort integer NOT NULL
);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_idx ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  kind text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  killbill_payment_id text NOT NULL,
  transaction_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial,
  UNIQUE (transaction_key)
);
CREATE INDEX IF NOT EXISTS ledger_entries_engagement_idx ON ledger_entries(engagement_id);

CREATE TABLE IF NOT EXISTS fx_rates (
  id uuid PRIMARY KEY,
  currency text NOT NULL,
  rate_e4 bigint NOT NULL,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS fx_rates_currency_idx ON fx_rates(currency, effective_at);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL,
  status integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (scope, key)
);

CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  dedupe_key text UNIQUE,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_state_idx ON outbox(state, created_at);

CREATE TABLE IF NOT EXISTS measure_jobs (
  intake_file_id uuid PRIMARY KEY REFERENCES intake_files(id) ON DELETE CASCADE,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
`;
