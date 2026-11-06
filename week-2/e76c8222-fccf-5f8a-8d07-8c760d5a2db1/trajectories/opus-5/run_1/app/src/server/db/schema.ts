export const SCHEMA_SQL = `
create extension if not exists pgcrypto;

create table if not exists orgs (
  id text primary key,
  name text not null,
  killbill_account_id text
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null,
  org_id text references orgs(id)
);

create table if not exists sessions (
  token text primary key,
  user_id uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists credentials (
  id uuid primary key default gen_random_uuid(),
  interpreter_id uuid not null references users(id),
  type text not null,
  number text not null,
  expires_on date not null,
  scan_key text not null,
  scan_filename text not null,
  scan_content_type text not null,
  created_at timestamptz not null default now()
);
create index if not exists credentials_interpreter_idx on credentials (interpreter_id);

create table if not exists consumer_preferences (
  consumer_id uuid not null references users(id),
  interpreter_id uuid not null references users(id),
  kind text not null check (kind in ('preferred', 'blocked')),
  primary key (consumer_id, interpreter_id)
);

create sequence if not exists request_ref_seq start with 1001;

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  org_id text not null references orgs(id),
  title text not null,
  setting text not null,
  location text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  consumer_id uuid not null references users(id),
  notes text not null default '',
  status text not null,
  logged_after boolean not null default false,
  cancellation_fee_cents integer,
  cancellation_quote jsonb,
  cancellation_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists requests_org_idx on requests (org_id);
create index if not exists requests_start_idx on requests (start_at);

create table if not exists seats (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  position integer not null,
  status text not null default 'open',
  unique (request_id, position)
);

create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid not null references seats(id) on delete cascade,
  request_id uuid not null references requests(id) on delete cascade,
  interpreter_id uuid not null references users(id),
  held_by uuid not null references users(id),
  token text not null unique,
  status text not null default 'active',
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  answered_at timestamptz,
  outbox_id bigint
);
create unique index if not exists offers_single_live_per_seat
  on offers (seat_id) where status in ('active', 'accepted');
create index if not exists offers_interpreter_idx on offers (interpreter_id);

create table if not exists prep_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  org_id text not null references orgs(id),
  filename text not null,
  size integer not null,
  content_type text not null,
  object_key text not null,
  uploaded_at timestamptz not null default now()
);
create index if not exists prep_files_request_idx on prep_files (request_id);

create table if not exists timesheets (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid not null unique references seats(id) on delete cascade,
  request_id uuid not null references requests(id) on delete cascade,
  interpreter_id uuid not null references users(id),
  actual_start timestamptz not null,
  actual_end timestamptz not null,
  signature_name text not null,
  billed_quarters integer not null,
  status text not null default 'submitted',
  hourly_rate_cents integer,
  amount_cents integer,
  killbill_invoice_id text,
  pdf_key text,
  approved_by uuid references users(id),
  approved_at timestamptz,
  submitted_at timestamptz not null default now()
);

create table if not exists rates (
  setting text primary key,
  cents integer not null
);

create table if not exists outbox (
  id bigserial primary key,
  dedupe_key text not null unique,
  to_email text not null,
  to_name text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_pending_idx on outbox (status, id);

create table if not exists audit_entries (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid references users(id),
  action text not null,
  entity text not null,
  entity_id text not null,
  request_id uuid,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists audit_request_idx on audit_entries (request_id, id);

create table if not exists idempotency_records (
  user_id uuid not null,
  action text not null,
  target_id text not null,
  key text not null,
  body_hash text not null,
  state text not null,
  status_code integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, action, target_id, key)
);

create table if not exists app_meta (
  key text primary key,
  value jsonb not null
);
`;
