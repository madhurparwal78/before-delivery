export const SCHEMA_SQL = `
create extension if not exists pgcrypto;

create table if not exists orgs (
  code text primary key,
  name text not null,
  killbill_account_id text
);

create table if not exists languages (
  code text primary key,
  name text not null,
  seed_order integer not null
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null,
  org_code text references orgs(code),
  phone text not null default '',
  initials text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists interpreter_languages (
  user_id uuid not null references users(id) on delete cascade,
  language_code text not null references languages(code),
  primary key (user_id, language_code)
);

create table if not exists sessions (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create sequence if not exists assignment_number_seq start with 1001 increment by 1;

create table if not exists assignments (
  id bigserial primary key,
  number text not null unique,
  org_code text not null references orgs(code),
  scheduler_id uuid not null references users(id),
  language_code text not null references languages(code),
  setting text not null,
  start_at timestamptz not null,
  duration_minutes integer not null,
  street_address text not null,
  city text not null,
  patient_initials text not null,
  medical_notes text not null default '',
  status text not null,
  seat_count integer not null,
  offer_round integer not null default 0,
  coverage_round integer not null default 0,
  change_round integer not null default 0,
  cancelled_at timestamptz,
  cancel_fee_applies boolean,
  cancel_business_minutes integer,
  cancel_fee_cents bigint,
  billing_status text not null default 'none',
  invoice_id text,
  total_cents bigint,
  created_at timestamptz not null default now()
);

create index if not exists assignments_start_at_idx on assignments (start_at);
create index if not exists assignments_org_idx on assignments (org_code);

create table if not exists seats (
  assignment_id bigint not null references assignments(id) on delete cascade,
  seat integer not null,
  status text not null,
  holder_id uuid references users(id),
  primary key (assignment_id, seat)
);

create index if not exists seats_holder_idx on seats (holder_id);

create table if not exists seat_holds (
  id bigserial primary key,
  assignment_id bigint not null references assignments(id) on delete cascade,
  seat integer not null,
  interpreter_id uuid not null references users(id),
  claimed_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text
);

create table if not exists verifications (
  assignment_id bigint not null references assignments(id) on delete cascade,
  seat integer not null,
  interpreter_id uuid not null references users(id),
  actual_minutes integer not null,
  round_trip_miles integer not null,
  object_key text not null,
  content_type text not null,
  byte_size bigint not null,
  created_at timestamptz not null default now(),
  primary key (assignment_id, seat)
);

create table if not exists idempotency_keys (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  fingerprint text not null,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists rate_cards (
  id bigserial primary key,
  org_code text not null references orgs(code),
  service_line text not null,
  effective_from date not null,
  hourly_rate_cents bigint not null,
  mileage_cents_per_mile bigint not null,
  created_at timestamptz not null default now(),
  unique (org_code, service_line, effective_from)
);

create table if not exists email_outbox (
  id bigserial primary key,
  event_key text not null unique,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists file_tokens (
  token text primary key,
  session_token text not null,
  object_key text not null,
  content_type text not null,
  expires_at timestamptz not null
);

create table if not exists audit_log (
  id bigserial primary key,
  recorded_at timestamptz not null default now(),
  actor_id uuid references users(id),
  kind text not null,
  assignment_id bigint references assignments(id) on delete cascade,
  detail jsonb not null
);
`;
