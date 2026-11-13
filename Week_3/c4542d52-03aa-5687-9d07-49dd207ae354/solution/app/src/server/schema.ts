export const schema = `
CREATE SEQUENCE IF NOT EXISTS person_number START 12;
CREATE SEQUENCE IF NOT EXISTS grant_number START 12;
CREATE SEQUENCE IF NOT EXISTS order_number START 1;
CREATE SEQUENCE IF NOT EXISTS tender_number START 1;
CREATE SEQUENCE IF NOT EXISTS valuation_number START 3;
CREATE SEQUENCE IF NOT EXISTS document_number START 1;
CREATE SEQUENCE IF NOT EXISTS ledger_number START 1;
CREATE SEQUENCE IF NOT EXISTS scenario_number START 1;

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  first_name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  access text NOT NULL,
  password_hash text,
  terminated_at timestamptz,
  termination_date date,
  window_ends_at timestamptz,
  warnings_sent int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_person ON sessions (person_id);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  kind text NOT NULL,
  title text NOT NULL,
  owner_id text NOT NULL REFERENCES people(id),
  status text NOT NULL,
  sha256 text NOT NULL,
  vault_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  version int NOT NULL DEFAULT 1,
  supersedes text,
  superseded_by text,
  body text
);

CREATE TABLE IF NOT EXISTS grants (
  id text PRIMARY KEY,
  holder_id text REFERENCES people(id),
  options bigint,
  strike_units numeric,
  vesting_type text,
  vesting_start date,
  state text NOT NULL DEFAULT 'draft',
  draft_version int NOT NULL DEFAULT 1,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  offer_warning_sent boolean NOT NULL DEFAULT false,
  accepted_at timestamptz,
  agreement_paper boolean NOT NULL DEFAULT false,
  agreement_document_id text REFERENCES documents(id),
  exercised bigint NOT NULL DEFAULT 0,
  cancelled bigint NOT NULL DEFAULT 0,
  forfeited bigint NOT NULL DEFAULT 0,
  window_settled boolean NOT NULL DEFAULT false,
  announced_mark int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grants_holder ON grants (holder_id);

CREATE TABLE IF NOT EXISTS votes (
  grant_id text NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  voter_id text NOT NULL REFERENCES people(id),
  vote text NOT NULL,
  voted_at timestamptz NOT NULL,
  PRIMARY KEY (grant_id, voter_id)
);

CREATE TABLE IF NOT EXISTS valuations (
  id text PRIMARY KEY,
  recorded bigserial,
  effective_on date NOT NULL,
  expires_on date NOT NULL,
  fmv_units numeric NOT NULL,
  firm text NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id text PRIMARY KEY,
  position bigserial,
  at timestamptz NOT NULL,
  holder_id text REFERENCES people(id),
  kind text NOT NULL,
  class text,
  shares_delta bigint NOT NULL DEFAULT 0,
  options_delta bigint NOT NULL DEFAULT 0,
  reference text NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_holder ON ledger (holder_id);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  grant_id text NOT NULL REFERENCES grants(id),
  holder_id text NOT NULL REFERENCES people(id),
  options bigint NOT NULL,
  strike_units numeric NOT NULL,
  cost_cents numeric NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  fingerprint text NOT NULL,
  state text NOT NULL,
  placed_at timestamptz NOT NULL,
  issued_at timestamptz,
  payment jsonb,
  last_polled_at timestamptz,
  notice_document_id text REFERENCES documents(id),
  response_status int,
  response_body jsonb
);
CREATE INDEX IF NOT EXISTS orders_grant ON orders (grant_id);

CREATE TABLE IF NOT EXISTS tenders (
  id text PRIMARY KEY,
  title text NOT NULL,
  price_units numeric NOT NULL,
  share_cap bigint NOT NULL,
  closes_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL,
  submissions_made int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS tenders_one_open ON tenders ((true)) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS tender_ndas (
  tender_id text NOT NULL REFERENCES tenders(id),
  person_id text NOT NULL REFERENCES people(id),
  document_id text NOT NULL REFERENCES documents(id),
  PRIMARY KEY (tender_id, person_id)
);

CREATE TABLE IF NOT EXISTS tender_submissions (
  tender_id text NOT NULL REFERENCES tenders(id),
  holder_id text NOT NULL REFERENCES people(id),
  shares bigint NOT NULL,
  submitted_at timestamptz NOT NULL,
  sequence int NOT NULL,
  allocation bigint,
  proceeds_cents numeric,
  PRIMARY KEY (tender_id, holder_id),
  UNIQUE (tender_id, sequence)
);

CREATE TABLE IF NOT EXISTS tender_drafts (
  tender_id text NOT NULL REFERENCES tenders(id),
  person_id text NOT NULL REFERENCES people(id),
  shares text NOT NULL,
  PRIMARY KEY (tender_id, person_id)
);

CREATE TABLE IF NOT EXISTS saved_scenarios (
  id text PRIMARY KEY,
  name text NOT NULL,
  name_key text NOT NULL UNIQUE,
  pre_money text NOT NULL,
  investment text NOT NULL,
  target_pool_percent text NOT NULL,
  saved_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS live_events (
  seq bigserial PRIMARY KEY,
  person_id text,
  type text NOT NULL,
  at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS live_events_person ON live_events (person_id, seq);
`;
