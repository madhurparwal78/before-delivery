import pg from 'pg';
import type { AppConfig } from './config';

export type Pool = pg.Pool;

export function createPool(config: AppConfig): Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES brands(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','finance','reviewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  brand_id UUID REFERENCES brands(id),
  contact_id UUID REFERENCES contacts(id),
  kind TEXT NOT NULL CHECK (kind IN ('client','studio')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signin_codes (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS code_requests (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagements (
  id UUID PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES brands(id),
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('quoted','deposit_paid','look_dev_review','revision_requested','final_review','delivered','cancelled_with_refund')),
  revision INTEGER NOT NULL DEFAULT 0,
  fx_rate TEXT NOT NULL,
  fx_locked_at TIMESTAMPTZ,
  quote_locked BOOLEAN NOT NULL DEFAULT FALSE,
  finals_out BOOLEAN NOT NULL DEFAULT FALSE,
  rounds_look_dev INTEGER NOT NULL DEFAULT 0,
  rounds_final_delivery INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS engagement_reference_seq START 1001;

CREATE TABLE IF NOT EXISTS quote_lines (
  id UUID PRIMARY KEY,
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  shot_code TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 6),
  locked_title TEXT,
  locked_price_pence INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, shot_code)
);

CREATE TABLE IF NOT EXISTS fx_rates (
  id UUID PRIMARY KEY,
  currency TEXT NOT NULL CHECK (currency IN ('EUR','USD','JPY')),
  rate TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intake_files (
  id UUID PRIMARY KEY,
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model','step','reference')),
  size_bytes BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received','superseded')),
  measurement TEXT CHECK (measurement IN ('pending','delayed','measured','failed')),
  unit TEXT CHECK (unit IN ('as_exported','mm','cm','in')),
  unit_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  unit_needed BOOLEAN NOT NULL DEFAULT FALSE,
  dim_m_x DOUBLE PRECISION,
  dim_m_y DOUBLE PRECISION,
  dim_m_z DOUBLE PRECISION,
  measure_failures INTEGER NOT NULL DEFAULT 0,
  measure_job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intake_measurements (
  file_id UUID PRIMARY KEY REFERENCES intake_files(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stills (
  id UUID PRIMARY KEY,
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  shot_code TEXT NOT NULL,
  milestone TEXT NOT NULL CHECK (milestone IN ('look_dev','final_delivery')),
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, shot_code, milestone)
);

CREATE TABLE IF NOT EXISTS review_links (
  id UUID PRIMARY KEY,
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  milestone TEXT NOT NULL CHECK (milestone IN ('look_dev','final_delivery')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY,
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  milestone TEXT NOT NULL CHECK (milestone IN ('deposit','look_dev','final_delivery')),
  status TEXT NOT NULL CHECK (status IN ('draft','issued','paid','payment_failed','overdue','void')),
  amount_minor BIGINT NOT NULL,
  balance_minor BIGINT NOT NULL,
  number TEXT,
  killbill_invoice_id TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  issued_at TIMESTAMPTZ,
  overdue_at TIMESTAMPTZ,
  overdue_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, milestone)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_change_orders (
  id UUID PRIMARY KEY,
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  milestone TEXT NOT NULL CHECK (milestone IN ('look_dev','final_delivery')),
  round INTEGER NOT NULL,
  description TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, milestone, round)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY,
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('deposit','invoice_payment','refund')),
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  invoice_id UUID REFERENCES invoices(id),
  killbill_payment_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  in_flight BOOLEAN NOT NULL DEFAULT TRUE,
  status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (scope, key)
);

CREATE TABLE IF NOT EXISTS studio_state (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intake_files_engagement ON intake_files (engagement_id);
CREATE INDEX IF NOT EXISTS idx_code_requests_email_time ON code_requests (email, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_undelivered ON outbox (delivered_at) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_review_links_hash ON review_links (token_hash);
CREATE INDEX IF NOT EXISTS idx_invoices_overdue ON invoices (status, overdue_at);
`;

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
}
