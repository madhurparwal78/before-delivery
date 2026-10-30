export const SCHEMA_SQL = `
create table if not exists users (
  id text primary key,
  role text not null check (role in ('broker','beekeeper','grower')),
  person_name text not null,
  business_name text not null,
  contact_name text not null,
  email text not null unique,
  password_hash text not null
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists rule_sets (
  id text primary key,
  name text not null,
  effective_from date not null,
  threshold_reduced_tenths integer not null,
  threshold_standard_tenths integer not null,
  threshold_bonus_tenths integer not null,
  price_none_cents integer not null,
  price_reduced_cents integer not null,
  price_standard_cents integer not null,
  price_bonus_cents integer not null,
  commission_bps integer not null,
  deposit_per_hive_cents integer not null
);

create table if not exists orchards (
  id text primary key,
  grower_id text not null references users(id),
  name text not null,
  county text not null,
  position integer not null,
  created_at timestamptz not null default now()
);

create table if not exists blocks (
  id text primary key,
  orchard_id text not null references orchards(id),
  name text not null,
  acres_tenths integer not null,
  position integer not null,
  unique (orchard_id, name)
);

create table if not exists orders (
  id text primary key,
  ref text not null unique,
  orchard_id text not null references orchards(id),
  rule_set_id text not null references rule_sets(id),
  status text not null check (status in ('draft','open','filled','placed','inspected','settled','cancelled')),
  settlement_status text not null default 'none' check (settlement_status in ('none','queued','settled')),
  bloom_start date not null,
  bloom_end date not null,
  delivery_deadline date not null,
  created_at timestamptz not null default now()
);

create table if not exists order_blocks (
  order_id text not null references orders(id),
  block_id text not null references blocks(id),
  hives_ordered integer not null,
  position integer not null,
  primary key (order_id, block_id)
);

create table if not exists drops (
  id text primary key,
  order_id text not null references orders(id),
  beekeeper_id text not null references users(id),
  yard_name text not null,
  hives integer not null,
  status text not null check (status in ('committed','delivered','inspected','disputed','accepted')),
  block_id text references blocks(id),
  delivered_at timestamptz,
  delivered_on date,
  dispute_reason text,
  resolution_note text,
  created_at timestamptz not null default now()
);

create index if not exists drops_order_idx on drops (order_id);

create table if not exists samples (
  id text primary key,
  order_id text not null references orders(id),
  block_id text not null references blocks(id),
  drop_id text not null references drops(id),
  colony_label text not null,
  frames_tenths integer not null,
  created_at timestamptz not null default now(),
  unique (order_id, block_id, colony_label)
);

create index if not exists samples_order_idx on samples (order_id);

create table if not exists photos (
  id text primary key,
  sample_id text not null references samples(id) on delete cascade,
  order_id text not null references orders(id),
  object_key text not null,
  content_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists inspection_links (
  id text primary key,
  order_id text not null references orders(id),
  token_hash text not null unique,
  inspector_email text not null,
  status text not null check (status in ('issued','used','signed','expired')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  signed_at timestamptz,
  inspector_name text,
  report_key text
);

create table if not exists settlements (
  order_id text primary key references orders(id),
  status text not null check (status in ('queued','settled')),
  payment_received_on date not null,
  rule_set_id text not null references rule_sets(id),
  payable_cents integer not null,
  commission_bps integer not null,
  commission_cents integer not null,
  shares jsonb not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  next_attempt_at timestamptz not null default now()
);

create table if not exists idempotency_keys (
  scope text not null,
  key text not null,
  request_hash text not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);

create table if not exists email_outbox (
  id text primary key,
  dedupe_key text not null unique,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','sent')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  actor_id text,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create table if not exists file_links (
  token_hash text primary key,
  object_key text not null,
  content_type text not null,
  filename text not null,
  expires_at timestamptz not null
);

create table if not exists grower_accounts (
  grower_id text primary key references users(id),
  killbill_account_id text not null
);

create table if not exists order_billing (
  order_id text primary key references orders(id),
  deposit_invoice_id text,
  deposit_recorded_at timestamptz,
  balance_invoice_id text,
  balance_recorded_at timestamptz,
  payment_recorded_at timestamptz
);

create sequence if not exists order_ref_seq as bigint start with 1001;
`;
