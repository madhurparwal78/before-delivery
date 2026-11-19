export const SCHEMA_SQL = `
create table if not exists settings (
  id int primary key,
  time_zone text not null,
  late_fee_cents int not null,
  damage_fee_cents int not null,
  loan_period_days int not null
);

create table if not exists opening_hours (
  weekday text primary key,
  opens text not null,
  closes text not null
);

create table if not exists closures (
  closure_date date primary key,
  reason text not null
);

create table if not exists users (
  id serial primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null
);

create table if not exists memberships (
  user_id int primary key references users(id),
  status text not null,
  tier text not null,
  active_until date,
  ends_at_term boolean not null default false,
  killbill_account_id text,
  killbill_subscription_id text
);

create table if not exists sessions (
  id text primary key,
  user_id int not null references users(id),
  last_activity_at timestamptz not null default now()
);
alter table sessions add column if not exists ended_at timestamptz;

create table if not exists items (
  id serial primary key,
  tag text not null unique,
  name text not null,
  replacement_cost_cents int not null
);

create table if not exists parts (
  id serial primary key,
  item_id int not null references items(id),
  name text not null,
  shape text not null,
  grid_col int not null,
  grid_row int not null,
  width int not null,
  height int not null,
  state text not null,
  listed_at int not null
);
create index if not exists parts_item_idx on parts(item_id);

create sequence if not exists loan_ref_seq;

create table if not exists loans (
  id serial primary key,
  ref text not null unique,
  member_id int not null references users(id),
  status text not null,
  checked_out_at timestamptz,
  due_date date,
  fee_rules jsonb,
  returned_at timestamptz,
  recorded_open_days_late int,
  recorded_late_fee_cents int,
  created_at timestamptz not null default now()
);
create index if not exists loans_status_idx on loans(status);

create table if not exists loan_items (
  loan_id int not null references loans(id) on delete cascade,
  item_id int not null references items(id),
  listed_at int not null,
  grade text,
  primary key (loan_id, item_id)
);
create index if not exists loan_items_item_idx on loan_items(item_id);

create table if not exists photos (
  id serial primary key,
  loan_id int not null references loans(id) on delete cascade,
  event text not null,
  content_type text not null,
  byte_size int not null,
  sha256 text not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  storage_key text not null,
  unique (loan_id, event)
);

create table if not exists fees (
  id serial primary key,
  loan_id int not null unique references loans(id) on delete cascade,
  member_id int not null references users(id),
  status text not null,
  total_cents int not null,
  killbill_invoice_id text,
  waiver_status text,
  waiver_reason text,
  waiver_requested_at timestamptz,
  waiver_decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists fee_lines (
  id serial primary key,
  fee_id int not null references fees(id) on delete cascade,
  listed_at int not null,
  item_id int not null,
  kind text not null,
  open_days int,
  amount_cents int not null,
  description text not null
);
create index if not exists fee_lines_fee_idx on fee_lines(fee_id);

create table if not exists holds (
  id serial primary key,
  item_id int not null references items(id),
  member_id int not null references users(id),
  status text not null,
  placed_at timestamptz not null default now()
);
create unique index if not exists holds_one_active_per_member_item
  on holds(item_id, member_id) where status in ('queued', 'ready');
create index if not exists holds_item_idx on holds(item_id);

create table if not exists mail_outbox (
  id serial primary key,
  dedupe_key text not null unique,
  to_email text not null,
  subject text not null,
  body text not null,
  sent_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists reminders_sent (
  loan_id int not null references loans(id) on delete cascade,
  due_date date not null,
  primary key (loan_id, due_date)
);
`;
