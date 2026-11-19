import type { Pool } from 'pg';

const SCHEMA_LOCK_KEY = 982341017;

const STATEMENTS = [
  `create table if not exists venues (
     id uuid primary key,
     slug text not null unique,
     name text not null,
     time_zone text not null,
     taker_fee_bps integer not null,
     maker_fee_bps integer not null,
     flagship_symbol text not null,
     created_at timestamptz not null default now()
   )`,

  `create table if not exists members (
     id uuid primary key,
     venue_id uuid references venues(id),
     keycloak_user_id text not null unique,
     username text not null,
     display_name text not null,
     email text not null,
     roles text[] not null,
     created_at timestamptz not null default now()
   )`,
  `create unique index if not exists members_venue_email on members (venue_id, lower(email))`,

  `create table if not exists member_balances (
     member_id uuid primary key references members(id),
     available_cents bigint not null default 0,
     held_cents bigint not null default 0,
     collateral_cents bigint not null default 0
   )`,

  `create table if not exists journal_entries (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     kind text not null,
     reference_id text,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists journal_legs (
     id uuid primary key,
     entry_id uuid not null references journal_entries(id),
     venue_id uuid not null references venues(id),
     account text not null,
     amount_cents bigint not null
   )`,
  `create index if not exists journal_legs_entry on journal_legs (entry_id)`,
  `create index if not exists journal_legs_account on journal_legs (venue_id, account)`,

  `create table if not exists invites (
     token text primary key,
     venue_id uuid not null references venues(id),
     member_id uuid not null references members(id),
     email text not null,
     created_at timestamptz not null default now(),
     expires_at timestamptz not null,
     accepted_at timestamptz
   )`,

  `create table if not exists markets (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     kind text not null,
     symbol text not null,
     title text not null,
     status text not null,
     closes_at timestamptz,
     outcome text,
     last_price integer,
     book_sequence bigint not null default 0,
     resolved_at timestamptz,
     settled_at timestamptz,
     created_at timestamptz not null default now()
   )`,
  `create unique index if not exists markets_venue_symbol on markets (venue_id, symbol)`,

  `create table if not exists orders (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     market_id uuid not null references markets(id),
     member_id uuid not null references members(id),
     mode text,
     side text not null,
     outcome text,
     price integer not null,
     quantity integer not null,
     filled_quantity integer not null default 0,
     status text not null,
     hold_cents bigint not null,
     reserved_units integer not null default 0,
     taker_fee_bps integer not null,
     maker_fee_bps integer not null,
     book_side text not null,
     book_price integer not null,
     sequence bigserial not null,
     created_at timestamptz not null default now(),
     ended_at timestamptz
   )`,
  `create index if not exists orders_book on orders (market_id, book_side, book_price, sequence)`,
  `create index if not exists orders_member on orders (member_id, created_at desc)`,

  `create table if not exists trades (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     market_id uuid not null references markets(id),
     price integer not null,
     quantity integer not null,
     at timestamptz not null default now()
   )`,
  `create index if not exists trades_market on trades (market_id, at desc)`,
  `create index if not exists trades_venue_at on trades (venue_id, at)`,

  `create table if not exists fills (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     market_id uuid not null references markets(id),
     order_id uuid not null references orders(id),
     member_id uuid not null references members(id),
     trade_id uuid not null references trades(id),
     mode text,
     side text not null,
     outcome text,
     price integer not null,
     quantity integer not null,
     notional_cents bigint not null,
     fee_cents bigint not null,
     liquidity text not null,
     filled_at timestamptz not null default clock_timestamp(),
     sequence bigserial not null
   )`,
  `create index if not exists fills_member on fills (member_id, filled_at desc)`,
  `create index if not exists fills_venue_at on fills (venue_id, filled_at)`,
  `create index if not exists fills_order on fills (order_id, filled_at)`,

  `create table if not exists spot_holdings (
     member_id uuid not null references members(id),
     market_id uuid not null references markets(id),
     quantity integer not null default 0,
     reserved integer not null default 0,
     primary key (member_id, market_id)
   )`,

  `create table if not exists margin_positions (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     member_id uuid not null references members(id),
     market_id uuid not null references markets(id),
     side text not null,
     quantity integer not null,
     cost_cents bigint not null,
     collateral_cents bigint not null,
     status text not null,
     created_at timestamptz not null default now(),
     ended_at timestamptz
   )`,
  `create unique index if not exists margin_positions_open on margin_positions (member_id, market_id) where status = 'open'`,

  `create table if not exists event_positions (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     member_id uuid not null references members(id),
     market_id uuid not null references markets(id),
     outcome text not null,
     quantity integer not null default 0
   )`,
  `create unique index if not exists event_positions_unique on event_positions (member_id, market_id, outcome)`,

  `create table if not exists settlement_payouts (
     market_id uuid not null references markets(id),
     position_id uuid not null,
     primary key (market_id, position_id)
   )`,

  `create table if not exists deposits (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     member_id uuid not null references members(id),
     amount_cents bigint not null,
     status text not null,
     card_last4 text not null,
     killbill_payment_id text,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists deposits_member on deposits (member_id, created_at desc)`,
  `create index if not exists deposits_venue on deposits (venue_id, created_at desc)`,

  `create table if not exists refunds (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     deposit_id uuid not null references deposits(id),
     amount_cents bigint not null,
     killbill_transaction_id text not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists refunds_deposit on refunds (deposit_id)`,

  `create table if not exists idempotency_records (
     member_id uuid not null references members(id),
     endpoint text not null,
     idempotency_key text not null,
     body_hash text not null,
     response_status integer,
     response_body json,
     created_at timestamptz not null default now(),
     primary key (member_id, endpoint, idempotency_key)
   )`,

  `create table if not exists api_keys (
     id uuid primary key,
     key_id text not null unique,
     venue_id uuid not null references venues(id),
     member_id uuid not null references members(id),
     name text not null,
     secret_hash text not null,
     created_at timestamptz not null default now(),
     revoked_at timestamptz
   )`,
  `create index if not exists api_keys_member on api_keys (member_id, created_at desc)`,

  `create table if not exists builder_billing (
     member_id uuid primary key references members(id),
     venue_id uuid not null references venues(id),
     plan text not null,
     state text not null,
     overdue_state text not null,
     pending_plan text,
     pending_effective_date date,
     subscription_id text,
     payment_failed_at timestamptz,
     final_notice_sent_at timestamptz,
     updated_at timestamptz not null default now()
   )`,

  `create table if not exists documents (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     member_id uuid not null references members(id),
     filename text not null,
     content_type text not null,
     size_bytes bigint not null,
     uploaded_at timestamptz not null default now()
   )`,

  `create table if not exists statements (
     id uuid primary key,
     venue_id uuid not null references venues(id),
     member_id uuid not null references members(id),
     month text not null,
     object_key text not null,
     created_at timestamptz not null default now()
   )`,
  `create unique index if not exists statements_unique on statements (venue_id, member_id, month)`,

  `create table if not exists statement_runs (
     venue_id uuid not null references venues(id),
     month text not null,
     started_at timestamptz not null default now(),
     primary key (venue_id, month)
   )`,

  `create table if not exists webhook_endpoints (
     member_id uuid primary key references members(id),
     venue_id uuid not null references venues(id),
     url text not null,
     svix_endpoint_id text not null,
     signing_secret text not null,
     created_at timestamptz not null default now()
   )`,

  `create table if not exists outgoing_messages (
     id bigserial primary key,
     kind text not null,
     dedupe_key text not null unique,
     payload jsonb not null,
     attempts integer not null default 0,
     next_attempt_at timestamptz not null default now(),
     delivered_at timestamptz,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists outgoing_pending on outgoing_messages (next_attempt_at) where delivered_at is null`,

  `create table if not exists sessions (
     id text primary key,
     member_id uuid not null references members(id),
     created_at timestamptz not null default now(),
     expires_at timestamptz not null
   )`,

  `create table if not exists auth_attempts (
     state text primary key,
     nonce text not null,
     code_verifier text not null,
     next_path text not null,
     created_at timestamptz not null default now(),
     used_at timestamptz
   )`,
];

export async function applySchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [SCHEMA_LOCK_KEY]);
    for (const statement of STATEMENTS) await client.query(statement);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY]);
    client.release();
  }
}
