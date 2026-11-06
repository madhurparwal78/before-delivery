import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function one<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export const SCHEMA_SQL = `
create table if not exists households (
  id text primary key,
  name text not null,
  zone text not null,
  notice_address text not null
);

create table if not exists rooms (
  id text primary key,
  name text not null,
  plan_order integer not null unique
);

create table if not exists scenes (
  id text primary key,
  name text not null,
  tint text not null,
  brightness integer not null,
  setpoint_f integer,
  catalogue_order integer not null
);
create unique index if not exists scenes_name_unique on scenes (lower(name));

create table if not exists devices (
  id text primary key,
  name text not null,
  room_id text not null references rooms (id),
  kind text not null,
  online boolean not null,
  state jsonb not null,
  revision integer not null,
  updated_at timestamptz not null,
  device_order integer not null
);

create table if not exists schedules (
  id text primary key,
  name text not null,
  days text[] not null,
  revision integer not null
);

create table if not exists schedule_versions (
  id text primary key,
  schedule_id text not null references schedules (id),
  from_date date not null,
  seeded boolean not null default false,
  unique (schedule_id, from_date)
);

create table if not exists schedule_slots (
  id text primary key,
  version_id text not null references schedule_versions (id) on delete cascade,
  slot_time text not null,
  scene_id text not null references scenes (id),
  room_ids text[] not null,
  ordinal integer not null
);

create table if not exists guest_scenes (
  id text primary key,
  room_id text not null references rooms (id),
  scene_id text not null references scenes (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  state text not null,
  ended_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null
);

create table if not exists idempotency_keys (
  key text primary key,
  body_hash text not null,
  response_status integer not null,
  response_body text not null,
  created_at timestamptz not null
);

create table if not exists runs (
  id text primary key,
  schedule_id text not null references schedules (id),
  version_from date not null,
  slot_id text not null,
  slot_time text not null,
  ran_at timestamptz not null,
  day date not null,
  scene_id text not null references scenes (id),
  room_ids text[] not null,
  unique (schedule_id, version_from, slot_id, day)
);

create table if not exists clips (
  id text primary key,
  camera_id text not null references devices (id),
  recorded_at timestamptz not null,
  day date not null,
  declared_size bigint not null,
  stored_size bigint,
  state text not null,
  object_key text not null
);

create table if not exists notices (
  id text primary key,
  kind text not null,
  subject text not null,
  body text not null,
  to_address text not null,
  state text not null,
  attempts integer not null default 0,
  created_at timestamptz not null,
  sent_at timestamptz,
  schedule_id text,
  from_date date,
  sequence bigserial
);
create unique index if not exists notices_schedule_change_unique
  on notices (schedule_id, from_date) where kind = 'schedule_change';

create table if not exists room_owners (
  room_id text primary key references rooms (id),
  scene_id text references scenes (id),
  source text not null,
  since timestamptz,
  guest_scene_id text
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
