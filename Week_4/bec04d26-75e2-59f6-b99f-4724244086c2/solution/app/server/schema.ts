/** Applied idempotently every time the app serves. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS practices (
  id uuid PRIMARY KEY,
  reminder_hour int NOT NULL,
  clock_now timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id),
  client_id uuid REFERENCES clients(id),
  display_name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('bookkeeper', 'owner')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS states (
  practice_id uuid NOT NULL REFERENCES practices(id),
  code text NOT NULL,
  name text NOT NULL,
  zone text NOT NULL,
  holidays date[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (practice_id, code)
);
CREATE TABLE IF NOT EXISTS editions (
  practice_id uuid NOT NULL,
  state_code text NOT NULL,
  effective_date date NOT NULL,
  due_day int NOT NULL,
  carry text NOT NULL,
  rate text NOT NULL,
  extension_days int NOT NULL,
  PRIMARY KEY (practice_id, state_code, effective_date),
  FOREIGN KEY (practice_id, state_code) REFERENCES states(practice_id, code)
);
CREATE TABLE IF NOT EXISTS registrations (
  id uuid PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  state_code text NOT NULL,
  frequency text NOT NULL,
  first_period text NOT NULL,
  UNIQUE (client_id, state_code)
);
CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  registration_id uuid NOT NULL REFERENCES registrations(id),
  state_code text NOT NULL,
  frequency text NOT NULL,
  period text NOT NULL,
  period_start date NOT NULL,
  status text NOT NULL,
  version int NOT NULL DEFAULT 1,
  gross_cents bigint,
  tax_cents bigint,
  edition_effective date NOT NULL,
  base_date date NOT NULL,
  extension_days int,
  nominal_date date NOT NULL,
  due_date date NOT NULL,
  due_at timestamptz NOT NULL,
  ext_granted_at timestamptz,
  ext_due_date_before date,
  ext_due_at_before timestamptz,
  awaiting_approval boolean NOT NULL DEFAULT false,
  filed_at timestamptz,
  changed_by text NOT NULL,
  UNIQUE (registration_id, period)
);
CREATE INDEX IF NOT EXISTS returns_by_due ON returns (practice_id, due_date);
CREATE INDEX IF NOT EXISTS returns_by_client ON returns (client_id);
CREATE TABLE IF NOT EXISTS approvals (
  id bigserial PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES returns(id),
  action text NOT NULL,
  by_name text NOT NULL,
  at timestamptz NOT NULL,
  reason text
);
CREATE INDEX IF NOT EXISTS approvals_by_return ON approvals (return_id);
CREATE TABLE IF NOT EXISTS amendments (
  id bigserial PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES returns(id),
  at timestamptz NOT NULL,
  by_name text NOT NULL,
  note text,
  original_gross_cents bigint NOT NULL,
  original_tax_cents bigint NOT NULL,
  amended_gross_cents bigint NOT NULL,
  amended_tax_cents bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS amendments_by_return ON amendments (return_id);
CREATE TABLE IF NOT EXISTS reminders (
  return_id uuid NOT NULL REFERENCES returns(id),
  lead_days int NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  PRIMARY KEY (return_id, lead_days)
);
CREATE INDEX IF NOT EXISTS reminders_pending ON reminders (scheduled_for) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS notices (
  id bigserial PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id),
  return_id uuid NOT NULL REFERENCES returns(id),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS notices_pending ON notices (id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS packet_revisions (
  return_id uuid NOT NULL REFERENCES returns(id),
  revision int NOT NULL,
  pdf bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (return_id, revision)
);
`;
