create table if not exists copy_identity (
  only_row boolean primary key default true check (only_row),
  copy_id text not null
);

create table if not exists accounts (
  id text primary key,
  role text not null,
  display_name text not null,
  email text not null unique,
  password_hash text not null,
  password_salt text not null
);

create table if not exists sessions (
  token text primary key,
  account_id text not null references accounts(id),
  created_at timestamptz not null default now()
);

create table if not exists drinks (
  id text primary key,
  name text not null,
  carbonated boolean not null,
  sugar_mg_per_100ml integer not null,
  position integer not null
);

create unique index if not exists drinks_name_lower on drinks (lower(name));

create table if not exists skus (
  code text primary key,
  drink_id text not null references drinks(id),
  variant text not null,
  format text not null,
  size_ml integer not null,
  shelf_days integer not null,
  launch_mrp_paise bigint not null,
  position integer not null
);

create table if not exists sku_history (
  id bigserial primary key,
  sku_code text not null references skus(code),
  at timestamptz not null,
  field text not null,
  from_value text not null,
  to_value text not null
);

create table if not exists aliases (
  normalised text primary key,
  sku_code text not null references skus(code)
);

create table if not exists batches (
  code text primary key,
  sku_code text not null references skus(code),
  packed_date date not null,
  old_wrapper boolean not null default false
);

create table if not exists sheets (
  id text primary key,
  filename text not null,
  sha256 text not null unique,
  size_bytes bigint not null,
  imported_at timestamptz not null default now(),
  seq bigserial
);

create table if not exists sheet_rows (
  sheet_id text not null references sheets(id) on delete cascade,
  row_number integer not null,
  raw_code text,
  raw_description text,
  raw_new_mrp text,
  raw_old_gst text,
  raw_new_gst text,
  status text not null,
  matched_by text,
  sku_code text,
  candidates jsonb not null default '[]',
  reason text,
  new_mrp_paise bigint,
  old_rate integer,
  new_rate integer,
  merged_into_row integer,
  ignored boolean not null default false,
  final_settled boolean not null default false,
  primary key (sheet_id, row_number)
);

create table if not exists notices (
  id text primary key,
  number text not null unique,
  year integer not null,
  sequence integer not null,
  created_at timestamptz not null default now()
);

create table if not exists notice_versions (
  notice_id text not null references notices(id),
  version integer not null,
  title text not null,
  effective_date date not null,
  run_out_until date,
  published_at timestamptz not null,
  reason text,
  print_state text not null default 'pending',
  pdf_sha256 text,
  sheet_id text references sheets(id),
  primary key (notice_id, version)
);

create table if not exists notice_rows (
  notice_id text not null,
  version integer not null,
  position integer not null,
  sku_code text not null references skus(code),
  name text not null,
  kind text not null,
  old_mrp_paise bigint not null,
  revised_mrp_paise bigint not null,
  old_rate integer,
  new_rate integer,
  primary key (notice_id, version, position),
  foreign key (notice_id, version) references notice_versions(notice_id, version)
);

create table if not exists drafts (
  id text primary key,
  revision integer not null default 1,
  title text not null,
  effective_date date,
  run_out_until date,
  sheet_id text references sheets(id),
  created_at timestamptz not null default now(),
  published boolean not null default false,
  seq bigserial
);

create table if not exists draft_rows (
  draft_id text not null references drafts(id) on delete cascade,
  position integer not null,
  sku_code text not null,
  kind text not null,
  revised_mrp_paise bigint,
  old_rate integer,
  new_rate integer,
  primary key (draft_id, position)
);

create table if not exists endpoints (
  id text primary key,
  account_id text not null references accounts(id),
  url text not null,
  normalised_url text not null,
  signing_secret text not null,
  registered boolean not null default false,
  svix_endpoint_id text,
  rotating boolean not null default false,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);

create unique index if not exists endpoints_live_url
  on endpoints (account_id, normalised_url) where removed_at is null;

create table if not exists deliveries (
  event_id text primary key,
  account_id text not null references accounts(id),
  endpoint_id text not null references endpoints(id),
  event_type text not null,
  notice_number text,
  notice_version integer,
  payload jsonb not null,
  handed_over boolean not null default false,
  svix_message_id text,
  attempts jsonb not null default '[]',
  redelivery_requested boolean not null default false,
  redelivery_from integer,
  cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  seq bigserial
);

create table if not exists outbox (
  id bigserial primary key,
  job_id text not null,
  kind text not null,
  body jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists outbox_unpublished on outbox (id) where published_at is null;

create table if not exists index_pending (
  sku_code text primary key references skus(code),
  requested_at timestamptz not null default now()
);

create table if not exists counters (
  name text primary key,
  value bigint not null default 0
);

create table if not exists notice_sequence (
  year integer primary key,
  last_sequence integer not null
);
