-- Gigfreight schema. Idempotent: every statement can run on every start.
-- Invariants the brief makes absolute live here as constraints too.

CREATE TABLE IF NOT EXISTS members (
  id            integer PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'dispatcher', 'tour_manager')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Only the SHA-256 of a bearer token is stored; the role is always read from members.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  member_id  integer NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  succeeded  boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sign_in_attempts_email_idx ON sign_in_attempts (email, created_at DESC);

CREATE TABLE IF NOT EXISTS trucks (
  id         text PRIMARY KEY CHECK (id ~ '^TR-[0-9]{3}$'),
  depot      text NOT NULL CHECK (depot IN ('north', 'south')),
  status     text NOT NULL CHECK (status IN ('available', 'assigned', 'maintenance')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logistics_requests (
  id               text PRIMARY KEY CHECK (id ~ '^LR-[0-9]{4}$'),
  tour_name        text NOT NULL CHECK (char_length(tour_name) BETWEEN 1 AND 80),
  transport_type   text NOT NULL CHECK (transport_type IN ('tour', 'show', 'show_freight')),
  trucks_requested integer NOT NULL CHECK (trucks_requested BETWEEN 1 AND 8),
  notes            text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  requester_id     integer NOT NULL REFERENCES members(id),
  status           text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'confirmed', 'declined')),
  decided_by       integer REFERENCES members(id),
  decided_at       timestamptz,
  decision_note    text CHECK (char_length(decision_note) BETWEEN 1 AND 500),
  draft_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (requester_id, draft_id),
  CHECK ((status = 'submitted') = (decided_by IS NULL AND decided_at IS NULL AND decision_note IS NULL))
);
CREATE INDEX IF NOT EXISTS requests_order_idx ON logistics_requests (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS requests_requester_idx ON logistics_requests (requester_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS requests_status_idx ON logistics_requests (status, created_at, id);

CREATE TABLE IF NOT EXISTS stops (
  id          serial PRIMARY KEY,
  request_id  text NOT NULL REFERENCES logistics_requests(id),
  kind        text NOT NULL CHECK (kind IN ('pickup', 'delivery', 'first_show', 'last_show')),
  date        date,
  address     text NOT NULL,
  city        text NOT NULL,
  region      text NOT NULL,
  postal_code text NOT NULL,
  country     text NOT NULL,
  UNIQUE (request_id, kind)
);

-- A truck is on at most one open request: one row per truck, removed on release
-- and on decline, kept while the request is submitted or confirmed.
CREATE TABLE IF NOT EXISTS assignments (
  truck_id    text PRIMARY KEY REFERENCES trucks(id),
  request_id  text NOT NULL REFERENCES logistics_requests(id),
  assigned_by integer NOT NULL REFERENCES members(id),
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS assignments_request_idx ON assignments (request_id);

CREATE TABLE IF NOT EXISTS activity (
  id         serial PRIMARY KEY,
  request_id text NOT NULL REFERENCES logistics_requests(id),
  kind       text NOT NULL CHECK (kind IN ('submitted', 'truck_assigned', 'truck_released', 'confirmed', 'declined')),
  actor_id   integer NOT NULL REFERENCES members(id),
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS activity_request_idx ON activity (request_id, created_at, id);
