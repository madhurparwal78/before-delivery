// Database schema. Applied on every start; applying twice changes nothing
// (CREATE TABLE IF NOT EXISTS / idempotent ALTERs).
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS people (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  operator_code text,
  operator_kind text,
  phone text,
  erased boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id int NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channels (
  id text PRIMARY KEY,
  name text NOT NULL,
  rail_order int NOT NULL
);

CREATE TABLE IF NOT EXISTS turnouts (
  code text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channels(id),
  grower_id int NOT NULL REFERENCES people(id),
  max_rate_ml_day text NOT NULL
);

CREATE TABLE IF NOT EXISTS windows (
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channels(id),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  hours int NOT NULL,
  rostered_operator text NOT NULL,
  restriction_cap_ml_day text,
  restriction_effective_at timestamptz,
  restriction_id int,
  cap_volume_ml text NOT NULL,
  committed_ml text NOT NULL,
  delivered_ml text NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  number text PRIMARY KEY,
  grower_id int NOT NULL REFERENCES people(id),
  turnout text NOT NULL REFERENCES turnouts(code),
  window_id text NOT NULL REFERENCES windows(id),
  requested_ml text NOT NULL,
  volume_ml text NOT NULL,
  rate_ml_day text NOT NULL,
  status text NOT NULL,
  holder_code text,
  standby_code text,
  conflict text,
  rationed boolean NOT NULL DEFAULT false,
  closed_after_flow boolean NOT NULL DEFAULT false,
  scheduled_at timestamptz,
  seq bigint NOT NULL DEFAULT 0
);
CREATE SEQUENCE IF NOT EXISTS orders_seq START 1;

CREATE TABLE IF NOT EXISTS allocations (
  grower_id int PRIMARY KEY REFERENCES people(id),
  allocation_ml text NOT NULL,
  debited_ml text NOT NULL
);

CREATE TABLE IF NOT EXISTS capacity_revisions (
  id serial PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channels(id),
  revision int NOT NULL,
  saved_at timestamptz NOT NULL,
  saved_by int NOT NULL REFERENCES people(id),
  restored_from int
);

CREATE TABLE IF NOT EXISTS capacity_cells (
  revision_id int NOT NULL REFERENCES capacity_revisions(id) ON DELETE CASCADE,
  window_id text NOT NULL REFERENCES windows(id),
  cap_ml_day text NOT NULL,
  PRIMARY KEY (revision_id, window_id)
);

CREATE TABLE IF NOT EXISTS windows_lapse_done (
  window_id text PRIMARY KEY,
  done_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_cards (
  id serial PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders(number),
  turnout text NOT NULL,
  channel_id text NOT NULL,
  window_id text NOT NULL,
  kind text NOT NULL,
  state text NOT NULL,
  holder_code text NOT NULL,
  from_ml_day text NOT NULL,
  to_ml_day text NOT NULL,
  stroke_key text,
  stroke_committed_at timestamptz,
  stroke_confirmed_at timestamptz,
  stroke_operator text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notices (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  grower_id int NOT NULL REFERENCES people(id),
  window_id text,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY,
  number text NOT NULL UNIQUE,
  from_date text NOT NULL,
  to_date text NOT NULL,
  signatory text NOT NULL,
  state text NOT NULL,
  stalled_on text,
  object_key text,
  document text NOT NULL,
  sha256 text,
  created_at timestamptz NOT NULL,
  stored_at timestamptz,
  mailed_at timestamptz
);

CREATE TABLE IF NOT EXISTS packs_last_number (
  id int PRIMARY KEY DEFAULT 1,
  last_number int NOT NULL
);

CREATE TABLE IF NOT EXISTS restrictions (
  id serial PRIMARY KEY,
  window_id text NOT NULL UNIQUE REFERENCES windows(id),
  cap_ml_day text NOT NULL,
  reason text NOT NULL,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gate_cards_stroke_key ON gate_cards (stroke_key) WHERE stroke_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_window_idx ON orders (window_id);
CREATE INDEX IF NOT EXISTS orders_grower_idx ON orders (grower_id);
CREATE INDEX IF NOT EXISTS notices_pending_idx ON notices (state);
`;
