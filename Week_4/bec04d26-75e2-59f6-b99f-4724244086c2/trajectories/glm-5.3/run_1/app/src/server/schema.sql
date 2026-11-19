CREATE TABLE IF NOT EXISTS practices (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  clock_now timestamptz,
  reminder_hour int NOT NULL DEFAULT 9
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  practice_id text NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('bookkeeper','owner')),
  display_name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS users_practice_idx ON users (practice_id);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS states (
  practice_id text NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  zone text NOT NULL,
  holidays date[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (practice_id, code)
);

CREATE TABLE IF NOT EXISTS editions (
  practice_id text NOT NULL,
  state_code text NOT NULL,
  effective_date date NOT NULL,
  due_day int NOT NULL,
  carry text NOT NULL CHECK (carry IN ('next_business','fixed')),
  rate text NOT NULL,
  extension_days int NOT NULL,
  PRIMARY KEY (practice_id, state_code, effective_date),
  FOREIGN KEY (practice_id, state_code) REFERENCES states (practice_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  practice_id text NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  name text NOT NULL
);
CREATE INDEX IF NOT EXISTS clients_practice_idx ON clients (practice_id);

CREATE TABLE IF NOT EXISTS registrations (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  practice_id text NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  state_code text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('monthly','quarterly','yearly')),
  first_period text NOT NULL
);

CREATE TABLE IF NOT EXISTS returns (
  id text PRIMARY KEY,
  practice_id text NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  registration_id text NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  state_code text NOT NULL,
  frequency text NOT NULL,
  period text NOT NULL,
  status text NOT NULL CHECK (status IN ('not_started','prepared','client_approved','filed','packeted','amended')),
  version int NOT NULL DEFAULT 1,
  gross_sales numeric(14,2),
  tax_due numeric(14,2),
  edition_effective_date date NOT NULL,
  due_day int NOT NULL,
  carry text NOT NULL,
  rate text NOT NULL,
  extension_days int NOT NULL,
  unextended_nominal_date date NOT NULL,
  nominal_due_date date NOT NULL,
  due_date date NOT NULL,
  due_at timestamptz NOT NULL,
  extension_days_used int,
  extension_due_date_before date,
  extension_due_at_before timestamptz,
  extension_granted_at timestamptz,
  filed_at timestamptz,
  packet_state text NOT NULL DEFAULT 'none' CHECK (packet_state IN ('none','pending','ready')),
  packet_revisions int NOT NULL DEFAULT 0,
  awaiting_approval boolean NOT NULL DEFAULT false,
  prepared_at timestamptz,
  amounts_set boolean NOT NULL DEFAULT false,
  changed_by text NOT NULL,
  UNIQUE (registration_id, period)
);
CREATE INDEX IF NOT EXISTS returns_practice_idx ON returns (practice_id);
CREATE INDEX IF NOT EXISTS returns_due_at_idx ON returns (practice_id, due_at);
CREATE INDEX IF NOT EXISTS returns_status_idx ON returns (practice_id, status);

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  return_id text NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('approved','sent_back')),
  by_user_id text NOT NULL REFERENCES users(id),
  by_name text NOT NULL,
  reason text,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS approvals_return_idx ON approvals (return_id, at);

CREATE TABLE IF NOT EXISTS amendments (
  id text PRIMARY KEY,
  return_id text NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  at timestamptz NOT NULL,
  by_name text NOT NULL,
  note text,
  original_gross text NOT NULL,
  original_tax text NOT NULL,
  amended_gross text NOT NULL,
  amended_tax text NOT NULL,
  sequence int NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id text PRIMARY KEY,
  return_id text NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  lead_days int NOT NULL CHECK (lead_days IN (7,1)),
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent')),
  sent_at timestamptz,
  UNIQUE (return_id, lead_days)
);

CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  practice_id text NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  kind text NOT NULL,
  return_id text NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent')),
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  UNIQUE (kind, return_id)
);

CREATE TABLE IF NOT EXISTS packets (
  return_id text NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  revision int NOT NULL,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (return_id, revision)
);
