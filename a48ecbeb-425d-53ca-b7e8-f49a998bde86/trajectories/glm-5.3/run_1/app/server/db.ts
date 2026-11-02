import pg from 'pg';
import { env } from './env.js';

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 4000,
});

pool.on('error', () => {
  // Pool-level errors surface through queries; keep the process alive and retry there.
});

export type DbClient = pg.PoolClient;

const DDL = `
create table if not exists flavours (
  slug text primary key,
  name text not null,
  can_price_cents integer not null,
  limited boolean not null default false,
  subscribable boolean not null default true,
  received integer not null default 0,
  released integer
);
alter table flavours alter column limited set default false;

create table if not exists provinces (
  code text primary key,
  name text not null,
  shipping_cents integer not null,
  free_shipping_threshold_cents integer not null,
  deposit_cents_per_can integer not null
);

create table if not exists province_taxes (
  code text not null references provinces(code),
  name text not null,
  rate_milli integer not null,
  sort integer not null,
  primary key (code, name)
);

create table if not exists stock_ledger (
  id bigserial primary key,
  flavour text not null references flavours(slug),
  kind text not null,
  qty integer not null,
  at timestamptz not null default now(),
  hold_id uuid,
  order_number text
);

create table if not exists sessions (
  token text primary key,
  user_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists carts (
  id uuid primary key,
  user_id text,
  province text not null default 'ON',
  subscribe boolean not null default false,
  cadence text not null default 'monthly',
  created_at timestamptz not null default now()
);

create table if not exists cart_slots (
  cart_id uuid not null references carts(id) on delete cascade,
  slot integer not null,
  flavour text,
  primary key (cart_id, slot),
  check (slot between 0 and 11)
);

create table if not exists holds (
  id uuid primary key,
  cart_id uuid not null references carts(id) on delete cascade,
  expires_at timestamptz not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists order_numbers (
  dummy boolean primary key default true,
  last_number integer not null default 100000
);

create table if not exists orders (
  number text primary key,
  user_id text not null,
  status text not null default 'pending_payment',
  refund_status text not null default 'none',
  placed_at timestamptz not null default now(),
  province text not null,
  subscription_id text,
  lines jsonb not null,
  goods_cents integer not null,
  discount_cents integer not null,
  discounted_goods_cents integer not null,
  shipping_cents integer not null,
  deposit_cents integer not null,
  taxes jsonb not null,
  total_cents integer not null,
  refunded_cents integer not null default 0,
  ship_to jsonb not null,
  card jsonb,
  kb_account_id text,
  kb_invoice_id text,
  email text not null
);

create table if not exists refunds (
  id uuid primary key,
  order_number text not null references orders(number),
  status text not null default 'pending_provider',
  amount_cents integer not null,
  reason text not null,
  split jsonb not null,
  kb_refund_txn_id text,
  created_at timestamptz not null default now()
);

create table if not exists idempotency_keys (
  kind text not null,
  key text not null,
  user_id text not null,
  request_hash text not null,
  status text not null default 'running',
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (kind, key)
);

create table if not exists subscriptions (
  id text primary key,
  user_id text not null,
  kb_account_id text not null,
  plan text not null,
  plan_label text not null,
  cadence text not null,
  address jsonb not null,
  card jsonb not null,
  next_cycle date,
  created_at timestamptz not null default now()
);
alter table subscriptions add column if not exists next_cycle date;

create table if not exists change_requests (
  id uuid primary key,
  subscription_id text not null references subscriptions(id),
  kind text not null,
  status text not null default 'pending_provider',
  effective_date date not null,
  requested_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists dunning_steps (
  subscription_id text not null references subscriptions(id),
  step text not null,
  due_at timestamptz not null,
  status text not null default 'pending',
  invoice_id text,
  primary key (subscription_id, step)
);

create table if not exists sub_cycles (
  subscription_id text not null references subscriptions(id),
  cycle_date date not null,
  state text not null default 'pending',
  invoice_id text,
  order_number text,
  trigger_done boolean not null default false,
  primary key (subscription_id, cycle_date)
);

create table if not exists upcoming_emails (
  subscription_id text not null references subscriptions(id),
  cycle_date date not null,
  sent boolean not null default false,
  primary key (subscription_id, cycle_date)
);

create table if not exists applications (
  id uuid primary key,
  business_name text not null,
  contact_name text not null,
  email text not null,
  province text not null,
  status text not null default 'submitted',
  submitted_at timestamptz not null default now(),
  licence_object text not null,
  licence_type text not null
);

create table if not exists email_outbox (
  id bigserial primary key,
  to_address text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists job_locks (
  name text primary key,
  locked_until timestamptz
);

create table if not exists schema_version (
  dummy boolean primary key default true,
  version integer not null
);
insert into schema_version (dummy, version) values (true, 1) on conflict (dummy) do nothing;
`;

export async function initSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(DDL);
  } finally {
    client.release();
  }
}

export async function withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function tx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {
      // Connection already broken; nothing to roll back.
    }
    throw e;
  } finally {
    client.release();
  }
}
