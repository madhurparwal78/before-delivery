import { pool } from './pool.js';

const STATEMENTS: readonly string[] = [
  `create table if not exists accounts (
    id text primary key,
    name text not null,
    email text not null,
    email_lower text not null unique,
    password_hash text not null,
    role text not null,
    clinic_name text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists sessions (
    token text primary key,
    account_id text not null references accounts(id) on delete cascade,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists groups (
    id text primary key,
    buyer_id text not null references accounts(id),
    state text not null,
    kb_invoice_id text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists reservations (
    id text primary key,
    bench text not null,
    tier text not null,
    state text not null,
    group_id text references groups(id),
    buyer_id text not null references accounts(id),
    price_cents integer not null,
    hold_expires_at timestamptz,
    hold_duration_seconds integer,
    payment_in_flight text,
    payment_pending text,
    assignee_name text,
    assignee_email text,
    assignee_email_lower text,
    assignee_accepted boolean not null default false,
    attendee_account_id text references accounts(id),
    refund_due_cents integer,
    upgrade_from_bench text,
    assignment_seq integer not null default 0,
    cancelled_at timestamptz,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists reservations_bench_idx on reservations (bench)`,
  `create index if not exists reservations_state_idx on reservations (state)`,
  `create index if not exists reservations_buyer_idx on reservations (buyer_id)`,
  `create index if not exists reservations_attendee_idx on reservations (attendee_account_id)`,
  `create table if not exists waitlist_entries (
    id text primary key,
    account_id text not null references accounts(id),
    tier text not null,
    state text not null,
    created_at timestamptz not null default now(),
    seq bigserial
  )`,
  `create table if not exists offers (
    id text primary key,
    entry_id text not null references waitlist_entries(id),
    account_id text not null references accounts(id),
    bench text not null,
    tier text not null,
    state text not null,
    duration_seconds integer not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists offers_state_idx on offers (state)`,
  `create table if not exists payments (
    id text primary key,
    kind text not null,
    reservation_id text references reservations(id),
    group_id text references groups(id),
    external_key text not null unique,
    amount_cents integer not null,
    billing_name text not null default '',
    kb_payment_id text not null,
    kb_invoice_id text not null,
    created_at timestamptz not null default now(),
    seq bigserial
  )`,
  `create table if not exists payment_items (
    payment_id text not null references payments(id),
    reservation_id text not null references reservations(id),
    kb_invoice_item_id text not null,
    amount_cents integer not null,
    primary key (payment_id, reservation_id)
  )`,
  `create table if not exists refunds (
    id text primary key,
    reservation_id text not null references reservations(id),
    payment_id text not null references payments(id),
    n integer not null,
    external_key text not null unique,
    amount_cents integer not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists documents (
    id text primary key,
    reservation_id text references reservations(id),
    group_id text references groups(id),
    kind text not null,
    s3_key text not null,
    created_at timestamptz not null default now()
  )`,
  `create unique index if not exists documents_reservation_kind_idx
    on documents (reservation_id, kind) where reservation_id is not null`,
  `create unique index if not exists documents_group_kind_idx
    on documents (group_id, kind) where group_id is not null`,
  `create table if not exists licences (
    reservation_id text primary key references reservations(id),
    licence_number text not null,
    licence_state text not null,
    status text not null,
    s3_key text not null,
    content_type text not null,
    note text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists passports (
    reservation_id text primary key references reservations(id),
    full_name text not null,
    nationality text not null,
    passport_number text not null,
    s3_key text not null,
    content_type text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists checkins (
    reservation_id text not null references reservations(id),
    day integer not null,
    created_at timestamptz not null default now(),
    primary key (reservation_id, day)
  )`,
  `create table if not exists certificates (
    reservation_id text primary key references reservations(id),
    number integer not null unique,
    s3_key text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists mail_queue (
    id text primary key,
    dedupe_key text not null unique,
    to_email text not null,
    subject text not null,
    body text not null,
    state text not null default 'queued',
    attempts integer not null default 0,
    created_at timestamptz not null default now(),
    sent_at timestamptz
  )`,
  `create index if not exists mail_queue_state_idx on mail_queue (state)`,
  `create table if not exists balance_reminders (
    reservation_id text not null references reservations(id),
    kind text not null,
    created_at timestamptz not null default now(),
    primary key (reservation_id, kind)
  )`,
  `create table if not exists idempotency (
    account_id text not null references accounts(id),
    key text not null,
    endpoint text not null,
    body_hash text not null,
    status integer not null,
    response_json text not null,
    created_at timestamptz not null default now(),
    primary key (account_id, key)
  )`,
];

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const statement of STATEMENTS) {
      await client.query(statement);
    }
  } finally {
    client.release();
  }
}
