-- Spindrift Rooms schema. Applied idempotently on every server start.

CREATE TABLE IF NOT EXISTS app_users (
  id             uuid PRIMARY KEY,
  keycloak_sub   text UNIQUE NOT NULL,
  email          text NOT NULL,
  name           text NOT NULL,
  roles          text[] NOT NULL DEFAULT '{}',
  crm_endpoint_url text,
  crm_signing_secret text,
  svix_app_id    text,
  killbill_account_id text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_users_email_idx ON app_users (lower(email));

CREATE TABLE IF NOT EXISTS login_attempts (
  state          text PRIMARY KEY,
  code_verifier  text NOT NULL,
  nonce          text NOT NULL,
  return_to      text NOT NULL,
  browser_token  text NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  access_token   text NOT NULL,
  refresh_token  text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS briefs (
  id             uuid PRIMARY KEY,
  client_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  answers        jsonb NOT NULL DEFAULT '{}',
  answered_through int NOT NULL DEFAULT 0,
  commission_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS briefs_client_idx ON briefs (client_id);

CREATE TABLE IF NOT EXISTS commissions (
  id             uuid PRIMARY KEY,
  client_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  brief_id       uuid REFERENCES briefs(id) ON DELETE SET NULL,
  title          text NOT NULL,
  state          text NOT NULL,
  installation_type text NOT NULL,
  venue_id       text NOT NULL,
  width_m        numeric(5,2) NOT NULL,
  depth_m        numeric(5,2) NOT NULL,
  door_wall      text NOT NULL,
  audience       text NOT NULL,
  notes          text NOT NULL DEFAULT '',
  size_option    text NOT NULL DEFAULT 'compact',
  add_ons        text[] NOT NULL DEFAULT '{}',
  layout_version int NOT NULL DEFAULT 0,
  layout_items   jsonb NOT NULL DEFAULT '[]',
  signature_name text,
  signed_at      timestamptz,
  contract_version int NOT NULL DEFAULT 0,
  maintenance_plan text,
  maintenance_subscription_id text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commissions_client_idx ON commissions (client_id);

CREATE TABLE IF NOT EXISTS quotes (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  lines          jsonb NOT NULL,
  subtotal_cents bigint NOT NULL,
  tax_cents      bigint NOT NULL,
  total_cents    bigint NOT NULL,
  issued_at      timestamptz NOT NULL,
  valid_until    timestamptz NOT NULL,
  is_current     boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS quotes_commission_idx ON quotes (commission_id);
CREATE UNIQUE INDEX IF NOT EXISTS quotes_one_current_idx
  ON quotes (commission_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS funders (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  position       int NOT NULL,
  kind           text NOT NULL,
  name           text NOT NULL,
  email          text,
  bp             int NOT NULL,
  state          text NOT NULL,
  subtotal_cents bigint NOT NULL DEFAULT 0,
  tax_cents      bigint NOT NULL DEFAULT 0,
  amount_cents   bigint NOT NULL DEFAULT 0,
  invite_token_hash text,
  invite_expires_at timestamptz,
  accepted_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  accepted_at    timestamptz,
  due_at         timestamptz,
  killbill_invoice_id text,
  killbill_invoice_number text,
  killbill_payment_id text,
  paid_at        timestamptz,
  document_id    uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS funders_position_idx ON funders (commission_id, position);
CREATE INDEX IF NOT EXISTS funders_token_idx ON funders (invite_token_hash);

CREATE TABLE IF NOT EXISTS milestones (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  milestone_key  text NOT NULL,
  label          text NOT NULL,
  schedule_bp    int NOT NULL,
  position       int NOT NULL,
  state          text NOT NULL DEFAULT 'scheduled',
  subtotal_cents bigint NOT NULL DEFAULT 0,
  tax_cents      bigint NOT NULL DEFAULT 0,
  amount_cents   bigint NOT NULL DEFAULT 0,
  invoiced_at    timestamptz,
  due_at         timestamptz,
  killbill_invoice_id text,
  killbill_invoice_number text,
  killbill_payment_id text,
  paid_at        timestamptz,
  document_id    uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS milestones_key_idx ON milestones (commission_id, milestone_key);

CREATE TABLE IF NOT EXISTS install_days (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  venue_id       text NOT NULL,
  install_date   date NOT NULL,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  crew_user_ids  uuid[] NOT NULL DEFAULT '{}',
  confirmed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- One install per venue-local calendar date.
CREATE UNIQUE INDEX IF NOT EXISTS install_days_slot_idx ON install_days (venue_id, install_date);
CREATE INDEX IF NOT EXISTS install_days_commission_idx ON install_days (commission_id);

CREATE TABLE IF NOT EXISTS holds (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  venue_id       text NOT NULL,
  hold_date      date NOT NULL,
  expires_at     timestamptz NOT NULL,
  released_at    timestamptz,
  booked_at      timestamptz,
  ended_notified_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS holds_commission_idx ON holds (commission_id);
CREATE INDEX IF NOT EXISTS holds_slot_idx ON holds (venue_id, hold_date);

CREATE TABLE IF NOT EXISTS files (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  file_name      text NOT NULL,
  content_type   text NOT NULL,
  size_bytes     bigint NOT NULL,
  sha256         text NOT NULL,
  object_key     text NOT NULL,
  status         text NOT NULL DEFAULT 'stored',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_commission_idx ON files (commission_id);

CREATE TABLE IF NOT EXISTS renders (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  venue_photo_file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  reference_image_url text,
  reference_image jsonb,
  state          text NOT NULL DEFAULT 'queued',
  progress       int NOT NULL DEFAULT 0,
  provider_job_id text,
  failure_reason text,
  preview_sha256 text,
  preview_object_key text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS renders_commission_idx ON renders (commission_id);

CREATE TABLE IF NOT EXISTS render_callback_events (
  event_id       text PRIMARY KEY,
  render_id      uuid NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  version        int NOT NULL DEFAULT 1,
  label          text NOT NULL,
  status         text NOT NULL DEFAULT 'preparing',
  object_key     text NOT NULL,
  size_bytes     bigint,
  sha256         text,
  issued_at      timestamptz,
  payer_funder_id uuid,
  payer_milestone_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS documents_key_idx ON documents (object_key);
CREATE INDEX IF NOT EXISTS documents_commission_idx ON documents (commission_id);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_path   text NOT NULL,
  request_fingerprint text NOT NULL,
  target_kind    text NOT NULL,
  target_id      uuid NOT NULL,
  status         text NOT NULL,
  response_status int,
  response_body  jsonb,
  card_last_four text,
  killbill_payment_id text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_key_idx
  ON payment_attempts (user_id, idempotency_key);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  payer_name     text NOT NULL,
  label          text NOT NULL,
  amount_cents   bigint NOT NULL,
  killbill_payment_id text NOT NULL,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_payment_idx ON ledger_entries (killbill_payment_id);
CREATE INDEX IF NOT EXISTS ledger_commission_idx ON ledger_entries (commission_id);

CREATE TABLE IF NOT EXISTS crm_events (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_type     text NOT NULL,
  occurred_at    timestamptz NOT NULL,
  payload        jsonb NOT NULL,
  svix_message_id text,
  final_state    text NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_events_commission_idx ON crm_events (commission_id);

CREATE TABLE IF NOT EXISTS crew_alerts (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  install_day_id uuid REFERENCES install_days(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  title          text NOT NULL,
  body           text NOT NULL,
  send_at        timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'scheduled',
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crew_alerts_commission_idx ON crew_alerts (commission_id);

CREATE TABLE IF NOT EXISTS maintenance_invoices (
  id             uuid PRIMARY KEY,
  commission_id  uuid NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  killbill_invoice_id text NOT NULL,
  receipt_sent_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_invoices_idx
  ON maintenance_invoices (killbill_invoice_id);

-- The durable job table. Every email, PDF, render submission, preview storage,
-- crew alert and CRM event is a row here, created with the change that causes it.
CREATE TABLE IF NOT EXISTS jobs (
  id             uuid PRIMARY KEY,
  kind           text NOT NULL,
  commission_id  uuid REFERENCES commissions(id) ON DELETE CASCADE,
  payload        jsonb NOT NULL DEFAULT '{}',
  dedupe_key     text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  attempts       int NOT NULL DEFAULT 0,
  last_error     text,
  run_at         timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_idx ON jobs (dedupe_key);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (status, run_at);

CREATE TABLE IF NOT EXISTS service_health (
  service        text PRIMARY KEY,
  status         text NOT NULL,
  checked_at     timestamptz NOT NULL DEFAULT now()
);
