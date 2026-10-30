export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kitchens (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  timezone             text NOT NULL,
  same_day_cutoff_minutes integer NOT NULL CHECK (same_day_cutoff_minutes BETWEEN 0 AND 1425)
);

CREATE TABLE IF NOT EXISTS stations (
  id          text PRIMARY KEY,
  kitchen_id  text NOT NULL REFERENCES kitchens(id),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('oven','mixer','chiller','prep','range','kettle','cooler')),
  loom_order  integer NOT NULL,
  UNIQUE (kitchen_id, loom_order)
);

CREATE TABLE IF NOT EXISTS members (
  id            text PRIMARY KEY,
  kitchen_id    text NOT NULL REFERENCES kitchens(id),
  business      text NOT NULL,
  contact_email text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  kitchen_id    text NOT NULL REFERENCES kitchens(id),
  member_id     text REFERENCES members(id),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  role          text NOT NULL CHECK (role IN ('operator','member','bookkeeper')),
  password_hash text NOT NULL,
  CHECK ((role = 'member') = (member_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_cards (
  id                        text PRIMARY KEY,
  kitchen_id                text NOT NULL REFERENCES kitchens(id),
  effective_from            date NOT NULL,
  tier_1_cents              integer NOT NULL CHECK (tier_1_cents > 0),
  tier_2_cents              integer NOT NULL CHECK (tier_2_cents > 0),
  tier_3_cents              integer NOT NULL CHECK (tier_3_cents > 0),
  tier_4_cents              integer NOT NULL CHECK (tier_4_cents > 0),
  cancellation_window_hours integer NOT NULL CHECK (cancellation_window_hours BETWEEN 0 AND 336),
  pack_price_cents          integer NOT NULL CHECK (pack_price_cents > 0),
  created_at                timestamptz NOT NULL,
  UNIQUE (kitchen_id, effective_from)
);

CREATE TABLE IF NOT EXISTS rate_card_surcharges (
  rate_card_id    text NOT NULL REFERENCES rate_cards(id),
  station_id      text NOT NULL REFERENCES stations(id),
  surcharge_cents integer NOT NULL CHECK (surcharge_cents >= 0),
  PRIMARY KEY (rate_card_id, station_id)
);

CREATE TABLE IF NOT EXISTS holds (
  id         text PRIMARY KEY,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  member_id  text NOT NULL REFERENCES members(id),
  date       date NOT NULL,
  state      text NOT NULL CHECK (state IN ('held','released','confirmed')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS hold_cells (
  hold_id      text NOT NULL REFERENCES holds(id),
  station_id   text NOT NULL REFERENCES stations(id),
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 240 AND 1425),
  PRIMARY KEY (hold_id, station_id, start_minute)
);

CREATE INDEX IF NOT EXISTS holds_kitchen_date_idx ON holds (kitchen_id, date, state);

CREATE TABLE IF NOT EXISTS series (
  id           text PRIMARY KEY,
  kitchen_id   text NOT NULL REFERENCES kitchens(id),
  member_id    text NOT NULL REFERENCES members(id),
  weekday      integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute integer NOT NULL,
  end_minute   integer NOT NULL,
  station_ids  text[] NOT NULL,
  weeks        integer NOT NULL CHECK (weeks BETWEEN 2 AND 12),
  created_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id                  text PRIMARY KEY,
  ref                 text NOT NULL UNIQUE,
  kitchen_id          text NOT NULL REFERENCES kitchens(id),
  member_id           text NOT NULL REFERENCES members(id),
  kind                text NOT NULL CHECK (kind IN ('booking','series','pack')),
  total_cents         integer NOT NULL,
  killbill_invoice_id text,
  issued_at           timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id                        text PRIMARY KEY,
  ref                       text NOT NULL UNIQUE,
  kitchen_id                text NOT NULL REFERENCES kitchens(id),
  member_id                 text NOT NULL REFERENCES members(id),
  series_id                 text REFERENCES series(id),
  invoice_id                text REFERENCES invoices(id),
  date                      date NOT NULL,
  state                     text NOT NULL CHECK (state IN ('confirmed','checked_in','completed','no_show','cancelled_in_window','cancelled_late')),
  rate_card_id              text NOT NULL REFERENCES rate_cards(id),
  cancellation_window_hours integer NOT NULL,
  pack_quarters             integer NOT NULL CHECK (pack_quarters >= 0),
  total_cents               integer NOT NULL CHECK (total_cents >= 0),
  starts_at                 timestamptz NOT NULL,
  ends_at                   timestamptz NOT NULL,
  confirmed_at              timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS bookings_kitchen_date_idx ON bookings (kitchen_id, date, state);
CREATE INDEX IF NOT EXISTS bookings_member_idx ON bookings (member_id, date);

CREATE TABLE IF NOT EXISTS booking_cells (
  booking_id   text NOT NULL REFERENCES bookings(id),
  station_id   text NOT NULL REFERENCES stations(id),
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 240 AND 1425),
  PRIMARY KEY (booking_id, station_id, start_minute)
);

CREATE TABLE IF NOT EXISTS booking_lines (
  booking_id        text NOT NULL REFERENCES bookings(id),
  idx               integer NOT NULL,
  station_id        text NOT NULL REFERENCES stations(id),
  tier              integer NOT NULL CHECK (tier BETWEEN 1 AND 4),
  paid_by           text NOT NULL CHECK (paid_by IN ('cash','pack')),
  quarters          integer NOT NULL CHECK (quarters > 0),
  hourly_rate_cents integer NOT NULL,
  amount_cents      integer NOT NULL,
  PRIMARY KEY (booking_id, idx)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_id        text NOT NULL REFERENCES invoices(id),
  idx               integer NOT NULL,
  booking_id        text REFERENCES bookings(id),
  cell_date         date,
  station_id        text REFERENCES stations(id),
  tier              integer CHECK (tier BETWEEN 1 AND 4),
  paid_by           text CHECK (paid_by IN ('cash','pack')),
  quarters          integer,
  hourly_rate_cents integer,
  description       text,
  amount_cents      integer NOT NULL,
  PRIMARY KEY (invoice_id, idx)
);

CREATE TABLE IF NOT EXISTS pack_movements (
  id         text PRIMARY KEY,
  member_id  text NOT NULL REFERENCES members(id),
  kind       text NOT NULL CHECK (kind IN ('purchase','draw','refund')),
  quarters   integer NOT NULL CHECK (quarters > 0),
  booking_id text REFERENCES bookings(id),
  reverses   text REFERENCES pack_movements(id) UNIQUE,
  created_at timestamptz NOT NULL,
  seq        bigserial NOT NULL
);

CREATE TABLE IF NOT EXISTS pack_entries (
  movement_id text NOT NULL REFERENCES pack_movements(id),
  idx         integer NOT NULL,
  account     text NOT NULL CHECK (account IN ('member_pack','pack_sales','hours_used')),
  quarters    integer NOT NULL,
  PRIMARY KEY (movement_id, idx)
);

CREATE TABLE IF NOT EXISTS documents (
  id            text PRIMARY KEY,
  kitchen_id    text NOT NULL REFERENCES kitchens(id),
  member_id     text NOT NULL REFERENCES members(id),
  type          text NOT NULL CHECK (type IN ('insurance','food_handler','kitchen_agreement')),
  state         text NOT NULL CHECK (state IN ('uploaded','verified','rejected')),
  expires_on    date,
  original_name text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  content_type  text NOT NULL,
  uploaded_at   timestamptz NOT NULL,
  reject_reason text,
  storage_key   text NOT NULL,
  file_stored   boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS documents_member_idx ON documents (member_id, type, state);

CREATE TABLE IF NOT EXISTS document_reminders (
  document_id text PRIMARY KEY REFERENCES documents(id),
  sent_at     timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id    text NOT NULL REFERENCES users(id),
  key        text NOT NULL,
  method     text NOT NULL,
  path       text NOT NULL,
  body_hash  text NOT NULL,
  status     integer,
  response   jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL,
  actor_id     text REFERENCES users(id),
  kitchen_id   text REFERENCES kitchens(id),
  subject      text NOT NULL,
  subject_id   text NOT NULL,
  from_state   text,
  to_state     text NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS booking_ref_seq START WITH 3;
CREATE SEQUENCE IF NOT EXISTS invoice_ref_seq START WITH 1;

CREATE TABLE IF NOT EXISTS seed_marker (
  id        integer PRIMARY KEY CHECK (id = 1),
  seeded_on date NOT NULL
);
`;
