import { randomBytes } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { config } from './config.js';
import { REFERENCE_ALPHABET } from '../domain/text.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, values);
  return result.rows as T[];
}

export async function one<T extends Row = Row>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const answer = await work(client);
    await client.query('commit');
    return answer;
  } catch (trouble) {
    await client.query('rollback');
    throw trouble;
  } finally {
    client.release();
  }
}

export function makeId(prefix: string): string {
  let body = '';
  const bytes = randomBytes(8);
  for (const byte of bytes) body += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `${prefix}-${body}`;
}

export function makeToken(): string {
  return randomBytes(24).toString('base64url');
}

const SCHEMA = `
create table if not exists desks (
  id text primary key,
  name text not null,
  email text not null,
  email_folded text not null unique,
  password_hash text not null,
  created_at bigint not null
);

create table if not exists sessions (
  id text primary key,
  desk_id text not null,
  created_at bigint not null,
  expires_at bigint not null,
  ended_at bigint
);

create table if not exists customers (
  desk_id text not null,
  id text not null,
  name text not null,
  email text not null,
  email_folded text not null,
  telephone text not null,
  telephone_folded text not null,
  language text not null,
  notes text not null default '',
  state text not null default 'active',
  closed_at bigint,
  erase_at bigint,
  erased boolean not null default false,
  removed boolean not null default false,
  created_at bigint not null,
  primary key (desk_id, id)
);

create table if not exists rate_tables (
  desk_id text not null,
  id text not null,
  effective_from text not null,
  default_margin_tenths int not null,
  waiting_rate int not null,
  second_driver_charge int not null,
  deposit_minibus int not null,
  deposit_minibus_higher int not null,
  deposit_coach int not null,
  deposit_coach_higher int not null,
  primary key (desk_id, id),
  unique (desk_id, effective_from)
);

create table if not exists operators (
  desk_id text not null,
  id text not null,
  name text not null,
  town text not null,
  email text not null,
  telephone text not null,
  sizes jsonb not null,
  listed boolean not null default true,
  dbs_checked_on text,
  primary key (desk_id, id)
);

create table if not exists papers (
  desk_id text not null,
  id text not null,
  operator_id text not null,
  kind text not null,
  ends_on text not null,
  stored boolean not null default false,
  object_key text,
  content_type text,
  expiry_mailed boolean not null default false,
  primary key (desk_id, id),
  unique (desk_id, operator_id, kind)
);

create table if not exists enquiries (
  desk_id text not null,
  id text not null,
  customer_id text not null,
  occasion text not null,
  state text not null,
  journey_type text not null,
  depart_date text not null,
  depart_time text not null,
  depart_repeated text,
  depart_instant bigint not null,
  return_date text,
  return_time text,
  return_repeated text,
  return_instant bigint,
  people int not null,
  large int not null default 0,
  medium int not null default 0,
  hand int not null default 0,
  wheelchairs int not null default 0,
  details text,
  language text not null,
  submitted_body text,
  merged_into text,
  created_at bigint not null,
  seq bigserial,
  primary key (desk_id, id)
);

create table if not exists stops (
  desk_id text not null,
  id text not null,
  enquiry_id text not null,
  position int not null,
  text text not null,
  checked boolean not null default true,
  primary key (desk_id, id)
);

create table if not exists trips (
  desk_id text not null,
  enquiry_id text not null,
  legs jsonb,
  plan_sizes jsonb,
  plan_out_of_date boolean not null default false,
  routed boolean not null default false,
  primary key (desk_id, enquiry_id)
);

create table if not exists hires (
  desk_id text not null,
  id text not null,
  stage text not null,
  quote_version int not null default 1,
  rate_table_id text,
  awarded_operator_id text,
  awarded_at bigint,
  cancelled_at bigint,
  reminder_sent boolean not null default false,
  primary key (desk_id, id)
);

create table if not exists quote_pages (
  desk_id text not null,
  id text not null,
  hire_id text not null,
  token text not null unique,
  version int not null,
  sent_at bigint not null,
  valid_until text not null,
  ends_at bigint not null,
  accepted_at bigint,
  deposit_said_sent boolean not null default false,
  mailed boolean not null default false,
  replaced boolean not null default false,
  primary key (desk_id, id)
);

create table if not exists vehicles (
  desk_id text not null,
  id text not null,
  hire_id text not null,
  position int not null,
  seats int not null,
  operator_id text,
  bought_price int not null default 0,
  margin_tenths int not null default 150,
  deposit int,
  extra_charges int not null default 0,
  primary key (desk_id, id)
);

create table if not exists runs (
  desk_id text not null,
  id text not null,
  hire_id text not null,
  vehicle_id text not null,
  number int not null,
  seats int not null,
  driver_name text,
  driver_telephone text,
  driver_folded text,
  told_at bigint,
  confirmed boolean not null default false,
  sheet_token text not null unique,
  depart_date text not null,
  depart_time text not null,
  depart_instant bigint not null,
  second_driver boolean not null default false,
  blocks jsonb,
  blocks_start_date text,
  blocks_start_time text,
  primary key (desk_id, id)
);

create table if not exists run_stops (
  desk_id text not null,
  id text not null,
  run_id text not null,
  position int not null,
  text text not null,
  flight_code text,
  flight_checked_at bigint,
  flight_actual bigint,
  flight_ok boolean,
  primary key (desk_id, id)
);

create table if not exists presses (
  desk_id text not null,
  id text not null,
  run_id text not null,
  stop_id text not null,
  kind text not null,
  at bigint not null,
  repeat_key text not null,
  primary key (desk_id, id),
  unique (desk_id, run_id, repeat_key)
);

create table if not exists charges (
  desk_id text not null,
  id text not null,
  run_id text not null,
  stop_id text,
  vehicle_id text not null,
  kind text not null,
  minutes int not null,
  amount int not null,
  accepted boolean not null default false,
  primary key (desk_id, id)
);

create table if not exists bids (
  desk_id text not null,
  id text not null,
  enquiry_id text not null,
  operator_id text not null,
  token text not null unique,
  sent_at bigint not null,
  closes_at bigint not null,
  prices jsonb,
  received_at bigint,
  withdrawn boolean not null default false,
  closing_mailed boolean not null default false,
  primary key (desk_id, id),
  unique (desk_id, enquiry_id, operator_id)
);

create table if not exists ledger_lines (
  desk_id text not null,
  id bigserial,
  hire_id text not null,
  movement_id text not null,
  account text not null,
  amount int not null,
  at bigint not null,
  vehicle_id text,
  description text not null default '',
  primary key (desk_id, id)
);

create table if not exists statement_rows (
  desk_id text not null,
  id text not null,
  row_key text not null,
  date text not null,
  description text not null,
  amount int not null,
  balance int not null,
  reference text,
  hire_id text,
  at bigint not null,
  primary key (desk_id, id)
);

create table if not exists statement_previews (
  desk_id text not null,
  id text not null,
  payload jsonb not null,
  created_at bigint not null,
  brought_in boolean not null default false,
  primary key (desk_id, id)
);

create table if not exists allocations (
  desk_id text not null,
  id text not null,
  hire_id text not null,
  vehicle_id text,
  kind text not null,
  amount int not null,
  at bigint not null,
  primary key (desk_id, id)
);

create table if not exists passenger_lists (
  desk_id text not null,
  id text not null,
  hire_id text not null,
  object_key text not null,
  primary key (desk_id, id)
);

create table if not exists passengers (
  desk_id text not null,
  id text not null,
  hire_id text not null,
  name text not null,
  group_name text not null default '',
  needs text not null default '',
  position int not null,
  primary key (desk_id, id)
);

create table if not exists seat_places (
  desk_id text not null,
  hire_id text not null,
  vehicle_id text not null,
  seat text not null,
  passenger_id text not null,
  primary key (desk_id, vehicle_id, seat)
);

create table if not exists documents (
  desk_id text not null,
  id text not null,
  hire_id text not null,
  kind text not null,
  state text not null,
  number text,
  object_key text,
  customer_name text not null,
  created_at bigint not null,
  history jsonb not null default '[]'::jsonb,
  primary key (desk_id, id)
);

create table if not exists doc_numbers (
  desk_id text not null,
  year int not null,
  kind text not null,
  last int not null,
  primary key (desk_id, year, kind)
);

create table if not exists complaints (
  desk_id text not null,
  id text not null,
  customer_id text not null,
  summary text not null,
  received_date text not null,
  received_time text not null,
  reply_due text not null,
  holiday_line text,
  created_at bigint not null,
  primary key (desk_id, id)
);

create table if not exists lost_property (
  desk_id text not null,
  id text not null,
  description text not null,
  found_on text not null,
  held_to text not null,
  state text not null,
  owner_details text,
  charge int,
  created_at bigint not null,
  primary key (desk_id, id)
);

create table if not exists hire_changes (
  desk_id text not null,
  id text not null,
  hire_id text not null,
  old_body jsonb not null,
  new_body jsonb not null,
  price_moved boolean not null,
  lines jsonb not null,
  created_at bigint not null,
  primary key (desk_id, id)
);

create table if not exists cancellations (
  desk_id text not null,
  id text not null,
  hire_id text not null,
  notice_date text not null,
  notice_time text not null,
  notice_instant bigint not null,
  by_whom text not null,
  lines jsonb not null,
  created_at bigint not null,
  primary key (desk_id, id)
);

create table if not exists holiday_cache (
  desk_id text primary key,
  fetched_at bigint,
  events jsonb,
  ever_good boolean not null default false
);

create table if not exists enquiry_rate (
  id bigserial primary key,
  email_folded text not null,
  at bigint not null
);

create table if not exists file_downloads (
  id bigserial primary key,
  desk_id text not null,
  at bigint not null
);

create table if not exists review_list (
  desk_id text not null,
  id text not null,
  row int not null,
  message text not null,
  created_at bigint not null,
  primary key (desk_id, id)
);

create table if not exists sheet_imports (
  desk_id text not null,
  hash text not null,
  primary key (desk_id, hash)
);

create table if not exists daily_marks (
  desk_id text not null,
  kind text not null,
  key text not null,
  primary key (desk_id, kind, key)
);

create table if not exists counters (
  desk_id text not null,
  kind text not null,
  value int not null,
  primary key (desk_id, kind)
);

create index if not exists enquiries_desk_order on enquiries (desk_id, created_at desc, id);
create index if not exists ledger_desk_hire on ledger_lines (desk_id, hire_id);
create index if not exists runs_desk_depart on runs (desk_id, depart_instant);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

export async function nextCounter(client: PoolClient, deskId: string, kind: string): Promise<number> {
  const result = await client.query(
    `insert into counters (desk_id, kind, value) values ($1, $2, 1)
     on conflict (desk_id, kind) do update set value = counters.value + 1
     returning value`,
    [deskId, kind],
  );
  return Number(result.rows[0].value);
}
