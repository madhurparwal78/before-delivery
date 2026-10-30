/**
 * The schema is applied on every serve, into an empty database as well as an
 * existing one. PostgreSQL is the only system of record.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS members (
  id             text PRIMARY KEY,
  business_name  text NOT NULL,
  contact_email  text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             text PRIMARY KEY,
  role           text NOT NULL,
  name           text NOT NULL,
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  member_id      text REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS stations (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  hourly_rate_cents integer NOT NULL,
  cleaning_minutes  integer NOT NULL,
  sort_order        integer NOT NULL
);

CREATE TABLE IF NOT EXISTS packs (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  minutes     integer NOT NULL,
  price_cents integer NOT NULL,
  sort_order  integer NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS holds (
  id               text PRIMARY KEY,
  member_id        text NOT NULL REFERENCES members(id),
  station_id       text NOT NULL REFERENCES stations(id),
  kitchen_date     date NOT NULL,
  start_minutes    integer NOT NULL,
  end_minutes      integer NOT NULL,
  tail_end_minutes integer NOT NULL,
  status           text NOT NULL,
  created_at       timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_member_date ON holds(member_id, kitchen_date);

CREATE TABLE IF NOT EXISTS bookings (
  id                text PRIMARY KEY,
  hold_id           text NOT NULL REFERENCES holds(id),
  member_id         text NOT NULL REFERENCES members(id),
  station_id        text NOT NULL REFERENCES stations(id),
  kitchen_date      date NOT NULL,
  start_minutes     integer NOT NULL,
  end_minutes       integer NOT NULL,
  tail_end_minutes  integer NOT NULL,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  status            text NOT NULL,
  payment           text NOT NULL,
  booked_minutes    integer NOT NULL,
  prepaid_minutes   integer NOT NULL,
  overage_minutes   integer NOT NULL,
  overage_cents     integer NOT NULL,
  list_cents        integer NOT NULL,
  free_cancel_until timestamptz NOT NULL,
  fee_cents         integer,
  fee_status        text,
  confirmed_at      timestamptz NOT NULL,
  cancelled_at      timestamptz
);
CREATE INDEX IF NOT EXISTS bookings_date ON bookings(kitchen_date);
CREATE INDEX IF NOT EXISTS bookings_member_date ON bookings(member_id, kitchen_date);

-- At most one live hold or non-cancelled booking may cover any station cell,
-- counting cleaning tails. The primary key is what enforces one winner.
CREATE TABLE IF NOT EXISTS cell_locks (
  station_id   text NOT NULL,
  kitchen_date date NOT NULL,
  cell         integer NOT NULL,
  owner_kind   text NOT NULL,
  owner_id     text NOT NULL,
  expires_at   timestamptz,
  PRIMARY KEY (station_id, kitchen_date, cell)
);
CREATE INDEX IF NOT EXISTS cell_locks_owner ON cell_locks(owner_kind, owner_id);

CREATE TABLE IF NOT EXISTS check_ins (
  id               text PRIMARY KEY,
  booking_id       text NOT NULL REFERENCES bookings(id),
  crew_cook_id     text NOT NULL REFERENCES users(id),
  at               timestamptz NOT NULL,
  card_document_id text NOT NULL,
  UNIQUE (booking_id, crew_cook_id)
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id          text PRIMARY KEY,
  member_id   text NOT NULL REFERENCES members(id),
  kind        text NOT NULL,
  created_at  timestamptz NOT NULL,
  booking_id  text,
  reason      text,
  reverses    text REFERENCES ledger_transactions(id),
  reversed_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_reverses_unique
  ON ledger_transactions(reverses) WHERE reverses IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_booking_kind_unique
  ON ledger_transactions(booking_id, kind) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_member ON ledger_transactions(member_id, created_at);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id             bigserial PRIMARY KEY,
  transaction_id text NOT NULL REFERENCES ledger_transactions(id),
  account        text NOT NULL,
  minutes        integer NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries(account);

CREATE TABLE IF NOT EXISTS documents (
  id               text PRIMARY KEY,
  member_id        text NOT NULL REFERENCES members(id),
  kind             text NOT NULL,
  crew_cook_id     text REFERENCES users(id),
  expires_on       date NOT NULL,
  status           text NOT NULL,
  filename         text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       integer NOT NULL,
  storage_key      text NOT NULL,
  uploaded_at      timestamptz NOT NULL,
  reviewed_at      timestamptz,
  rejection_reason text,
  warned_14        boolean NOT NULL DEFAULT false,
  warned_3         boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS documents_member ON documents(member_id);

CREATE TABLE IF NOT EXISTS packets (
  id         text PRIMARY KEY,
  from_date  date NOT NULL,
  to_date    date NOT NULL,
  expires_at timestamptz NOT NULL,
  status     text NOT NULL,
  token      text UNIQUE,
  snapshot   jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id         text NOT NULL,
  key             text NOT NULL,
  method          text NOT NULL,
  path            text NOT NULL,
  body_hash       text NOT NULL,
  state           text NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id         bigserial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  to_address text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  status     text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at    timestamptz
);

CREATE TABLE IF NOT EXISTS billing_jobs (
  id           bigserial PRIMARY KEY,
  dedupe_key   text NOT NULL UNIQUE,
  kind         text NOT NULL,
  member_id    text NOT NULL,
  booking_id   text,
  payload      jsonb NOT NULL,
  status       text NOT NULL,
  created_at   timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS billing_jobs_queued ON billing_jobs(status, id);

CREATE TABLE IF NOT EXISTS killbill_accounts (
  member_id  text PRIMARY KEY REFERENCES members(id),
  account_id text NOT NULL
);
`;
