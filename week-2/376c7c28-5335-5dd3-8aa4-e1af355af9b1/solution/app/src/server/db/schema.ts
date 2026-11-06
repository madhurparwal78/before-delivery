import { lockKey, withClient } from './pool.ts';

const DDL = `
create table if not exists studios (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  time_zone text not null,
  pickup_window_days integer not null,
  storage_fee_cents integer not null
);

create table if not exists storage_fee_history (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  from_instant timestamptz not null,
  fee_cents integer not null
);
create index if not exists storage_fee_history_studio on storage_fee_history (studio_id, from_instant);

create table if not exists people (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  name text not null,
  handle text not null,
  email text not null,
  email_lower text not null,
  role text not null,
  membership text,
  card_status text not null,
  active boolean not null,
  password_hash text not null,
  created_at timestamptz not null,
  unique (studio_id, handle),
  unique (studio_id, email_lower)
);

create table if not exists sessions (
  id text primary key,
  studio_id uuid not null references studios(id),
  person_id uuid not null references people(id),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz
);
create index if not exists sessions_person on sessions (person_id);

create table if not exists signin_failures (
  id bigserial primary key,
  studio_slug text not null,
  email_lower text not null,
  at timestamptz not null
);
create index if not exists signin_failures_pair on signin_failures (studio_slug, email_lower, at);

create table if not exists invites (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  token text not null unique,
  email text not null,
  email_lower text not null,
  role text not null,
  membership text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  retired_at timestamptz
);
create index if not exists invites_pair on invites (studio_id, email_lower);

create table if not exists clay_bodies (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  name text not null,
  sort integer not null
);

create table if not exists kilns (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  name text not null,
  stack_height_eighths integer not null,
  shelf_area_tenths integer not null,
  sort integer not null
);

create table if not exists credit_packs (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  name text not null,
  amount_cents integer not null,
  sort integer not null
);

create table if not exists rate_schedules (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  effective_from date not null,
  member_bisque_cents integer not null,
  member_glaze_cents integer not null,
  dropoff_bisque_cents integer not null,
  dropoff_glaze_cents integer not null,
  created_at timestamptz not null,
  unique (studio_id, effective_from)
);

create table if not exists pieces (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  member_id uuid not null references people(id),
  title text not null,
  clay_body_id uuid not null references clay_bodies(id),
  length_hundredths integer not null,
  width_hundredths integer not null,
  height_hundredths integer not null,
  r_length_halves integer not null,
  r_width_halves integer not null,
  r_height_halves integer not null,
  cubic_eighths bigint not null,
  membership text not null,
  rates_effective_from date not null,
  bisque_rate_cents integer not null,
  bisque_fee_cents integer not null,
  glaze_rate_cents integer not null,
  glaze_fee_cents integer not null,
  quoted_at timestamptz not null,
  status text not null,
  waiting_since timestamptz,
  photo_key text,
  photo_seeded boolean not null default false,
  bisque_outcome text,
  glaze_outcome text,
  pickup_deadline date,
  left_ready_at timestamptz,
  created_at timestamptz not null
);
create index if not exists pieces_studio_status on pieces (studio_id, status);
create index if not exists pieces_member on pieces (member_id, created_at desc);

create table if not exists piece_history (
  id bigserial primary key,
  piece_id uuid not null references pieces(id),
  status text not null,
  at timestamptz not null
);
create index if not exists piece_history_piece on piece_history (piece_id, id);

create table if not exists loads (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  kiln_id uuid not null references kilns(id),
  firing text not null,
  status text not null,
  created_at timestamptz not null,
  unloaded_at timestamptz
);
create index if not exists loads_studio on loads (studio_id, created_at desc);

create table if not exists load_decks (
  load_id uuid not null references loads(id),
  number integer not null,
  primary key (load_id, number)
);

create table if not exists placements (
  load_id uuid not null references loads(id),
  piece_id uuid not null references pieces(id),
  deck integer not null,
  position integer not null,
  primary key (load_id, piece_id)
);
create index if not exists placements_piece on placements (piece_id);

create table if not exists piece_open_load (
  piece_id uuid primary key references pieces(id),
  load_id uuid not null references loads(id)
);

create table if not exists charges (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  piece_id uuid not null references pieces(id),
  member_id uuid not null references people(id),
  load_id uuid references loads(id),
  firing text not null,
  storage_day date,
  cubic_eighths bigint,
  rate_cents integer not null,
  fee_cents integer not null,
  status text not null,
  funding text,
  ordinal bigserial not null,
  created_at timestamptz not null,
  settled_at timestamptz,
  refunded_at timestamptz,
  refund_reason text,
  last_call_at timestamptz,
  refund_last_call_at timestamptz,
  claimed_until timestamptz,
  unique (piece_id, storage_day)
);
create index if not exists charges_pending on charges (status, created_at);
create index if not exists charges_studio on charges (studio_id, settled_at);
create index if not exists charges_member on charges (member_id, ordinal);

create table if not exists ledger_movements (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  member_id uuid not null references people(id),
  kind text not null,
  charge_id uuid references charges(id),
  ordinal bigserial not null,
  created_at timestamptz not null
);
create index if not exists ledger_movements_member on ledger_movements (member_id, ordinal);

create table if not exists ledger_entries (
  id uuid primary key,
  movement_id uuid not null references ledger_movements(id),
  studio_id uuid not null references studios(id),
  member_id uuid not null references people(id),
  account text not null,
  amount_cents integer not null,
  ordinal bigserial not null,
  created_at timestamptz not null
);
create index if not exists ledger_entries_member on ledger_entries (member_id, ordinal);

create table if not exists pack_purchases (
  id uuid primary key,
  studio_id uuid not null references studios(id),
  member_id uuid not null references people(id),
  pack_id uuid not null references credit_packs(id),
  amount_cents integer not null,
  idem_key text not null,
  status text not null,
  studio_day date not null,
  created_at timestamptz not null,
  completed_at timestamptz,
  last_call_at timestamptz,
  claimed_until timestamptz,
  unique (studio_id, idem_key)
);
create index if not exists pack_purchases_day on pack_purchases (member_id, studio_day, status);

create table if not exists idempotency_keys (
  studio_id uuid not null references studios(id),
  key text not null,
  body_hash text not null,
  status integer,
  response jsonb,
  state text not null,
  created_at timestamptz not null,
  primary key (studio_id, key)
);

create table if not exists storage_days (
  piece_id uuid not null references pieces(id),
  storage_day date not null,
  charge_id uuid references charges(id),
  created_at timestamptz not null,
  primary key (piece_id, storage_day)
);

create table if not exists reminders_sent (
  piece_id uuid primary key references pieces(id),
  sent_at timestamptz not null
);

create table if not exists closed_months (
  studio_id uuid not null references studios(id),
  month text not null,
  closed_at timestamptz not null,
  fees_cents integer not null,
  refunds_cents integer not null,
  net_cents integer not null,
  charge_count integer not null,
  statement_csv text not null,
  primary key (studio_id, month)
);

create table if not exists emails (
  id uuid primary key,
  studio_id uuid references studios(id),
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz
);
create index if not exists emails_unsent on emails (sent_at, created_at);

create table if not exists kb_accounts (
  member_id uuid primary key references people(id),
  account_id text not null,
  card_pm_id text,
  credit_pm_id text
);
`;

const SCHEMA_LOCK = lockKey('schema', 'kiln-desk');

export async function applySchema(): Promise<void> {
  await withClient(async (client) => {
    await client.query('select pg_advisory_lock($1)', [SCHEMA_LOCK.toString()]);
    try {
      await client.query(DDL);
    } finally {
      await client.query('select pg_advisory_unlock($1)', [SCHEMA_LOCK.toString()]);
    }
  });
}
