import { pool, withAdvisoryLock } from './pool.ts';

const SCHEMA_LOCK = 0x484f_5552;

const STATEMENTS: readonly string[] = [
  `create table if not exists workspaces (
     id text primary key,
     name text not null unique
   )`,

  `create table if not exists members (
     id text primary key,
     workspace_id text not null references workspaces(id),
     name text not null,
     email text not null,
     role text not null,
     stockist_id text,
     password_hash text,
     created_at_ms bigint not null,
     removed_at_ms bigint
   )`,
  `create unique index if not exists members_email_live on members(lower(email)) where removed_at_ms is null`,

  `create table if not exists sessions (
     id text primary key,
     token_hash text not null unique,
     member_id text not null references members(id) on delete cascade,
     created_at_ms bigint not null,
     expires_at_ms bigint not null
   )`,

  `create table if not exists auth_links (
     id text primary key,
     kind text not null,
     token_hash text not null unique,
     workspace_id text references workspaces(id),
     member_id text references members(id) on delete cascade,
     email text,
     role text,
     stockist_id text,
     issued_at_ms bigint not null,
     expires_at_ms bigint not null,
     used_at_ms bigint
   )`,

  `create table if not exists drops (
     id text primary key,
     workspace_id text not null references workspaces(id),
     slug text not null unique,
     name text not null,
     type text not null,
     status text not null,
     hold_seconds integer not null,
     palette text[] not null,
     internal_note text not null default '',
     go_live_at_ms bigint,
     copenhagen_go_live text,
     local_go_live text,
     created_at_ms bigint not null,
     withdrawn_at_ms bigint,
     withdraw_reason text
   )`,

  `create table if not exists drop_markets (
     drop_id text not null references drops(id) on delete cascade,
     market text not null,
     go_live_at_ms bigint,
     store_pieces integer not null default 0,
     opened_at_ms bigint,
     primary key (drop_id, market)
   )`,

  `create table if not exists drop_styles (
     drop_id text not null references drops(id) on delete cascade,
     style_number text not null,
     name text not null,
     colour text not null,
     wholesale_edition integer not null,
     rrp_dkk_minor bigint not null,
     position integer not null,
     primary key (drop_id, style_number)
   )`,

  `create table if not exists looks (
     id text primary key,
     drop_id text not null references drops(id) on delete cascade,
     position integer not null,
     title text not null,
     alt_text text not null,
     width integer not null,
     height integer not null,
     content_type text not null,
     size_bytes integer not null,
     object_key text not null,
     created_at_ms bigint not null
   )`,
  `create table if not exists look_orders (
     drop_id text primary key references drops(id) on delete cascade,
     order_version integer not null default 1,
     saved_by text not null default '',
     saved_at_ms bigint not null
   )`,

  `create table if not exists stories (
     drop_id text primary key references drops(id) on delete cascade,
     html text not null default '',
     version integer not null default 1,
     saved_by text not null default '',
     saved_at_ms bigint not null,
     published_html text,
     published_at_ms bigint
   )`,

  `create table if not exists waitlist_members (
     id text primary key,
     drop_id text not null references drops(id) on delete cascade,
     market text not null,
     name text not null,
     email text not null,
     status text not null,
     joined_at_ms bigint not null,
     position integer not null,
     confirmed_at_ms bigint,
     offered_at_ms bigint
   )`,
  `create unique index if not exists waitlist_unique on waitlist_members(drop_id, market, lower(email))`,

  `create table if not exists opt_in_links (
     id text primary key,
     waitlist_member_id text not null references waitlist_members(id) on delete cascade,
     token text not null unique,
     issued_at_ms bigint not null,
     expires_at_ms bigint not null,
     used_at_ms bigint
   )`,

  `create table if not exists holds (
     id text primary key,
     drop_id text not null references drops(id) on delete cascade,
     market text not null,
     waitlist_member_id text references waitlist_members(id) on delete cascade,
     token text not null unique,
     offered_at_ms bigint not null,
     expires_at_ms bigint not null,
     status text not null,
     passed_on_at_ms bigint
   )`,
  `create unique index if not exists holds_once_per_member on holds(drop_id, waitlist_member_id)`,
  `create index if not exists holds_live on holds(drop_id, market, status)`,

  `create table if not exists claims (
     id text primary key,
     drop_id text not null references drops(id) on delete cascade,
     market text not null,
     reference text not null unique,
     name text not null,
     email text not null,
     claimed_at_ms bigint not null,
     hold_id text references holds(id)
   )`,
  `create unique index if not exists claims_once_per_address on claims(drop_id, market, lower(email))`,

  `create table if not exists idempotency_records (
     scope text not null,
     key text not null,
     body_fingerprint text not null,
     status integer not null,
     response jsonb not null,
     created_at_ms bigint not null,
     primary key (scope, key)
   )`,

  `create table if not exists rate_events (
     id bigserial primary key,
     bucket text not null,
     client_key text not null,
     at_ms bigint not null
   )`,
  `create index if not exists rate_events_lookup on rate_events(bucket, client_key, at_ms)`,

  `create table if not exists stockists (
     id text primary key,
     workspace_id text not null references workspaces(id),
     name text not null,
     sort_key text not null,
     market text not null,
     currency text not null,
     contact_name text,
     contact_email text,
     contact_phone text,
     contact_erased boolean not null default false,
     notes text not null default '',
     status text not null default 'active',
     archived_at_ms bigint,
     created_at_ms bigint not null
   )`,
  `create index if not exists stockists_order on stockists(workspace_id, sort_key, id)`,

  `create table if not exists allocations (
     id text primary key,
     workspace_id text not null references workspaces(id),
     drop_id text not null references drops(id) on delete cascade,
     stockist_id text not null references stockists(id),
     status text not null,
     version integer not null default 1,
     requested_at_ms bigint not null,
     internal_note text not null default '',
     saved_by text not null default '',
     saved_at_ms bigint not null,
     confirmed_at_ms bigint,
     price_list_effective_date text,
     invoice_number text,
     killbill_invoice_id text,
     total_minor bigint
   )`,
  `create unique index if not exists allocations_one_per_pair on allocations(drop_id, stockist_id)`,

  `create table if not exists allocation_lines (
     allocation_id text not null references allocations(id) on delete cascade,
     style_number text not null,
     position integer not null,
     requested_quantity integer not null default 0,
     allocated_quantity integer not null default 0,
     unit_price_minor bigint,
     net_minor bigint,
     vat_minor bigint,
     line_total_minor bigint,
     primary key (allocation_id, style_number)
   )`,

  `create table if not exists price_lists (
     id text primary key,
     workspace_id text not null references workspaces(id),
     name text not null,
     effective_date text not null,
     created_at_ms bigint not null
   )`,
  `create table if not exists price_list_prices (
     price_list_id text not null references price_lists(id) on delete cascade,
     style_number text not null,
     currency text not null,
     unit_price_minor bigint not null,
     primary key (price_list_id, style_number, currency)
   )`,

  `create table if not exists previews (
     id text primary key,
     workspace_id text not null references workspaces(id),
     drop_id text not null references drops(id) on delete cascade,
     editor_name text not null,
     editor_email text not null,
     outlet text not null,
     token text not null unique,
     issued_at_ms bigint not null,
     expires_at_ms bigint not null,
     revoked_at_ms bigint,
     replaced_at_ms bigint
   )`,

  `create table if not exists restock_series (
     id text primary key,
     drop_id text not null references drops(id) on delete cascade,
     first_restock text not null,
     weekday text not null,
     copenhagen_time text not null,
     pieces jsonb not null,
     created_at_ms bigint not null
   )`,
  `create table if not exists restock_runs (
     series_id text not null references restock_series(id) on delete cascade,
     occurrence_ms bigint not null,
     ran_at_ms bigint not null,
     primary key (series_id, occurrence_ms)
   )`,

  `create table if not exists outbox (
     id text primary key,
     kind text not null,
     dedupe_key text unique,
     payload jsonb not null,
     run_at_ms bigint not null,
     sent_at_ms bigint,
     attempts integer not null default 0,
     created_at_ms bigint not null
   )`,
  `create index if not exists outbox_pending on outbox(sent_at_ms, run_at_ms)`,

  `create table if not exists seed_steps (
     step text primary key,
     done_at_ms bigint not null
   )`,
];

export async function applySchema(): Promise<void> {
  await withAdvisoryLock(SCHEMA_LOCK, async () => {
    for (const statement of STATEMENTS) {
      await pool.query(statement);
    }
  });
}
