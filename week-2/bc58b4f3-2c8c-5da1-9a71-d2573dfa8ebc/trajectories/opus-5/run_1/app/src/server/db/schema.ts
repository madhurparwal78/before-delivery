export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS orgs (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  killbill_account_id text
);

CREATE TABLE IF NOT EXISTS languages (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL,
  org_id        integer REFERENCES orgs(id),
  phone         text NOT NULL DEFAULT '',
  initials      text NOT NULL,
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS user_languages (
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language_code text NOT NULL REFERENCES languages(code),
  PRIMARY KEY (user_id, language_code)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS assignment_number_seq START WITH 1001 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS assignments (
  id                      serial PRIMARY KEY,
  number                  text NOT NULL UNIQUE,
  org_id                  integer NOT NULL REFERENCES orgs(id),
  scheduler_id            integer NOT NULL REFERENCES users(id),
  language_code           text NOT NULL REFERENCES languages(code),
  setting                 text NOT NULL,
  start_at                timestamptz NOT NULL,
  duration_minutes        integer NOT NULL,
  street_address          text NOT NULL,
  city                    text NOT NULL,
  patient_initials        text NOT NULL,
  medical_notes           text NOT NULL DEFAULT '',
  status                  text NOT NULL,
  offer_round             integer NOT NULL DEFAULT 0,
  coverage_round          integer NOT NULL DEFAULT 0,
  cancelled_at            timestamptz,
  fee_applies             boolean,
  business_minutes_notice integer,
  fee_cents               integer,
  billing_status          text NOT NULL DEFAULT 'none',
  total_cents             integer,
  invoice_id              text,
  killbill_attempted_at   timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignments_start_at_idx ON assignments (start_at);
CREATE INDEX IF NOT EXISTS assignments_billing_status_idx ON assignments (billing_status);

CREATE TABLE IF NOT EXISTS seats (
  id            serial PRIMARY KEY,
  assignment_id integer NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  seat_no       integer NOT NULL,
  status        text NOT NULL DEFAULT 'open',
  holder_id     integer REFERENCES users(id),
  UNIQUE (assignment_id, seat_no)
);

CREATE TABLE IF NOT EXISTS holds (
  id             serial PRIMARY KEY,
  assignment_id  integer NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  seat_no        integer NOT NULL,
  interpreter_id integer NOT NULL REFERENCES users(id),
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  outcome        text
);

CREATE INDEX IF NOT EXISTS holds_open_idx ON holds (interpreter_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS verifications (
  id             serial PRIMARY KEY,
  seat_id        integer NOT NULL UNIQUE REFERENCES seats(id) ON DELETE CASCADE,
  interpreter_id integer NOT NULL REFERENCES users(id),
  actual_minutes integer NOT NULL,
  round_trip_miles integer NOT NULL,
  object_key     text NOT NULL,
  content_type   text NOT NULL,
  size_bytes     integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id              serial PRIMARY KEY,
  user_id         integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  body_hash       text NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS rate_cards (
  id                    serial PRIMARY KEY,
  org_id                integer NOT NULL REFERENCES orgs(id),
  service_line          text NOT NULL,
  effective_from        date NOT NULL,
  hourly_rate_cents     integer NOT NULL,
  mileage_cents_per_mile integer NOT NULL,
  UNIQUE (org_id, service_line, effective_from)
);

CREATE TABLE IF NOT EXISTS outbox (
  id         serial PRIMARY KEY,
  event_key  text NOT NULL UNIQUE,
  to_email   text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);

CREATE INDEX IF NOT EXISTS outbox_unsent_idx ON outbox (id) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS file_tokens (
  token      text PRIMARY KEY,
  session_id text NOT NULL,
  seat_id    integer NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id            serial PRIMARY KEY,
  kind          text NOT NULL,
  assignment_id integer REFERENCES assignments(id) ON DELETE SET NULL,
  actor_id      integer REFERENCES users(id) ON DELETE SET NULL,
  detail        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
`;
