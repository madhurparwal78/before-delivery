import { randomBytes } from 'node:crypto';
import { Pool, QueryResultRow, types } from 'pg';
import { config } from './config';

const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export function newId(): string {
  return randomBytes(12).toString('base64url');
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

const SCHEMA = `
create table if not exists app_state (
  key text primary key,
  value text not null
);

create table if not exists staff (
  id text primary key,
  name text not null,
  email text not null,
  password_hash text not null,
  role text not null,
  removed_at timestamptz
);
create unique index if not exists staff_email_live on staff (lower(email)) where removed_at is null;

create table if not exists members (
  id text primary key,
  name text,
  email text,
  password_hash text,
  date_of_birth date,
  sex text,
  state text not null,
  time_zone text not null,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  postal_code text,
  gate_notes text,
  account_state text not null default 'active',
  closing_at timestamptz,
  erases_at timestamptz,
  killbill_account_id text,
  created_at timestamptz not null default now(),
  seq bigserial
);
create unique index if not exists members_email_live on members (lower(email)) where email is not null;

create table if not exists memberships (
  member_id text primary key references members (id) on delete cascade,
  state text not null default 'free',
  cadence text,
  renewal_date date,
  plus_until date,
  pending_cadence text,
  pending_from date,
  subscription_id text,
  cancelled_before_closure boolean not null default false
);

create table if not exists sessions (
  id text primary key,
  person_kind text not null,
  person_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);

create table if not exists phlebotomists (
  id text primary key,
  name text not null,
  email text not null,
  states text[] not null,
  seq int not null
);

create table if not exists draws (
  id text primary key,
  member_id text not null references members (id) on delete cascade,
  phlebotomist_id text not null references phlebotomists (id),
  state text not null,
  starts_at timestamptz not null,
  local_date date not null,
  local_time text not null,
  time_zone text not null,
  collected_at timestamptz,
  booked_by_kind text not null default 'staff',
  booked_by_name text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists draws_one_per_slot
  on draws (phlebotomist_id, starts_at) where state <> 'cancelled';
create index if not exists draws_member on draws (member_id);

create table if not exists draw_kit_codes (
  draw_id text not null references draws (id) on delete cascade,
  kit_code text not null,
  added_at timestamptz not null default now(),
  primary key (draw_id, kit_code)
);

create table if not exists visit_pages (
  id text primary key,
  draw_id text not null references draws (id) on delete cascade,
  token text not null unique,
  sent_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz
);
create index if not exists visit_pages_draw on visit_pages (draw_id);

create table if not exists results (
  id text primary key,
  draw_id text not null references draws (id) on delete cascade,
  marker text not null,
  value text not null,
  note text,
  corrected_by text,
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (draw_id, marker)
);

create table if not exists result_history (
  id text primary key,
  result_id text not null references results (id) on delete cascade,
  value text not null,
  note text,
  by_name text not null,
  at timestamptz not null default now()
);

create table if not exists reports (
  draw_id text primary key references draws (id) on delete cascade,
  object_key text not null,
  byte_size int not null,
  digest text not null,
  stored_at timestamptz not null default now()
);

create table if not exists range_changes (
  id text primary key,
  marker text not null,
  effective_from date not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (marker, effective_from)
);

create table if not exists range_rows (
  change_id text not null references range_changes (id) on delete cascade,
  sex text not null,
  age_band text not null,
  low text not null,
  high text not null,
  optimal_low text not null,
  optimal_high text not null,
  primary key (change_id, sex, age_band)
);

create table if not exists blends (
  id text primary key,
  member_id text not null references members (id) on delete cascade,
  items jsonb not null,
  morning_capsules int not null,
  evening_capsules int not null,
  list_price_cents int not null,
  member_price_cents int not null,
  saved_by text not null,
  saved_at timestamptz not null default now()
);

create table if not exists plans (
  id text primary key,
  member_id text not null references members (id) on delete cascade,
  state text not null,
  based_on_plan_id text,
  nutrition text not null,
  movement text not null,
  sleep text not null,
  supplements text not null,
  published_at timestamptz,
  published_by text,
  blend_id text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  id text primary key,
  member_id text not null references members (id) on delete cascade,
  kind text not null,
  byte_size int not null,
  original_key text not null,
  clean_key text,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key,
  member_id text not null references members (id) on delete cascade,
  from_role text not null,
  from_name text not null,
  body text not null,
  attachment_id text references attachments (id) on delete set null,
  sent_at timestamptz not null default now()
);

create table if not exists threads (
  member_id text primary key references members (id) on delete cascade,
  state text not null default 'open',
  last_message_at timestamptz
);

create table if not exists receipts (
  id text primary key,
  member_id text not null references members (id) on delete cascade,
  number_seq int not null,
  invoice_id text not null unique,
  paid_at timestamptz not null,
  paid_date date not null,
  amount_cents int not null,
  currency text not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists request_keys (
  member_id text not null,
  key text not null,
  body_digest text not null,
  status int not null,
  response text not null,
  created_at timestamptz not null default now(),
  primary key (member_id, key)
);

create table if not exists rate_events (
  id text primary key,
  member_id text not null,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists rate_events_lookup on rate_events (member_id, kind, at);

create table if not exists pending_mail (
  id text primary key,
  member_id text references members (id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0
);

create table if not exists counters (
  name text primary key,
  value int not null
);
`;

export async function migrate(): Promise<void> {
  await pool.query("select pg_advisory_lock(hashtext('ocotillo-schema'))");
  try {
    await pool.query(SCHEMA);
  } finally {
    await pool.query("select pg_advisory_unlock(hashtext('ocotillo-schema'))");
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function nextCounter(name: string): Promise<number> {
  const result = await pool.query<{ value: number }>(
    `insert into counters (name, value) values ($1, 1)
     on conflict (name) do update set value = counters.value + 1
     returning value`,
    [name],
  );
  return (result.rows[0] as { value: number }).value;
}
