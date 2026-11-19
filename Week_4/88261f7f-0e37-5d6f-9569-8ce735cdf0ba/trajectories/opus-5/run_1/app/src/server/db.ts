import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';
import { config } from './config';

const DATE_OID = 1082;
const INT8_OID = 20;
types.setTypeParser(DATE_OID, (value: string) => value);
types.setTypeParser(INT8_OID, (value: string) => Number.parseInt(value, 10));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow>(
  db: Db,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return db.query<T>(text, values);
}

export async function rows<T extends QueryResultRow>(
  db: Db,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await db.query<T>(text, values);
  return result.rows;
}

export async function one<T extends QueryResultRow>(
  db: Db,
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const result = await db.query<T>(text, values);
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function withTransaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists hotels (
  id text primary key,
  name text not null,
  time_zone text not null,
  business_date date not null,
  clock_now timestamptz,
  next_invoice_number bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  hotel_id text not null references hotels(id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  name text not null,
  role text not null
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists rooms (
  id text primary key,
  hotel_id text not null references hotels(id) on delete cascade,
  number text not null,
  type text not null,
  status text not null,
  sort_key text not null,
  unique (hotel_id, number)
);

create table if not exists rate_plans (
  id text primary key,
  hotel_id text not null references hotels(id) on delete cascade,
  name text not null,
  weeknight_cents integer not null,
  weekend_cents integer not null,
  ord integer not null
);

create table if not exists tax_rates (
  id text primary key,
  hotel_id text not null references hotels(id) on delete cascade,
  percent text not null,
  start_date date
);
create unique index if not exists tax_rates_start on tax_rates (hotel_id, start_date);
create unique index if not exists tax_rates_default on tax_rates (hotel_id) where start_date is null;

create table if not exists guests (
  id text primary key,
  hotel_id text not null references hotels(id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  company text not null default '',
  address text not null default '',
  merged_into text references guests(id)
);

create table if not exists stays (
  id text primary key,
  hotel_id text not null references hotels(id) on delete cascade,
  guest_id text not null references guests(id),
  rate_plan_id text not null references rate_plans(id),
  guests integer not null,
  arrival date not null,
  departure date not null,
  status text not null,
  version integer not null default 1,
  checked_in_online boolean not null default false,
  online_full_name text,
  online_phone text,
  checkin_link_state text not null default 'not_sent',
  check_in_night date,
  id_photo text not null default 'none',
  seq bigserial
);

create table if not exists stay_segments (
  id text primary key,
  stay_id text not null references stays(id) on delete cascade,
  room_id text not null references rooms(id),
  first_night date not null,
  nights integer not null
);
create index if not exists stay_segments_room on stay_segments (room_id, first_night);

create table if not exists stay_nights (
  stay_id text not null references stays(id) on delete cascade,
  date date not null,
  room_cents integer not null,
  posted boolean not null default false,
  posted_tax_cents integer,
  posted_city_tax_cents integer,
  primary key (stay_id, date)
);

create table if not exists folios (
  id text primary key,
  stay_id text not null references stays(id) on delete cascade,
  name text not null,
  payer_name text not null default '',
  payer_email text not null default '',
  state text not null default 'open',
  ord integer not null
);

create table if not exists entries (
  id text primary key,
  folio_id text not null references folios(id) on delete cascade,
  kind text not null,
  date date not null,
  description text not null,
  amount_cents integer not null,
  room_number text,
  reverses_entry_id text references entries(id),
  split_of_entry_id text references entries(id),
  seq bigserial
);
create index if not exists entries_folio on entries (folio_id, seq);

create table if not exists invoices (
  id text primary key,
  hotel_id text not null references hotels(id) on delete cascade,
  folio_id text not null unique references folios(id) on delete cascade,
  number text not null,
  state text not null,
  mail_state text not null,
  bill_to_name text not null,
  payer_email text not null,
  pdf_key text not null,
  unique (hotel_id, number)
);

create table if not exists closed_days (
  hotel_id text not null references hotels(id) on delete cascade,
  date date not null,
  rooms_available integer not null,
  rooms_sold integer not null,
  room_revenue_cents bigint not null,
  rooms_charged integer not null,
  no_shows integer not null,
  primary key (hotel_id, date)
);

create table if not exists close_rows (
  hotel_id text not null references hotels(id) on delete cascade,
  date date not null,
  room_id text not null references rooms(id) on delete cascade,
  room_number text not null,
  stay_id text not null references stays(id) on delete cascade,
  posted_cents integer not null,
  primary key (hotel_id, date, room_id)
);

create table if not exists idempotency (
  hotel_id text not null references hotels(id) on delete cascade,
  key text not null,
  body_hash text not null,
  status integer not null,
  response jsonb not null,
  primary key (hotel_id, key)
);

create table if not exists checkin_tokens (
  token text primary key,
  stay_id text not null references stays(id) on delete cascade,
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null
);
create index if not exists checkin_tokens_stay on checkin_tokens (stay_id);

create table if not exists app_flags (
  name text primary key,
  set_at timestamptz not null default now()
);
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(7718231);');
    await client.query(SCHEMA);
  } finally {
    await client.query('select pg_advisory_unlock(7718231);').catch(() => undefined);
    client.release();
  }
}
