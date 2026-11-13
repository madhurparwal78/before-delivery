CREATE TABLE IF NOT EXISTS app_meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  email               text NOT NULL UNIQUE,
  password_hash       text NOT NULL,
  role                text NOT NULL,
  killbill_account_id text
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lots (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  origin     text NOT NULL,
  built_year integer NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
  tag           text PRIMARY KEY,
  species       text NOT NULL,
  grade         text,
  status        text NOT NULL,
  lot_id        text NOT NULL REFERENCES lots (id),
  length_mm     integer NOT NULL,
  width_mm      integer NOT NULL,
  thickness_mm  integer NOT NULL,
  defects       jsonb NOT NULL DEFAULT '[]'::jsonb,
  parent_tag    text REFERENCES boards (tag),
  from_cut      boolean NOT NULL DEFAULT false,
  cut_ticket_id text,
  created_at    timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS boards_parent_idx ON boards (parent_tag);
CREATE INDEX IF NOT EXISTS boards_status_idx ON boards (status);

CREATE TABLE IF NOT EXISTS photos (
  id           text PRIMARY KEY,
  board_tag    text NOT NULL REFERENCES boards (tag),
  content_type text NOT NULL,
  extension    text NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  original_key text NOT NULL,
  display_key  text NOT NULL,
  thumb_key    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sequence     bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS photos_board_idx ON photos (board_tag, sequence);

CREATE TABLE IF NOT EXISTS rate_versions (
  id           bigserial PRIMARY KEY,
  species      text NOT NULL,
  grade        text NOT NULL,
  rate_cents   integer NOT NULL,
  effective_at timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_versions_lookup_idx ON rate_versions (species, grade, effective_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS layouts (
  maker_id   text NOT NULL REFERENCES users (id),
  board_tag  text NOT NULL REFERENCES boards (tag),
  file_json  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (maker_id, board_tag)
);

CREATE TABLE IF NOT EXISTS holds (
  id                  text PRIMARY KEY,
  board_tag           text NOT NULL REFERENCES boards (tag),
  maker_id            text NOT NULL REFERENCES users (id),
  status              text NOT NULL,
  release_reason      text,
  pieces              jsonb NOT NULL,
  cuts_mm             jsonb NOT NULL,
  take_mm             integer NOT NULL,
  sale                text NOT NULL,
  offcut_mm           integer,
  price_cents         integer NOT NULL,
  deposit_cents       integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  held_at             timestamptz,
  expires_at          timestamptz,
  killbill_payment_id text
);

CREATE UNIQUE INDEX IF NOT EXISTS holds_one_live_per_board_idx
  ON holds (board_tag) WHERE status IN ('pending-payment', 'held');
CREATE INDEX IF NOT EXISTS holds_maker_idx ON holds (maker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS holds_expiry_idx ON holds (expires_at) WHERE status = 'held';

CREATE TABLE IF NOT EXISTS tickets (
  id                 text PRIMARY KEY,
  status             text NOT NULL,
  board_tag          text NOT NULL,
  maker_id           text NOT NULL REFERENCES users (id),
  pieces             jsonb NOT NULL,
  cuts_mm            jsonb NOT NULL,
  take_mm            integer NOT NULL,
  sale               text NOT NULL,
  offcut_tag         text,
  offcut_planned_mm  integer,
  offcut_measured_mm integer,
  pdf_key            text NOT NULL,
  created_at         timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS tickets_maker_idx ON tickets (maker_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_events (
  id         bigserial PRIMARY KEY,
  ticket_id  text NOT NULL REFERENCES tickets (id),
  kind       text NOT NULL,
  by_user_id text NOT NULL REFERENCES users (id),
  at         timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events (ticket_id, id);

CREATE TABLE IF NOT EXISTS invoices (
  id                  text PRIMARY KEY,
  ticket_id           text NOT NULL REFERENCES tickets (id),
  board_tag           text NOT NULL,
  maker_id            text NOT NULL REFERENCES users (id),
  price_cents         integer NOT NULL,
  deposit_cents       integer NOT NULL,
  amount_cents        integer NOT NULL,
  lines               jsonb NOT NULL,
  status              text NOT NULL,
  paid_at             timestamptz NOT NULL,
  killbill_payment_id text
);

CREATE INDEX IF NOT EXISTS invoices_maker_idx ON invoices (maker_id, id);

CREATE TABLE IF NOT EXISTS movements (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ticket_id  text,
  by_user_id text REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS movement_entries (
  id          bigserial PRIMARY KEY,
  movement_id bigint NOT NULL REFERENCES movements (id),
  account     text NOT NULL,
  volume_mm3  bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS movement_entries_account_idx ON movement_entries (account);
CREATE INDEX IF NOT EXISTS movement_entries_movement_idx ON movement_entries (movement_id, id);

CREATE TABLE IF NOT EXISTS idempotency_records (
  maker_id    text NOT NULL REFERENCES users (id),
  key         text NOT NULL,
  fingerprint text NOT NULL,
  status      integer,
  body        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (maker_id, key)
);

CREATE SEQUENCE IF NOT EXISTS board_tag_seq START WITH 11;
CREATE SEQUENCE IF NOT EXISTS lot_id_seq START WITH 4;
CREATE SEQUENCE IF NOT EXISTS hold_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS ticket_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS invoice_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS photo_id_seq START WITH 1;
