import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

let ready = false;

export function dbReady(): boolean {
  return ready;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as never[]);
  return result.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists settings (
  key text primary key,
  value jsonb not null
);
create table if not exists users (
  username text primary key,
  password text not null,
  role text not null
);
create table if not exists manages (
  username text not null,
  property text not null,
  primary key (username, property)
);
create table if not exists sessions (
  id text primary key,
  username text not null,
  lang text,
  cur text,
  created_at timestamptz not null default now()
);
create table if not exists visitors (
  id text primary key,
  lang text,
  cur text,
  created_at timestamptz not null default now()
);
create table if not exists destinations (
  code text primary key,
  name text not null,
  zone text not null,
  cx double precision not null,
  cy double precision not null,
  vat_pct integer not null,
  city_minor integer not null,
  levy_pct integer not null,
  policy jsonb not null
);
create table if not exists properties (
  code text primary key,
  name text not null,
  destination text not null references destinations(code),
  x double precision not null,
  y double precision not null,
  stars integer not null,
  amenities text[] not null,
  zone text not null,
  vat_pct integer not null,
  city_minor integer not null,
  levy_pct integer not null,
  breakfast_minor integer not null,
  single_pct integer not null,
  policy jsonb not null
);
create table if not exists room_types (
  code text primary key,
  property text not null references properties(code),
  name text not null,
  included_adults integer not null,
  max_adults integer not null,
  max_guests integer not null,
  extra_adult_minor integer not null,
  child_minor integer not null,
  rooms integer not null,
  base_rate_minor integer not null
);
create table if not exists nights (
  room_type text not null references room_types(code),
  date date not null,
  base_rate_minor integer not null,
  allotment integer not null,
  min_stay integer not null,
  max_stay integer not null,
  closed_to_arrival boolean not null default false,
  closed_to_departure boolean not null default false,
  stop_sell boolean not null default false,
  release_days integer not null default 0,
  primary key (room_type, date)
);
create table if not exists seasons (
  id bigserial primary key,
  property text not null,
  name text not null,
  room_types text[] not null,
  from_date date not null,
  to_date date not null,
  weekdays integer[] not null
);
create table if not exists quotes (
  id text primary key,
  visitor text,
  username text,
  property text not null,
  in_date date not null,
  out_date date not null,
  currency text not null,
  tier text not null,
  rates jsonb not null,
  data jsonb not null,
  total_minor integer not null,
  expires_at timestamptz not null,
  hold_id text,
  stale boolean not null default false,
  notified boolean not null default false,
  party jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists holds (
  id text primary key,
  quote_id text not null,
  visitor text,
  username text,
  property text not null,
  expires_at timestamptz not null,
  state text not null
);
create table if not exists claims (
  id bigserial primary key,
  kind text not null,
  hold_id text,
  code text,
  room_n integer,
  room_type text not null,
  date date not null,
  active boolean not null default true
);
create index if not exists claims_lookup on claims (room_type, date) where active;
create table if not exists bookings (
  code text primary key,
  version integer not null default 1,
  visitor text,
  username text,
  property text not null,
  in_date date not null,
  out_date date not null,
  given_name text not null,
  surname text not null,
  card_last4 text not null,
  currency text not null,
  rates jsonb not null,
  tier text not null,
  created_at timestamptz not null default now()
);
create table if not exists booking_rooms (
  code text not null references bookings(code),
  n integer not null,
  room_type text not null,
  plan text not null,
  breakfast boolean not null,
  adults integer not null,
  ages integer[] not null,
  state text not null,
  nights jsonb not null,
  total_minor integer not null,
  paid_minor integer not null default 0,
  refunded_minor integer not null default 0,
  completed_at timestamptz,
  cancelled_at timestamptz,
  primary key (code, n)
);
create table if not exists booking_access (
  code text not null,
  visitor text not null,
  primary key (code, visitor)
);
create table if not exists ledger (
  id bigserial primary key,
  code text not null references bookings(code),
  pair integer not null,
  kind text not null,
  account text not null,
  debit_minor integer not null,
  credit_minor integer not null,
  at timestamptz not null
);
create table if not exists idempotency (
  key text primary key,
  owner text not null,
  body_hash text not null,
  status integer not null,
  response jsonb not null,
  at timestamptz not null
);
create table if not exists reviews (
  id bigserial primary key,
  property text not null,
  code text,
  username text,
  visitor text,
  token text not null unique,
  scores integer[],
  comment text,
  state text not null,
  created_at timestamptz,
  submitted_at timestamptz
);
create table if not exists inbox (
  id bigserial primary key,
  username text,
  visitor text,
  kind text not null,
  property text not null,
  link text not null,
  at timestamptz not null
);
create table if not exists invoices (
  code text primary key,
  ledger_version integer not null
);
`;

export async function connectAndMigrate(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      await pool.query(SCHEMA);
      ready = true;
      return;
    } catch (err) {
      ready = false;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
