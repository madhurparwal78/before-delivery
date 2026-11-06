export const SCHEMA_SQL = `
create extension if not exists btree_gist;

create table if not exists stations (
  code text primary key,
  name text not null,
  seq integer not null
);

create table if not exists trains (
  number text primary key,
  name text not null,
  seq integer not null
);

create table if not exists train_stops (
  train_number text not null references trains(number),
  seq integer not null,
  station_code text not null references stations(code),
  km integer not null,
  stop_time text not null,
  day_offset integer not null,
  remote boolean not null,
  primary key (train_number, seq)
);

create table if not exists coaches (
  train_number text not null references trains(number),
  code text not null,
  travel_class text not null,
  seq integer not null,
  primary key (train_number, code)
);

create table if not exists accounts (
  id uuid primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  phone text not null,
  killbill_account_id text,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  pnr text primary key,
  account_id uuid not null references accounts(id),
  train_number text not null references trains(number),
  run_date date not null,
  travel_class text not null,
  quota text not null,
  from_code text not null,
  to_code text not null,
  from_seq integer not null,
  to_seq integer not null,
  keep_in_one_coach boolean not null,
  lower_berth_only boolean not null,
  contact_phone text not null,
  total_paise bigint not null,
  fare_lines jsonb not null,
  version integer not null default 1,
  chart_applied boolean not null default false,
  killbill_payment_id text,
  created_at timestamptz not null default now()
);

create index if not exists bookings_run_idx on bookings (train_number, run_date, travel_class);
create index if not exists bookings_account_idx on bookings (account_id, created_at desc);

create table if not exists passengers (
  pnr text not null references bookings(pnr) on delete cascade,
  number integer not null,
  name text not null,
  age integer not null,
  gender text not null,
  berth_preference text not null,
  fare_paise bigint not null,
  booking_status jsonb not null,
  current_status jsonb not null,
  primary key (pnr, number)
);

create table if not exists passenger_history (
  id bigserial primary key,
  pnr text not null references bookings(pnr) on delete cascade,
  passenger_number integer not null,
  at timestamptz not null,
  from_label text not null,
  to_label text not null
);

create index if not exists passenger_history_pnr_idx on passenger_history (pnr, id);

create table if not exists holds (
  id bigserial primary key,
  train_number text not null,
  run_date date not null,
  travel_class text not null,
  coach text not null,
  berth integer not null,
  slot integer not null,
  stretch int4range not null,
  pnr text not null references bookings(pnr) on delete cascade,
  passenger_number integer not null,
  constraint holds_one_per_stretch exclude using gist (
    train_number with =,
    run_date with =,
    coach with =,
    berth with =,
    slot with =,
    stretch with &&
  )
);

create index if not exists holds_run_idx on holds (train_number, run_date, travel_class);
create index if not exists holds_pnr_idx on holds (pnr);

create table if not exists queue_entries (
  id bigserial primary key,
  train_number text not null,
  run_date date not null,
  travel_class text not null,
  queue text not null,
  position integer not null,
  pnr text not null references bookings(pnr) on delete cascade,
  passenger_number integer not null,
  unique (pnr, passenger_number)
);

create index if not exists queue_entries_run_idx
  on queue_entries (train_number, run_date, travel_class, queue, position);

create table if not exists cancellations (
  pnr text not null references bookings(pnr) on delete cascade,
  number integer not null,
  requested_at timestamptz not null,
  refund_paise bigint not null,
  passengers jsonb not null,
  primary key (pnr, number)
);

create table if not exists refunds (
  pnr text not null references bookings(pnr) on delete cascade,
  number integer not null,
  reason text not null,
  refund_paise bigint not null,
  status text not null,
  issued_at timestamptz,
  primary key (pnr, number)
);

create table if not exists tickets (
  pnr text not null references bookings(pnr) on delete cascade,
  version integer not null,
  kind text not null,
  created_at timestamptz not null,
  stored boolean not null default false,
  object_key text not null,
  etag text,
  payload jsonb not null,
  primary key (pnr, version)
);

create table if not exists outbox (
  id bigserial primary key,
  dedupe_key text not null unique,
  to_email text not null,
  subject text not null,
  body text not null,
  attach_pnr text,
  attach_version integer,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);

create index if not exists outbox_pending_idx on outbox (sent_at) where sent_at is null;

create table if not exists chart_runs (
  train_number text not null,
  run_date date not null,
  prepared_at timestamptz not null,
  primary key (train_number, run_date)
);

create table if not exists idempotency_records (
  account_id uuid not null references accounts(id) on delete cascade,
  idem_key text not null,
  body_hash text not null,
  state text not null,
  status_code integer,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (account_id, idem_key)
);
`;
