-- The desk applies this schema on every start, in a way that is safe to repeat.
-- All shared state lives here: claims, catalogue, sessions, locks, rate windows,
-- idempotency records, the notice queue and the decided-claims counts.

CREATE TABLE IF NOT EXISTS claims (
  reference        text PRIMARY KEY,
  state            text NOT NULL,
  language         text,
  owner_name       text,
  owner_email      text,
  owner_postcode   text,
  purchase_date    date,
  club_member      boolean,
  model_slug       text,
  booklet_number   integer,
  quantity         integer,
  description      text,
  started_at       timestamptz,
  confirm_by       timestamptz,
  confirmed_at     timestamptz,
  dispatched_at    timestamptz,
  closed_at        timestamptz,
  erased_at        timestamptz
);

CREATE INDEX IF NOT EXISTS claims_owner_email_idx ON claims (lower(owner_email));
CREATE INDEX IF NOT EXISTS claims_queue_idx ON claims (confirmed_at DESC NULLS LAST, started_at DESC);

CREATE TABLE IF NOT EXISTS claim_history (
  id         bigserial PRIMARY KEY,
  reference  text NOT NULL,
  state      text NOT NULL,
  at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_history_reference_idx ON claim_history (reference, id);

CREATE TABLE IF NOT EXISTS claim_photos (
  reference     text NOT NULL,
  photo_index   integer NOT NULL,
  content_type  text NOT NULL,
  byte_count    integer NOT NULL,
  PRIMARY KEY (reference, photo_index)
);

CREATE TABLE IF NOT EXISTS claim_rulings (
  reference       text PRIMARY KEY,
  inside          boolean NOT NULL,
  edition_code    text NOT NULL,
  cover_ends_at   timestamptz NOT NULL,
  cover_ends_on   date NOT NULL,
  term_months     integer,
  decided_at      timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_revisions (
  reference              text NOT NULL,
  revision               integer NOT NULL,
  status                 text NOT NULL,
  source                 text NOT NULL,
  part_line_minor        integer NOT NULL,
  carriage_minor         integer NOT NULL,
  total_minor            integer NOT NULL,
  band                   text NOT NULL,
  carriage_valid_until   timestamptz NOT NULL,
  promise_kind           text NOT NULL,
  promise_date           date NOT NULL,
  quoted_at              timestamptz NOT NULL,
  invoice_id             text NOT NULL,
  stock_quantity         integer NOT NULL,
  stock_returned         boolean NOT NULL DEFAULT false,
  PRIMARY KEY (reference, revision)
);

CREATE TABLE IF NOT EXISTS claim_payments (
  reference    text PRIMARY KEY,
  paid_minor   integer NOT NULL,
  paid_at      timestamptz NOT NULL,
  payment_id   text NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_declines (
  reference        text PRIMARY KEY,
  reason           text NOT NULL,
  charged_minor    integer NOT NULL,
  refunded_minor   integer NOT NULL,
  declined_at      timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS confirm_links (
  token       text PRIMARY KEY,
  reference   text NOT NULL,
  confirm_by  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS confirm_links_reference_idx ON confirm_links (reference);

CREATE TABLE IF NOT EXISTS share_links (
  token       text PRIMARY KEY,
  reference   text NOT NULL,
  state       text NOT NULL,
  created_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS share_links_reference_idx ON share_links (reference);

CREATE TABLE IF NOT EXISTS idempotency_records (
  reference      text NOT NULL,
  idem_key       text NOT NULL,
  action         text NOT NULL,
  body_hash      text NOT NULL,
  status         integer NOT NULL,
  response_body  text NOT NULL,
  created_at     timestamptz NOT NULL,
  PRIMARY KEY (reference, idem_key)
);

CREATE TABLE IF NOT EXISTS reference_locks (
  reference     text PRIMARY KEY,
  wrong_tries   integer NOT NULL,
  locked_at     timestamptz
);

CREATE TABLE IF NOT EXISTS rate_windows (
  id       bigserial PRIMARY KEY,
  caller   text NOT NULL,
  at       timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_windows_caller_idx ON rate_windows (caller, at);

CREATE TABLE IF NOT EXISTS notice_queue (
  id          bigserial PRIMARY KEY,
  reference   text NOT NULL,
  notice      text NOT NULL,
  language    text NOT NULL,
  recipient   text NOT NULL,
  payload     jsonb NOT NULL,
  state       text NOT NULL,
  created_at  timestamptz NOT NULL,
  claimed_at  timestamptz,
  sent_at     timestamptz
);
CREATE INDEX IF NOT EXISTS notice_queue_waiting_idx ON notice_queue (state, id);
CREATE INDEX IF NOT EXISTS notice_queue_reference_idx ON notice_queue (reference);

CREATE TABLE IF NOT EXISTS operators (
  id             bigserial PRIMARY KEY,
  email          text UNIQUE NOT NULL,
  password_hash  text NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_sessions (
  token        text PRIMARY KEY,
  operator_id  bigint NOT NULL,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS editions (
  code                        text PRIMARY KEY,
  title                       text NOT NULL,
  starts_on                   date UNIQUE NOT NULL,
  standard_months             integer NOT NULL,
  club_months                 integer NOT NULL,
  owner_contribution_percent  integer NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  slug         text PRIMARY KEY,
  name         text NOT NULL,
  axis         text,
  sort_order   integer NOT NULL
);

CREATE TABLE IF NOT EXISTS model_retired_names (
  slug          text NOT NULL,
  retired_name  text NOT NULL,
  PRIMARY KEY (slug, retired_name)
);

CREATE TABLE IF NOT EXISTS parts (
  model_slug        text NOT NULL,
  booklet_number    integer NOT NULL,
  part_number       text NOT NULL,
  name              text NOT NULL,
  price_minor       integer NOT NULL,
  weight_g          integer NOT NULL,
  longest_side_mm   integer NOT NULL,
  status            text NOT NULL,
  bin_count         integer NOT NULL,
  PRIMARY KEY (model_slug, booklet_number)
);

CREATE TABLE IF NOT EXISTS club_roster (
  email      text PRIMARY KEY,
  joined_on  date NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_holidays (
  holiday  date PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS desk_counters (
  name   text PRIMARY KEY,
  value  bigint NOT NULL
);
