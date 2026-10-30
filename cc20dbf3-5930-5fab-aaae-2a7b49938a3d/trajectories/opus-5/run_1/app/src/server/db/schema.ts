import type { Database } from './pool.js';

const STATEMENTS = [
  `create table if not exists app_secret (
     name text primary key,
     value text not null
   )`,
  `create table if not exists library (
     id int primary key,
     name text not null,
     time_zone text not null,
     open_days text[] not null,
     opening_time text not null,
     closing_time text not null,
     max_active_per_member int not null
   )`,
  `create table if not exists closure_date (closed_on text primary key)`,
  `create table if not exists late_fee_schedule (
     effective_from text primary key,
     cents_per_day int not null
   )`,
  `create table if not exists person (
     id text primary key,
     name text not null,
     role text not null,
     email text not null unique,
     phone text not null,
     password_hash text not null,
     killbill_account_id text
   )`,
  `create table if not exists item (
     id text primary key,
     name text not null,
     category text not null,
     deposit_cents int not null,
     replacement_cents int not null,
     seed_order int not null
   )`,
  `create table if not exists unit (
     id text primary key,
     item_id text not null references item(id),
     label text not null,
     lane_index int not null,
     unique (item_id, lane_index)
   )`,
  `create table if not exists web_session (
     id text primary key,
     person_id text not null references person(id),
     created_at timestamptz not null default now()
   )`,
  `create table if not exists hold (
     id uuid primary key,
     item_id text not null references item(id),
     unit_id text not null references unit(id),
     member_id text not null references person(id),
     status text not null,
     start_date text not null,
     end_date text not null,
     ready_at timestamptz,
     pickup_deadline timestamptz,
     created_at timestamptz not null,
     lapse_queued boolean not null default false
   )`,
  `create index if not exists hold_item_idx on hold (item_id, status)`,
  `create index if not exists hold_member_idx on hold (member_id, status)`,
  `create index if not exists hold_page_idx on hold (created_at desc, id desc)`,
  `create table if not exists loan (
     id uuid primary key,
     item_id text not null references item(id),
     unit_id text not null references unit(id),
     member_id text not null references person(id),
     hold_id uuid references hold(id),
     status text not null,
     checked_out_at timestamptz not null,
     due_date text not null,
     due_at timestamptz not null,
     renewed_at timestamptz,
     returned_at timestamptz,
     on_time boolean,
     late_days int,
     deposit_cents int not null,
     replacement_cents int not null,
     inspection_outcome text,
     inspection_note text,
     inspected_at timestamptz,
     settled_at timestamptz
   )`,
  `create unique index if not exists loan_hold_idx on loan (hold_id) where hold_id is not null`,
  `create index if not exists loan_item_idx on loan (item_id, status)`,
  `create index if not exists loan_member_idx on loan (member_id, status)`,
  `create index if not exists loan_page_idx on loan (checked_out_at desc, id desc)`,
  `create table if not exists settlement (
     loan_id uuid primary key references loan(id),
     deposit_cents int not null,
     released_cents int not null,
     damage_cents int not null,
     damage_from_deposit_cents int not null,
     extra_damage_cents int not null,
     late_days int not null,
     late_fee_cents int not null,
     total_charged_cents int not null,
     settled_at timestamptz not null
   )`,
  `create table if not exists settlement_fix (
     loan_id uuid primary key references loan(id),
     damage_cents int not null
   )`,
  `create table if not exists photo (
     id uuid primary key,
     loan_id uuid not null references loan(id),
     stage text not null,
     content_type text not null,
     size_bytes int not null,
     extension text not null,
     seq int not null,
     created_at timestamptz not null,
     unique (loan_id, stage, seq)
   )`,
  `create table if not exists ledger_entry (
     id uuid primary key,
     seq bigserial,
     loan_id uuid not null references loan(id),
     item_id text not null references item(id),
     kind text not null,
     amount_cents int not null,
     created_at timestamptz not null,
     unique (loan_id, kind)
   )`,
  `create index if not exists ledger_seq_idx on ledger_entry (seq)`,
  `create table if not exists idempotency_key (
     person_id text not null references person(id),
     key text not null,
     request_hash text not null,
     state text not null,
     response_status int,
     response_body text,
     started_at timestamptz not null,
     primary key (person_id, key)
   )`,
  `create table if not exists email_message (
     id uuid primary key,
     dedupe_key text not null unique,
     to_address text not null,
     subject text not null,
     body text not null,
     created_at timestamptz not null,
     sent_at timestamptz,
     attempts int not null default 0,
     next_attempt_at timestamptz not null
   )`,
  `create index if not exists email_pending_idx on email_message (next_attempt_at) where sent_at is null`,
];

export async function createSchema(pool: Database): Promise<void> {
  for (const statement of STATEMENTS) {
    await pool.query(statement);
  }
}
