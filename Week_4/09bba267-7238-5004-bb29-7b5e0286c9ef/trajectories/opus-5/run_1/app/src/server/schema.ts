export const SCHEMA_SQL = `
create table if not exists performances (
  id text primary key,
  title text not null,
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists tiers (
  performance_id text not null references performances(id),
  tier_id text not null,
  name text not null,
  face_cents integer not null,
  sort_order integer not null,
  primary key (performance_id, tier_id)
);

create table if not exists seats (
  performance_id text not null references performances(id),
  seat_id text not null,
  tier_id text,
  state text not null,
  hold_buyer_id text,
  hold_kind text,
  hold_expires_at timestamptz,
  offer_token text,
  pending_order_id text,
  primary key (performance_id, seat_id)
);
create index if not exists seats_tier_state_idx on seats (performance_id, tier_id, state);
create index if not exists seats_hold_expiry_idx on seats (hold_expires_at) where hold_expires_at is not null;

create table if not exists orders (
  id text primary key,
  performance_id text not null references performances(id),
  buyer_id text not null,
  name text not null,
  email text not null,
  status text not null,
  order_fee_cents integer not null,
  receipt text,
  killbill_account_id text,
  exchange_charges integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists orders_buyer_idx on orders (buyer_id, created_at desc);

create table if not exists tickets (
  id uuid primary key,
  order_id text not null references orders(id),
  performance_id text not null,
  seat_id text not null,
  tier_id text not null,
  tier_name text not null,
  face_cents integer not null,
  seat_fee_cents integer not null,
  status text not null,
  created_at timestamptz not null default now()
);
create index if not exists tickets_order_idx on tickets (order_id);
create index if not exists tickets_seat_idx on tickets (performance_id, seat_id);

create table if not exists payment_transactions (
  id bigserial primary key,
  order_id text not null references orders(id),
  kind text not null,
  payment_external_key text not null,
  killbill_payment_id text not null,
  amount_cents integer not null,
  created_at timestamptz not null default now()
);
create index if not exists payment_transactions_order_idx on payment_transactions (order_id, id);

create table if not exists waitlist_entries (
  id uuid primary key,
  performance_id text not null references performances(id),
  tier_id text not null,
  buyer_id text not null,
  name text not null,
  email text not null,
  email_lower text not null,
  status text not null,
  joined_at timestamptz not null default now(),
  seq bigserial
);
create index if not exists waitlist_queue_idx on waitlist_entries (performance_id, tier_id, status, joined_at, seq);
create index if not exists waitlist_buyer_idx on waitlist_entries (buyer_id, joined_at desc);

create table if not exists offers (
  token text primary key,
  entry_id uuid not null references waitlist_entries(id),
  performance_id text not null,
  tier_id text not null,
  seat_id text not null,
  status text not null,
  expires_at timestamptz not null,
  pending_order_id text,
  created_at timestamptz not null default now()
);
create index if not exists offers_open_idx on offers (status, expires_at);
create index if not exists offers_seat_idx on offers (performance_id, seat_id);

create table if not exists idempotency_records (
  scope text not null,
  key text not null,
  path text not null,
  body_hash text not null,
  state text not null,
  status integer,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);

create table if not exists outbox (
  id uuid primary key,
  recipient text not null,
  subject text not null,
  kind text not null,
  body text not null,
  status text not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  claimed_at timestamptz
);
create index if not exists outbox_queue_idx on outbox (status, created_at);

create table if not exists change_feed (
  id bigserial primary key,
  topic text not null,
  created_at timestamptz not null default now()
);

create table if not exists owner_sessions (
  token text primary key,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value text not null
);
`;
