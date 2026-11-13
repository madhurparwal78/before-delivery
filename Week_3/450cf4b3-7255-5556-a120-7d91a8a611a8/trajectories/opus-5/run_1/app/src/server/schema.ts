export const SCHEMA_SQL = `
create extension if not exists btree_gist;

create table if not exists tenants (
  id uuid primary key,
  business_name text not null,
  contact_name text not null,
  email text not null,
  base_status text not null check (base_status in ('applied','documents_pending','approved')),
  killbill_account_id text,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key,
  role text not null check (role in ('owner','shift_lead','tenant')),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  tenant_id uuid references tenants(id),
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key,
  token_hash text not null unique,
  user_id uuid not null references users(id),
  password_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists signin_attempts (
  id bigserial primary key,
  email text not null,
  outcome text not null check (outcome in ('failure','success')),
  created_at timestamptz not null default now()
);
create index if not exists signin_attempts_email_idx on signin_attempts (email, created_at desc);

create table if not exists counted_claims (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  created_at timestamptz not null default now()
);
create index if not exists counted_claims_tenant_idx on counted_claims (tenant_id, created_at desc);

create table if not exists stations (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('range','prep_table','mixer','cooler_shelf')),
  cleanup_minutes int not null,
  col int not null,
  row_index int not null,
  seed_order int not null
);

create table if not exists packs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  hours int not null,
  purchased_minutes int not null,
  price_cents int not null,
  status text not null check (status in ('active','refunded')),
  invoice_id text not null,
  killbill_payment_id text,
  purchased_at timestamptz not null,
  refunded_cents int
);
create index if not exists packs_tenant_idx on packs (tenant_id, purchased_at);

create table if not exists bookings (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  station_id text not null references stations(id),
  shelf_id text references stations(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  buffer_end_at timestamptz not null,
  status text not null check (status in ('held','confirmed','checked_in','completed','cancelled','no_show')),
  hold_expires_at timestamptz,
  pack_id uuid references packs(id),
  debited_minutes int,
  refunded_minutes int,
  cancel_reason text check (cancel_reason in ('tenant','hold_expired')),
  move_count int not null default 0,
  cleanup_note text,
  created_at timestamptz not null default now()
);
create index if not exists bookings_tenant_idx on bookings (tenant_id, start_at);
create index if not exists bookings_start_idx on bookings (start_at);
create index if not exists bookings_pack_idx on bookings (pack_id);

create table if not exists booking_occupancies (
  booking_id uuid not null references bookings(id) on delete cascade,
  station_id text not null references stations(id),
  period tstzrange not null,
  primary key (booking_id, station_id),
  constraint booking_occupancies_no_overlap exclude using gist (station_id with =, period with &&)
);

create table if not exists door_log (
  id bigserial primary key,
  booking_id uuid not null references bookings(id),
  action text not null check (action in ('check_in','check_out','no_show')),
  at timestamptz not null,
  by_user_id uuid not null references users(id),
  by_name text not null
);
create index if not exists door_log_booking_idx on door_log (booking_id, id);

create table if not exists documents (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  kind text not null check (kind in ('insurance_certificate','food_handler_card')),
  expires_on date not null,
  per_occurrence_limit int,
  additional_insured boolean,
  content_type text,
  size_bytes int,
  sha256 text,
  has_file boolean not null,
  object_key text,
  uploaded_at timestamptz not null
);
create index if not exists documents_tenant_idx on documents (tenant_id, kind, uploaded_at desc);

create table if not exists notice_claims (
  id bigserial primary key,
  document_id uuid not null references documents(id),
  point text not null check (point in ('seven_days','today')),
  claimed_at timestamptz not null default now(),
  unique (document_id, point)
);

create table if not exists ledger_movements (
  id uuid primary key,
  pack_id uuid not null references packs(id),
  movement text not null check (movement in ('purchase','booking_debit','cancellation_credit','move_adjustment','refund')),
  booking_id uuid references bookings(id),
  created_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key,
  movement_id uuid not null references ledger_movements(id),
  pack_id uuid not null references packs(id),
  side text not null check (side in ('pack','kitchen')),
  minutes int not null,
  booking_id uuid references bookings(id),
  created_at timestamptz not null default now()
);
create index if not exists ledger_entries_pack_idx on ledger_entries (pack_id, created_at, id);

create table if not exists idempotency_keys (
  user_id uuid not null references users(id),
  endpoint text not null,
  key text not null,
  body_fingerprint text not null,
  state text not null check (state in ('running','done')),
  response_status int,
  response_body text,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint, key)
);

create table if not exists purchase_attempts (
  id uuid primary key,
  user_id uuid not null references users(id),
  tenant_id uuid not null references tenants(id),
  endpoint text not null,
  idempotency_key text not null,
  hours int not null,
  price_cents int not null,
  state text not null check (state in ('started','invoiced','paid','recorded')),
  killbill_invoice_id text,
  killbill_payment_id text,
  pack_id uuid references packs(id),
  created_at timestamptz not null default now(),
  unique (user_id, endpoint, idempotency_key)
);

create table if not exists mail_queue (
  id bigserial primary key,
  kind text not null,
  record_id text,
  to_name text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null check (status in ('queued','sent')),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists mail_queue_record_idx on mail_queue (record_id, kind, id);
create index if not exists mail_queue_pending_idx on mail_queue (status, claimed_at);

create table if not exists seed_state (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
`;
