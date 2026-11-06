import { execute } from './pool.js';

const STATEMENTS: readonly string[] = [
  `create table if not exists provinces (
     code text primary key,
     shipping_cents integer not null,
     free_shipping_threshold_cents integer not null
   )`,
  `create table if not exists flavours (
     slug text primary key,
     can_price_cents integer not null,
     released integer
   )`,
  `create table if not exists stock_events (
     id bigserial primary key,
     flavour text not null,
     kind text not null check (kind in ('received','reserved','released','sold','returned')),
     quantity integer not null check (quantity > 0),
     created_at timestamptz not null default now()
   )`,
  `create index if not exists stock_events_flavour_idx on stock_events (flavour, kind)`,
  `create table if not exists carts (
     id uuid primary key,
     user_id text,
     province text not null,
     subscribe boolean not null default false,
     cadence text not null default 'monthly',
     hold_expires_at timestamptz,
     hold_expired boolean not null default false,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists cart_items (
     cart_id uuid not null references carts (id) on delete cascade,
     slot_index integer not null check (slot_index between 0 and 11),
     flavour text not null,
     primary key (cart_id, slot_index)
   )`,
  `create sequence if not exists order_number_seq start 100001`,
  `create table if not exists orders (
     number text primary key,
     user_id text not null,
     kind text not null check (kind in ('checkout','renewal')),
     status text not null,
     refund_status text not null default 'none',
     placed_at timestamptz not null default now(),
     paid_at timestamptz,
     province text not null,
     subscription_id text,
     killbill_account_id text not null,
     killbill_invoice_id text,
     goods_cents integer not null,
     discount_cents integer not null,
     discounted_goods_cents integer not null,
     shipping_cents integer not null,
     deposit_cents integer not null,
     total_cents integer not null,
     taxes jsonb not null,
     ship_to jsonb not null,
     customer_email text not null,
     customer_name text not null
   )`,
  `create index if not exists orders_user_idx on orders (user_id, placed_at desc)`,
  `create index if not exists orders_status_idx on orders (status, placed_at)`,
  `create table if not exists order_lines (
     order_number text not null references orders (number) on delete cascade,
     position integer not null,
     flavour text not null,
     quantity integer not null,
     unit_price_cents integer not null,
     goods_cents integer not null,
     discount_cents integer not null,
     deposit_cents integer not null,
     primary key (order_number, position)
   )`,
  `create table if not exists refunds (
     id uuid primary key,
     order_number text not null references orders (number) on delete cascade,
     status text not null,
     amount_cents integer not null,
     reason text not null,
     split jsonb not null,
     transaction_key text not null,
     created_at timestamptz not null default now(),
     claimed_at timestamptz
   )`,
  `create index if not exists refunds_order_idx on refunds (order_number, created_at)`,
  `create table if not exists attempt_keys (
     scope text not null,
     user_id text not null,
     key text not null,
     body_hash text not null,
     state text not null check (state in ('running','done')),
     response_status integer,
     response_body jsonb,
     created_at timestamptz not null default now(),
     primary key (scope, user_id, key)
   )`,
  `create table if not exists sessions (
     token text primary key,
     user_id text not null,
     email text not null,
     name text not null,
     role text not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists subscriptions (
     id text primary key,
     user_id text not null,
     killbill_account_id text not null,
     plan text not null,
     cadence text not null,
     province text not null,
     ship_to jsonb not null,
     customer_email text not null,
     customer_name text not null,
     card_brand text not null,
     card_last4 text not null,
     card_expiry_month integer not null,
     card_expiry_year integer not null,
     card_behaviour text not null check (card_behaviour in ('approve','decline','first_only')),
     card_charges integer not null default 0,
     shipments_held boolean not null default false,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists subscriptions_user_idx on subscriptions (user_id, created_at desc)`,
  `create table if not exists change_requests (
     id uuid primary key,
     subscription_id text not null references subscriptions (id) on delete cascade,
     kind text not null,
     cycles integer,
     plan text,
     status text not null,
     effective_date date,
     requested_at timestamptz not null default now(),
     settled_at timestamptz,
     claimed_at timestamptz
   )`,
  `create index if not exists change_requests_sub_idx on change_requests (subscription_id, requested_at desc)`,
  `create table if not exists renewal_cycles (
     invoice_id text primary key,
     subscription_id text not null references subscriptions (id) on delete cascade,
     order_number text,
     state text not null check (state in ('charging','paid','failed')),
     claimed_at timestamptz not null default now()
   )`,
  `create table if not exists dunning_runs (
     id uuid primary key,
     subscription_id text not null references subscriptions (id) on delete cascade,
     invoice_id text not null,
     failed_at timestamptz not null,
     outcome text,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists dunning_runs_open_idx on dunning_runs (subscription_id, outcome)`,
  `create table if not exists dunning_step_runs (
     run_id uuid not null references dunning_runs (id) on delete cascade,
     step text not null,
     ran_at timestamptz not null default now(),
     primary key (run_id, step)
   )`,
  `create table if not exists upcoming_renewal_notices (
     subscription_id text not null references subscriptions (id) on delete cascade,
     renewal_date date not null,
     primary key (subscription_id, renewal_date)
   )`,
  `create table if not exists outbox (
     id uuid primary key,
     dedupe_key text not null unique,
     to_email text not null,
     subject text not null,
     body text not null,
     queued_at timestamptz not null default now(),
     claimed_at timestamptz,
     sent_at timestamptz
   )`,
  `create index if not exists outbox_pending_idx on outbox (sent_at, claimed_at)`,
  `create table if not exists retailer_applications (
     id uuid primary key,
     business_name text not null,
     contact_name text not null,
     email text not null,
     province text not null,
     licence_extension text not null,
     licence_content_type text not null,
     status text not null,
     submitted_at timestamptz not null default now(),
     decided_at timestamptz
   )`,
];

/** Creates the schema on every start, without failing if it is already there. */
export async function createSchema(): Promise<void> {
  for (const statement of STATEMENTS) await execute(statement);
}
