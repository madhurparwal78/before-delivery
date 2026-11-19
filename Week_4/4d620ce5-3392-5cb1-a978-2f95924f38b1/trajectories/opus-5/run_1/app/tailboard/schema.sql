CREATE TABLE IF NOT EXISTS seed_state (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           text PRIMARY KEY,
  username     text UNIQUE,
  passcode     text,
  display_name text NOT NULL,
  role         text,
  contractor   boolean NOT NULL DEFAULT false,
  licence      text,
  email        text,
  erased       boolean NOT NULL DEFAULT false,
  signer_token text,
  is_system    boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS engineer_scope (
  user_id    text NOT NULL REFERENCES users(id),
  model_code text NOT NULL,
  PRIMARY KEY (user_id, model_code)
);

CREATE TABLE IF NOT EXISTS standby_list (
  model_code text NOT NULL,
  position   integer NOT NULL,
  user_id    text NOT NULL REFERENCES users(id),
  PRIMARY KEY (model_code, position)
);

CREATE TABLE IF NOT EXISTS tails (
  registration      text PRIMARY KEY,
  model_code        text NOT NULL,
  msn               bigint NOT NULL,
  seed_hours        numeric(12,1) NOT NULL,
  total_hours       numeric(12,1) NOT NULL,
  daily_utilisation numeric(6,1) NOT NULL
);

CREATE TABLE IF NOT EXISTS flight_hour_logs (
  id            text PRIMARY KEY,
  registration  text NOT NULL REFERENCES tails(registration),
  hours         numeric(6,1) NOT NULL,
  running_total numeric(12,1) NOT NULL,
  logged_at     timestamptz NOT NULL,
  actor_id      text REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS flight_hour_logs_tail ON flight_hour_logs (registration, logged_at);

CREATE TABLE IF NOT EXISTS documents (
  id          text PRIMARY KEY,
  key         text NOT NULL,
  sha256      text NOT NULL UNIQUE,
  bytes       integer NOT NULL,
  uploaded_by text REFERENCES users(id),
  uploaded_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS directives (
  id               text PRIMARY KEY,
  authority        text NOT NULL,
  number           text NOT NULL,
  current_revision integer NOT NULL,
  status           text NOT NULL DEFAULT 'active',
  withdrawn_reason text,
  withdrawn_at     timestamptz,
  created_at       timestamptz NOT NULL,
  rail_order       integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS directives_authority_number ON directives (authority, number);

CREATE TABLE IF NOT EXISTS directive_revisions (
  directive_id  text NOT NULL REFERENCES directives(id),
  revision      integer NOT NULL,
  title         text NOT NULL,
  method        text NOT NULL,
  effective_date date NOT NULL,
  calendar_days integer NOT NULL,
  fh_interval   numeric(9,1) NOT NULL,
  prior_credit  boolean NOT NULL DEFAULT false,
  document_key  text,
  ingested_at   timestamptz NOT NULL,
  ingested_by   text REFERENCES users(id),
  superseded_at timestamptz,
  PRIMARY KEY (directive_id, revision)
);

CREATE TABLE IF NOT EXISTS revision_applicability (
  directive_id text NOT NULL,
  revision     integer NOT NULL,
  idx          integer NOT NULL,
  model_code   text NOT NULL,
  msn_from     bigint NOT NULL,
  msn_to       bigint NOT NULL,
  PRIMARY KEY (directive_id, revision, idx)
);

CREATE TABLE IF NOT EXISTS threads (
  id               text PRIMARY KEY,
  directive_id     text NOT NULL REFERENCES directives(id),
  registration     text NOT NULL REFERENCES tails(registration),
  work_card_id     text NOT NULL,
  stage            text NOT NULL,
  pinned_revision  integer,
  fh_baseline      numeric(12,1) NOT NULL,
  entered_at       timestamptz NOT NULL,
  holder_id        text REFERENCES users(id),
  claimed_at       timestamptz,
  timeliness       text,
  certifier_id     text REFERENCES users(id),
  certifier_status text,
  deferred         boolean NOT NULL DEFAULT false,
  deferral_by      text REFERENCES users(id),
  deferral_at      timestamptz,
  deferral_reason  text,
  certified_at     timestamptz,
  certified_hours  numeric(12,1),
  UNIQUE (directive_id, registration)
);

CREATE TABLE IF NOT EXISTS thread_history (
  id         bigserial PRIMARY KEY,
  thread_id  text NOT NULL REFERENCES threads(id),
  revision   integer NOT NULL,
  entered_at timestamptz NOT NULL,
  left_at    timestamptz,
  limits     jsonb,
  wording    jsonb,
  outcome    text,
  UNIQUE (thread_id, revision)
);

CREATE TABLE IF NOT EXISTS evidence (
  id           text PRIMARY KEY,
  seq          bigserial,
  thread_id    text NOT NULL REFERENCES threads(id),
  key          text NOT NULL,
  sha256       text NOT NULL,
  content_type text NOT NULL,
  bytes        integer NOT NULL,
  attached_by  text REFERENCES users(id),
  attached_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS signatures (
  id           text PRIMARY KEY,
  seq          bigserial,
  thread_id    text NOT NULL REFERENCES threads(id),
  kind         text NOT NULL,
  signer_id    text REFERENCES users(id),
  signer_text  text,
  revision     integer NOT NULL,
  committed_at timestamptz NOT NULL,
  timeliness   text,
  method_ref   text,
  findings     text,
  status       text NOT NULL DEFAULT 'valid',
  void_reason  text
);
CREATE INDEX IF NOT EXISTS signatures_thread ON signatures (thread_id, seq);

CREATE TABLE IF NOT EXISTS legacy_records (
  id               text PRIMARY KEY,
  thread_id        text NOT NULL REFERENCES threads(id),
  revision         integer NOT NULL,
  row_key          text NOT NULL UNIQUE,
  status           text NOT NULL,
  inspector        text,
  inspector_licence text,
  inspected_on     date,
  certifier        text,
  certifier_licence text,
  certified_on     date,
  notes            text,
  import_id        text,
  created_at       timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
  id          text PRIMARY KEY,
  file_sha256 text NOT NULL UNIQUE,
  result      jsonb NOT NULL,
  created_by  text REFERENCES users(id),
  created_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS packs (
  id               text PRIMARY KEY,
  directive_id     text NOT NULL REFERENCES directives(id),
  revision         integer NOT NULL,
  status           text NOT NULL,
  waiting_for      text,
  requested_by     text REFERENCES users(id),
  requested_at     timestamptz NOT NULL,
  transmitted_at   timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  pdf_key          text,
  csv_key          text,
  pdf_sha256       text,
  csv_sha256       text,
  rerender_needed  boolean NOT NULL DEFAULT false,
  next_attempt_at  timestamptz
);

CREATE TABLE IF NOT EXISTS notices (
  id           text PRIMARY KEY,
  kind         text NOT NULL,
  to_user_id   text REFERENCES users(id),
  to_email     text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL,
  status       text NOT NULL,
  queued_at    timestamptz NOT NULL,
  send_after   timestamptz NOT NULL,
  sent_at      timestamptz,
  thread_id    text,
  directive_id text,
  work_card_id text,
  payload      jsonb
);

CREATE TABLE IF NOT EXISTS idempotency (
  user_id      text NOT NULL,
  method       text NOT NULL,
  path         text NOT NULL,
  key          text NOT NULL,
  request_hash text NOT NULL,
  status       integer NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (user_id, method, path, key)
);

CREATE TABLE IF NOT EXISTS audit (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL,
  actor_id     text REFERENCES users(id),
  action       text NOT NULL,
  directive_id text,
  thread_id    text,
  detail       text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_at ON audit (at DESC, id DESC);

CREATE TABLE IF NOT EXISTS snapshots (
  directive_id text NOT NULL,
  revision     integer NOT NULL,
  taken_at     timestamptz NOT NULL,
  data         jsonb NOT NULL,
  PRIMARY KEY (directive_id, revision)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  ended      boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS erased_aliases (
  alias   text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id)
);

CREATE SEQUENCE IF NOT EXISTS work_card_seq START 10001;
