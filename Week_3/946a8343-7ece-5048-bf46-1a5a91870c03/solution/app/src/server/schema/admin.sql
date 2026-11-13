-- Admin tables: webhooks and their deliveries, project exports and imports, and the grading webhook sink.
-- Every statement is idempotent; the app applies this file on every start.

CREATE TABLE IF NOT EXISTS webhooks (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url         text NOT NULL,
  secret      text NOT NULL,
  events      text[] NOT NULL DEFAULT '{}',
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS webhooks_project ON webhooks (project_id, id);

-- `body` is the exact JSON text of the payload; every attempt sends it unchanged. `uuid` is the X-Spurline-Delivery value.
-- A pending delivery waits for its next attempt at `next_at` (server clock); null while an attempt is in flight.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          serial PRIMARY KEY,
  webhook_id  integer NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  uuid        text NOT NULL UNIQUE,
  event       text NOT NULL,
  body        text NOT NULL,
  state       text NOT NULL CHECK (state IN ('pending', 'delivered', 'failed')),
  next_at     bigint,
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_hook ON webhook_deliveries (webhook_id, id DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON webhook_deliveries (next_at) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS webhook_attempts (
  delivery_id  integer NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  number       integer NOT NULL,
  status_code  integer,
  at           bigint NOT NULL,
  PRIMARY KEY (delivery_id, number)
);

-- `next_step_at` is the server-clock time at which the next of the five progress steps runs.
CREATE TABLE IF NOT EXISTS project_exports (
  id            serial PRIMARY KEY,
  project_id    integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('running', 'finished', 'failed')),
  progress      integer NOT NULL DEFAULT 0,
  error         text,
  object_key    text,
  next_step_at  bigint,
  created_at    bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS project_exports_project ON project_exports (project_id, id DESC);

-- An upload is `preview` until it is confirmed; `project_id` is the project created at confirmation.
CREATE TABLE IF NOT EXISTS project_imports (
  id            serial PRIMARY KEY,
  group_id      integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  pack          text NOT NULL,
  commits       integer NOT NULL,
  issues        integer NOT NULL,
  requests      integer NOT NULL,
  status        text NOT NULL CHECK (status IN ('preview', 'running', 'finished', 'failed')),
  progress      integer NOT NULL DEFAULT 0,
  error         text,
  project_id    integer REFERENCES projects(id) ON DELETE CASCADE,
  next_step_at  bigint,
  created_at    bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS grading_sink_requests (
  id               serial PRIMARY KEY,
  name             text NOT NULL,
  headers          jsonb NOT NULL,
  body             text NOT NULL,
  received_at_ms   bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS grading_sink_requests_name ON grading_sink_requests (name, id);

CREATE TABLE IF NOT EXISTS grading_sink_status (
  name    text PRIMARY KEY,
  status  integer NOT NULL
);
