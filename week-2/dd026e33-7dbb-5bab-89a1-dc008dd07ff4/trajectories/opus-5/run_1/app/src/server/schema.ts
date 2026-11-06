export const SCHEMA_SQL = `
create table if not exists users (
  id text primary key,
  name text not null,
  email text not null unique,
  role text not null,
  password_hash text not null,
  active boolean not null default true,
  revoked_at timestamptz,
  last_sign_in_at timestamptz,
  units_film text not null default 'um',
  units_pressure text not null default 'bar',
  units_distance text not null default 'km'
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_reason text
);
create index if not exists sessions_user_idx on sessions(user_id);

create table if not exists bays (
  id text primary key,
  code text not null unique,
  class text not null,
  length_mm integer not null,
  width_mm integer not null,
  row_index integer not null,
  column_index integer not null
);

create table if not exists cars (
  id text primary key,
  owner_id text not null references users(id),
  year integer not null,
  make text not null,
  model text not null,
  registration text not null,
  colour text not null,
  length_mm integer not null,
  width_mm integer not null,
  odometer_km integer not null,
  tyre_spec_bar numeric(4,2) not null,
  startup_scheduled boolean not null,
  status text not null,
  bay_id text references bays(id),
  stay_seq integer not null default 0,
  intake_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null
);
create unique index if not exists cars_one_per_bay on cars(bay_id) where bay_id is not null;

create table if not exists belongings (
  id text primary key,
  car_id text not null references cars(id),
  kind text not null,
  label text not null,
  created_at timestamptz not null
);
create index if not exists belongings_car_idx on belongings(car_id);

create table if not exists movements (
  id text primary key,
  item_id text not null references belongings(id),
  direction text not null,
  count integer not null,
  at timestamptz not null,
  by_user text not null references users(id)
);
create index if not exists movements_item_idx on movements(item_id);

create table if not exists condition_reports (
  id text primary key,
  car_id text not null references cars(id),
  stay_seq integer not null,
  claimed_at timestamptz not null,
  completed boolean not null default false,
  sha256 text,
  size_bytes integer,
  object_key text,
  uploaded_at timestamptz,
  uploaded_by text references users(id),
  unique (car_id, stay_seq)
);

create table if not exists photos (
  id text primary key,
  car_id text not null references cars(id),
  kind text not null,
  job_id text,
  content_type text not null,
  size_bytes integer not null,
  object_key text not null,
  created_at timestamptz not null,
  created_by text not null references users(id)
);
create index if not exists photos_car_idx on photos(car_id);

create table if not exists care_entries (
  id text primary key,
  car_id text not null references cars(id),
  at timestamptz not null,
  by_user text not null references users(id),
  started boolean not null,
  battery_v numeric(5,2),
  tyre_fl numeric(4,2),
  tyre_fr numeric(4,2),
  tyre_rl numeric(4,2),
  tyre_rr numeric(4,2),
  note text not null default '',
  flags text[] not null default '{}'
);
create index if not exists care_entries_car_idx on care_entries(car_id, at desc);

create table if not exists jobs (
  id text primary key,
  number text not null unique,
  car_id text not null references cars(id),
  owner_id text not null references users(id),
  title text not null,
  status text not null,
  version integer not null default 1,
  sent_at timestamptz,
  expires_at timestamptz,
  approved_at timestamptz,
  declined_at timestamptz,
  finished_at timestamptz,
  invoice_id text,
  created_at timestamptz not null
);
create index if not exists jobs_car_idx on jobs(car_id);

create table if not exists job_lines (
  id text primary key,
  job_id text not null references jobs(id) on delete cascade,
  position integer not null,
  kind text not null,
  description text not null,
  quantity numeric(12,2) not null,
  unit_price numeric(12,2) not null
);
create index if not exists job_lines_job_idx on job_lines(job_id, position);

create table if not exists job_stages (
  id text primary key,
  job_id text not null references jobs(id),
  name text not null,
  stage_order integer not null,
  logged_at timestamptz not null,
  logged_by text not null references users(id),
  unique (job_id, name)
);

create table if not exists readings (
  id text primary key,
  job_id text not null references jobs(id),
  stage_id text not null references job_stages(id),
  panel text not null,
  film_um integer not null,
  logged_at timestamptz not null,
  logged_by text not null references users(id)
);
create index if not exists readings_job_idx on readings(job_id);

create table if not exists invoices (
  id text primary key,
  number text not null unique,
  job_id text not null unique references jobs(id),
  car_id text not null references cars(id),
  owner_id text not null references users(id),
  killbill_invoice_id text not null,
  killbill_account_id text not null,
  net_total numeric(12,2) not null,
  vat_total numeric(12,2) not null,
  rounding numeric(12,2) not null,
  total numeric(12,2) not null,
  issued_at timestamptz not null,
  last_balance numeric(12,2) not null,
  last_status text not null,
  status_confirmed_at timestamptz not null,
  paid_at date
);

create table if not exists invoice_lines (
  id text primary key,
  invoice_id text not null references invoices(id),
  position integer not null,
  kind text not null,
  description text not null,
  quantity numeric(12,2) not null,
  unit_price numeric(12,2) not null
);
create index if not exists invoice_lines_invoice_idx on invoice_lines(invoice_id, position);

create table if not exists transfers (
  id text primary key,
  invoice_id text not null references invoices(id),
  reference text not null,
  amount numeric(12,2) not null,
  recorded_by text not null references users(id),
  at timestamptz not null,
  killbill_payment_id text
);
create index if not exists transfers_invoice_idx on transfers(invoice_id, at);

create table if not exists releases (
  id text primary key,
  car_id text not null references cars(id),
  owner_id text not null references users(id),
  slot text not null,
  slot_at timestamptz not null,
  status text not null,
  bay_code text,
  created_at timestamptz not null
);
create unique index if not exists releases_one_open_per_car on releases(car_id)
  where status in ('requested','booked','staged');
create unique index if not exists releases_one_open_per_slot on releases(slot)
  where status in ('requested','booked','staged');

create table if not exists release_events (
  id text primary key,
  release_id text not null references releases(id),
  status text not null,
  at timestamptz not null,
  by_user text not null references users(id)
);
create index if not exists release_events_idx on release_events(release_id, at);

create table if not exists killbill_accounts (
  owner_id text primary key references users(id),
  killbill_account_id text not null
);

create table if not exists subscriptions (
  car_id text primary key references cars(id),
  owner_id text not null references users(id),
  plan text not null,
  killbill_subscription_id text,
  charged_through_date date,
  billing_end_date date,
  cancel_requested boolean not null default false,
  cancelled boolean not null default false,
  created_at timestamptz not null
);

create table if not exists idempotency (
  user_id text not null,
  route text not null,
  key text not null,
  request_hash text not null,
  status integer not null,
  body text not null,
  created_at timestamptz not null,
  primary key (user_id, route, key)
);

create table if not exists queue (
  id bigserial primary key,
  kind text not null,
  car_id text,
  payload jsonb not null,
  created_at timestamptz not null,
  attempts integer not null default 0,
  claimed_at timestamptz,
  done_at timestamptz,
  last_error text
);
create index if not exists queue_pending_idx on queue(done_at, id);

create table if not exists counters (
  name text primary key,
  value integer not null
);
`;
