-- Spindrift Rooms schema, applied idempotently at every boot.

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY,
  keycloak_id text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL,
  crm_endpoint_url text,
  crm_signing_secret text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  refresh_token text NOT NULL,
  access_token text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_access_idx ON sessions (access_expires_at);

CREATE TABLE IF NOT EXISTS venues (
  id text PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  time_zone text NOT NULL,
  tax_rate_bp integer NOT NULL
);

CREATE TABLE IF NOT EXISTS briefs (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES app_users(id),
  answers jsonb NOT NULL DEFAULT '{}',
  answered_through integer NOT NULL DEFAULT 0,
  next_step integer,
  commission_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commissions (
  id uuid PRIMARY KEY,
  brief_id uuid UNIQUE REFERENCES briefs(id),
  client_id uuid NOT NULL REFERENCES app_users(id),
  title text NOT NULL,
  installation_type text NOT NULL,
  venue_id text NOT NULL REFERENCES venues(id),
  width_m numeric(5,1) NOT NULL,
  depth_m numeric(5,1) NOT NULL,
  door_wall text NOT NULL,
  audience text NOT NULL,
  notes text,
  size text NOT NULL,
  add_ons jsonb NOT NULL DEFAULT '[]',
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  lines jsonb NOT NULL,
  subtotal_cents integer NOT NULL,
  tax_cents integer NOT NULL,
  total_cents integer NOT NULL,
  issued_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  current boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS quotes_commission_current_idx ON quotes (commission_id) WHERE current;

CREATE TABLE IF NOT EXISTS layouts (
  commission_id uuid PRIMARY KEY REFERENCES commissions(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS commission_files (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renders (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  venue_photo_file_id uuid REFERENCES commission_files(id),
  reference_source_url text,
  reference_file_id uuid REFERENCES commission_files(id),
  state text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  provider_job_id text,
  failure_reason text,
  preview_sha256 text,
  error_events text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS render_events (
  event_id uuid PRIMARY KEY,
  render_id uuid NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS install_days (
  id uuid PRIMARY KEY,
  venue_id text NOT NULL REFERENCES venues(id),
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  date text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  crew_user_ids uuid[] NOT NULL DEFAULT '{}',
  placement_alert_sent boolean NOT NULL DEFAULT false,
  loadin_alert_sent boolean NOT NULL DEFAULT false,
  UNIQUE (venue_id, date)
);

CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  venue_id text NOT NULL REFERENCES venues(id),
  date text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'held',
  ended_email_sent boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS holds_venue_date_idx ON holds (venue_id, date);
CREATE INDEX IF NOT EXISTS holds_commission_idx ON holds (commission_id);
CREATE UNIQUE INDEX IF NOT EXISTS holds_active_slot_idx ON holds (venue_id, date) WHERE state = 'held';

CREATE TABLE IF NOT EXISTS milestones (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  label text NOT NULL,
  schedule_bp integer NOT NULL,
  position integer NOT NULL,
  state text NOT NULL DEFAULT 'scheduled',
  subtotal_cents integer NOT NULL,
  tax_cents integer NOT NULL,
  amount_cents integer NOT NULL,
  invoiced_at timestamptz,
  due_at timestamptz,
  killbill_invoice_id text,
  killbill_payment_id text,
  document_id uuid,
  quote_id uuid REFERENCES quotes(id)
);

CREATE TABLE IF NOT EXISTS funders (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  position integer NOT NULL,
  name text,
  email text,
  bp integer NOT NULL,
  subtotal_cents integer,
  tax_cents integer,
  amount_cents integer,
  state text NOT NULL DEFAULT 'lead',
  app_user_id uuid REFERENCES app_users(id),
  invite_token_hash text,
  invite_expires_at timestamptz,
  invite_sent_at timestamptz,
  killbill_invoice_id text,
  killbill_payment_id text,
  document_id uuid,
  due_at timestamptz,
  accepted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS funders_commission_pos_idx ON funders (commission_id, position);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text NOT NULL,
  user_id uuid NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  body jsonb,
  state text NOT NULL DEFAULT 'in_flight',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  version integer NOT NULL,
  label text NOT NULL,
  s3_key text NOT NULL,
  size_bytes bigint,
  sha256 text,
  issued_at timestamptz,
  killbill_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  payer_name text NOT NULL,
  label text NOT NULL,
  amount_cents integer NOT NULL,
  killbill_payment_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  commission_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_expires timestamptz,
  lease_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  done_key text
);
CREATE INDEX IF NOT EXISTS jobs_done_key_idx ON jobs (done_key) WHERE done_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (status, run_after);

CREATE TABLE IF NOT EXISTS job_effects (
  key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_events (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL,
  payer_name text NOT NULL,
  amount_cents integer NOT NULL,
  label text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_signings (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES quotes(id),
  signature_name text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL,
  document_id uuid,
  deposit_milestone_id uuid REFERENCES milestones(id)
);

CREATE TABLE IF NOT EXISTS crm_events (
  id uuid PRIMARY KEY,
  commission_id uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS maintenance (
  commission_id uuid PRIMARY KEY REFERENCES commissions(id) ON DELETE CASCADE,
  plan text NOT NULL,
  killbill_subscription_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now()
);
