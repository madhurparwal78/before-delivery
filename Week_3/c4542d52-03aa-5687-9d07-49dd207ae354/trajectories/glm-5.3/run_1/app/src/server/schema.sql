-- Holdfast Register schema. Applied idempotently on every start.

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  first_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  access text NOT NULL,
  terminated_at timestamptz,
  termination_date date,
  window_ends_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_holdings (
  person_id text NOT NULL REFERENCES people(id),
  class text NOT NULL,
  shares bigint NOT NULL CHECK (shares >= 0),
  PRIMARY KEY (person_id, class)
);

CREATE TABLE IF NOT EXISTS option_pool (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  authorized bigint NOT NULL CHECK (authorized >= 0)
);

CREATE TABLE IF NOT EXISTS grants (
  id text PRIMARY KEY,
  holder_id text NOT NULL REFERENCES people(id),
  options bigint NOT NULL,
  strike text NOT NULL,
  vesting_type text NOT NULL,
  vesting_start date NOT NULL,
  state text NOT NULL,
  draft_version int NOT NULL DEFAULT 1,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  accepted_at timestamptz,
  agreement_document_id text,
  forfeited bigint NOT NULL DEFAULT 0,
  cancelled bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grant_votes (
  grant_id text NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  voter_id text NOT NULL REFERENCES people(id),
  vote text NOT NULL,
  PRIMARY KEY (grant_id, voter_id)
);

CREATE TABLE IF NOT EXISTS valuations (
  id text PRIMARY KEY,
  effective_on date NOT NULL,
  expires_on date NOT NULL,
  fmv_per_share text NOT NULL,
  firm text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exercise_orders (
  id text PRIMARY KEY,
  grant_id text NOT NULL REFERENCES grants(id),
  holder_id text NOT NULL REFERENCES people(id),
  options bigint NOT NULL,
  strike text NOT NULL,
  cost_cents bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  payment_id text,
  payment_cents bigint,
  payment_confirmed_at timestamptz,
  idempotent_request_hash text NOT NULL,
  idempotent_response_status int,
  idempotent_response_body jsonb
);

CREATE TABLE IF NOT EXISTS tenders (
  id text PRIMARY KEY,
  title text NOT NULL,
  price_per_share text NOT NULL,
  share_cap bigint NOT NULL,
  closes_at timestamptz NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tender_ndas (
  tender_id text NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id),
  document_id text,
  status text NOT NULL,
  PRIMARY KEY (tender_id, person_id)
);

CREATE TABLE IF NOT EXISTS tender_drafts (
  tender_id text NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id),
  shares_text text,
  PRIMARY KEY (tender_id, person_id)
);

CREATE TABLE IF NOT EXISTS tender_submissions (
  tender_id text NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id),
  shares bigint NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  sequence bigint NOT NULL,
  PRIMARY KEY (tender_id, person_id)
);

CREATE TABLE IF NOT EXISTS tender_allocations (
  tender_id text NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  person_id text NOT NULL,
  allocation bigint,
  proceeds_cents bigint,
  PRIMARY KEY (tender_id, person_id)
);

CREATE TABLE IF NOT EXISTS saved_scenarios (
  id text PRIMARY KEY,
  name text NOT NULL,
  pre_money text NOT NULL,
  investment text NOT NULL,
  target_pool_percent text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_scenarios_name ON saved_scenarios (lower(name));

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  kind text NOT NULL,
  title text NOT NULL,
  owner_id text NOT NULL,
  grant_id text,
  order_id text,
  tender_id text,
  status text NOT NULL,
  sha256 text,
  vault_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  supersedes text,
  superseded_by text
);

CREATE TABLE IF NOT EXISTS securities_ledger (
  id text PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  holder_id text,
  holder_name text NOT NULL,
  kind text NOT NULL,
  class text NOT NULL,
  shares_delta bigint NOT NULL DEFAULT 0,
  options_delta bigint NOT NULL DEFAULT 0,
  reference text NOT NULL
);

CREATE TABLE IF NOT EXISTS live_events (
  seq bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  person_id text NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS live_events_person ON live_events (person_id, seq);

CREATE TABLE IF NOT EXISTS idempotent_responses (
  key text PRIMARY KEY,
  response_status int NOT NULL,
  response_body jsonb NOT NULL
);

-- Each timed notice (offer warning, window warning) is sent exactly once.
CREATE TABLE IF NOT EXISTS sent_notifications (
  subject text NOT NULL,
  kind text NOT NULL,
  PRIMARY KEY (subject, kind)
);
