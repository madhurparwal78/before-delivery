/** Postgres: the source of truth for every domain rule. */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = Pool | PoolClient;

export async function query<R extends QueryResultRow>(
  db: Db,
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> {
  const result = await db.query<R>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<R extends QueryResultRow>(
  db: Db,
  text: string,
  values: readonly unknown[] = [],
): Promise<R | null> {
  const rows = await query<R>(db, text, values);
  return rows.length > 0 ? rows[0] : null;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises two transactions that both need an exclusive claim, by name. */
export async function advisoryLock(client: PoolClient, name: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [name]);
}

const SCHEMA = `
create table if not exists accounts (
  id uuid primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null,
  created_at timestamptz not null
);

create table if not exists sessions (
  token text primary key,
  account_id uuid not null references accounts(id),
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists floor_bands (
  id text primary key,
  low_floor integer not null,
  high_floor integer not null,
  released boolean not null
);

create table if not exists units (
  code text primary key,
  floor integer not null,
  stack text not null,
  band text not null references floor_bands(id),
  bedrooms integer not null,
  area_m2 integer not null,
  bearing integer not null,
  facing text not null,
  view_tag text not null,
  price bigint not null,
  price_version integer not null,
  status text not null,
  view_photographed boolean not null default false,
  view_photo_key text,
  view_photo_size bigint,
  view_photo_checksum text,
  seed_photo_key text,
  upload_in_progress boolean not null default false
);

create index if not exists units_status on units (status);
create index if not exists units_band on units (band);

create table if not exists price_versions (
  unit_code text not null references units(code),
  version integer not null,
  price bigint not null,
  set_by uuid not null references accounts(id),
  set_at timestamptz not null,
  primary key (unit_code, version)
);

create table if not exists holds (
  id uuid primary key,
  unit_code text not null references units(code),
  account_id uuid not null references accounts(id),
  status text not null,
  ended_by text,
  quoted_price bigint not null,
  price_version integer not null,
  created_at timestamptz not null,
  ends_at timestamptz not null,
  ended_at timestamptz,
  share_token text
);

create unique index if not exists holds_one_active_per_unit on holds (unit_code) where status = 'active';
create unique index if not exists holds_one_active_per_account on holds (account_id) where status = 'active';
create unique index if not exists holds_share_token on holds (share_token) where share_token is not null;
create index if not exists holds_account on holds (account_id);
create index if not exists holds_active_ends_at on holds (ends_at) where status = 'active';

create table if not exists hold_attempts (
  id bigserial primary key,
  account_id uuid not null,
  attempted_at timestamptz not null
);

create index if not exists hold_attempts_account on hold_attempts (account_id, attempted_at);

create table if not exists idempotency_keys (
  account_id uuid not null,
  key text not null,
  unit_code text,
  price_version bigint,
  response_status integer,
  response_body text,
  created_at timestamptz not null,
  primary key (account_id, key)
);

create table if not exists search_rate_hits (
  id bigserial primary key,
  client_address text not null,
  hit_at timestamptz not null
);

create index if not exists search_rate_hits_client on search_rate_hits (client_address, hit_at);

create table if not exists pending_index_updates (
  id bigserial primary key,
  unit_code text not null,
  operation text not null,
  queued_at timestamptz not null,
  task_uid bigint,
  confirmed boolean not null default false
);

create index if not exists pending_index_open on pending_index_updates (unit_code) where not confirmed;
`;

let schemaReady = false;

export function isSchemaReady(): boolean {
  return schemaReady;
}

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['highwater-schema']);
    await client.query(SCHEMA);
    await client.query('COMMIT');
    schemaReady = true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
