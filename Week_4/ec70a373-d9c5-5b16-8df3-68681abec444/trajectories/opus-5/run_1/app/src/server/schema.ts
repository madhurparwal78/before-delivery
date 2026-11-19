export const SCHEMA_SQL = `
create table if not exists tenants (
  id uuid primary key,
  name text not null,
  legal_name text not null
);

create table if not exists sites (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  time_zone text not null,
  address text not null,
  display_order integer not null
);

create table if not exists stations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  site_id uuid not null references sites(id),
  name text not null,
  kind text not null,
  display_order integer not null
);

create table if not exists users (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  email text not null,
  email_lower text not null unique,
  password_hash text not null,
  role text not null,
  site_id uuid null references sites(id)
);

create table if not exists members (
  id uuid primary key,
  user_id uuid not null unique references users(id),
  tenant_id uuid not null references tenants(id),
  business_name text not null,
  contact_name text not null,
  home_site_id uuid not null references sites(id),
  seeded_certificate_of_insurance date null,
  seeded_food_handler_certificate date null,
  seeded_business_licence date null,
  killbill_account_id text null
);

create table if not exists trucks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  member_id uuid not null unique references members(id),
  site_id uuid not null references sites(id),
  name text not null,
  permit_number text not null
);

create table if not exists packs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  quarters integer not null,
  price_cents integer not null,
  display_order integer not null
);

create table if not exists pack_purchases (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  member_id uuid not null references members(id),
  pack_id uuid not null references packs(id),
  pack_name text not null,
  quarters integer not null,
  price_cents integer not null,
  valid_through date not null,
  killbill_payment_id text null,
  created_at timestamptz not null
);

create table if not exists lots (
  id uuid primary key,
  member_id uuid not null references members(id),
  purchase_id uuid null references pack_purchases(id),
  pack_name text not null,
  valid_through date null,
  created_at timestamptz not null,
  seq bigserial
);
create index if not exists lots_member_idx on lots (member_id);

create table if not exists movements (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  member_id uuid not null references members(id),
  kind text not null,
  booking_id uuid null,
  purchase_id uuid null,
  quarters integer not null,
  created_at timestamptz not null,
  actor_user_id uuid null references users(id),
  actor_name text null,
  actor_role text null,
  dedupe_key text null unique,
  seq bigserial
);
create index if not exists movements_member_idx on movements (member_id, seq desc);
create index if not exists movements_booking_idx on movements (booking_id);

create table if not exists movement_entries (
  id bigserial primary key,
  movement_id uuid not null references movements(id),
  member_id uuid not null references members(id),
  account text not null,
  quarters integer not null,
  position integer not null
);
create index if not exists movement_entries_member_idx on movement_entries (member_id, account);

create table if not exists movement_lots (
  id bigserial primary key,
  movement_id uuid not null references movements(id),
  lot_id uuid not null references lots(id),
  quarters integer not null,
  direction integer not null,
  position integer not null
);
create index if not exists movement_lots_lot_idx on movement_lots (lot_id);

create table if not exists series (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  member_id uuid not null references members(id),
  station_id uuid not null references stations(id),
  weekday integer not null,
  start_minutes integer not null,
  end_minutes integer not null,
  weeks integer not null,
  created_at timestamptz not null
);

create table if not exists bookings (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  site_id uuid not null references sites(id),
  station_id uuid not null references stations(id),
  member_id uuid not null references members(id),
  reference text not null,
  booking_date date not null,
  start_minutes integer not null,
  end_minutes integer not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  occupied_end_at timestamptz not null,
  quarters integer not null,
  status text not null,
  hold_expires_at timestamptz null,
  series_id uuid null references series(id),
  refunded_quarters integer null,
  forfeited_quarters integer null,
  cancelled_by_user_id uuid null references users(id),
  cancelled_by_name text null,
  cancellation_reason text null,
  checked_in_at timestamptz null,
  checked_in_by_user_id uuid null references users(id),
  checked_in_by_name text null,
  no_show_by_user_id uuid null references users(id),
  no_show_by_name text null,
  checked_out_at timestamptz null,
  checked_out_by_user_id uuid null references users(id),
  checked_out_by_name text null,
  late_quarter_hours integer null,
  pack_quarters_applied integer null,
  overage jsonb null,
  created_at timestamptz not null,
  unique (tenant_id, reference)
);
create index if not exists bookings_station_idx on bookings (station_id, start_at);
create index if not exists bookings_member_idx on bookings (member_id, created_at desc);
create index if not exists bookings_site_date_idx on bookings (site_id, booking_date);
create index if not exists bookings_hold_idx on bookings (status, hold_expires_at);

create table if not exists documents (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  member_id uuid not null references members(id),
  doc_type text not null,
  expiry_date date not null,
  status text not null,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null,
  sha256 text not null,
  rejection_reason text null,
  storage_key text not null,
  created_at timestamptz not null,
  reviewed_by_user_id uuid null references users(id),
  reviewed_at timestamptz null
);
create index if not exists documents_member_idx on documents (member_id, created_at desc);

create table if not exists visits (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  truck_id uuid not null references trucks(id),
  site_id uuid not null references sites(id),
  arrived_at timestamptz not null,
  departed_at timestamptz null,
  services text[] not null default '{}',
  operator_signature text not null default '',
  manager_user_id uuid null references users(id),
  manager_name text not null default '',
  created_at timestamptz not null
);
create unique index if not exists visits_one_open_per_truck on visits (truck_id) where departed_at is null;
create index if not exists visits_truck_idx on visits (truck_id, arrived_at desc);

create table if not exists inspector_links (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  truck_id uuid not null references trucks(id),
  site_id uuid not null references sites(id),
  inspector_email text not null,
  token text not null unique,
  storage_key text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null
);
create index if not exists inspector_links_truck_idx on inspector_links (truck_id, created_at desc);

create table if not exists rates (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  site_id uuid not null references sites(id),
  effective_from date not null,
  hourly_rate_cents integer not null,
  tax_rate_percent text not null,
  created_at timestamptz not null,
  unique (site_id, effective_from)
);

create table if not exists idempotency_records (
  id bigserial primary key,
  actor_user_id uuid not null references users(id),
  key text not null,
  method text not null,
  path text not null,
  binding text not null,
  state text not null,
  response_status integer null,
  response_body jsonb null,
  created_at timestamptz not null,
  unique (actor_user_id, key)
);

create table if not exists sessions (
  id uuid primary key,
  user_id uuid not null references users(id),
  session_value text not null unique,
  csrf_value text not null,
  created_at timestamptz not null,
  last_used_at timestamptz not null
);
create index if not exists sessions_user_idx on sessions (user_id, created_at);

create table if not exists sign_in_failures (
  id bigserial primary key,
  email_lower text not null,
  address text null,
  at timestamptz not null
);
create index if not exists sign_in_failures_email_idx on sign_in_failures (email_lower, at desc);
create index if not exists sign_in_failures_address_idx on sign_in_failures (address, at desc);

create table if not exists audit_events (
  id bigserial primary key,
  at timestamptz not null,
  scope_tenant_id uuid null references tenants(id),
  scope_site_id uuid null references sites(id),
  subject_user_id uuid null references users(id),
  actor_user_id uuid null references users(id),
  actor_name text null,
  actor_role text null,
  action text not null,
  target_type text null,
  target_id text null,
  outcome text not null,
  address_prefix text null
);
create index if not exists audit_events_scope_idx on audit_events (scope_tenant_id, id desc);

create table if not exists outbox (
  id bigserial primary key,
  dedupe_key text not null unique,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null,
  sent_at timestamptz null,
  attempts integer not null default 0
);
create index if not exists outbox_pending_idx on outbox (sent_at, id);

create table if not exists seed_state (
  id integer primary key,
  seed_set text null,
  seeded_at timestamptz not null
);
`;
