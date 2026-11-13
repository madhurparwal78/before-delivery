import { Pool, type PoolClient } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = Pick<PoolClient, 'query'>;

const SCHEMA = `
create table if not exists workspaces (
  id text primary key,
  name text not null,
  product_assembly_id text
);

create table if not exists members (
  id text primary key,
  workspace_id text not null references workspaces(id),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null,
  units text not null,
  precision integer not null
);

create table if not exists sessions (
  token text primary key,
  member_id text not null references members(id),
  created_at timestamptz not null default now()
);

create table if not exists materials (
  id text primary key,
  workspace_id text not null references workspaces(id),
  name text not null,
  density_g_cm3 double precision not null
);

create table if not exists parts (
  id text primary key,
  workspace_id text not null references workspaces(id),
  name text not null,
  material_id text not null references materials(id),
  revision integer not null default 1,
  saved_by text not null references members(id),
  body_status text not null,
  body_build integer,
  next_build integer not null default 1,
  next_sketch_seq integer not null default 1,
  next_feature_seq integer not null default 1,
  confirmed jsonb,
  ord bigserial
);

create table if not exists sketches (
  id text primary key,
  part_id text not null references parts(id),
  name text not null,
  plane text not null,
  offset_mm double precision not null,
  revision integer not null default 1,
  saved_by text not null references members(id),
  ord bigserial
);

create table if not exists sketch_entities (
  id text primary key,
  sketch_id text not null references sketches(id),
  label text not null,
  geometry jsonb not null,
  ord bigserial
);

create table if not exists sketch_constraints (
  id text primary key,
  sketch_id text not null references sketches(id),
  label text not null,
  kind text not null,
  refs jsonb not null,
  value_mm double precision,
  tolerance jsonb,
  fix_at jsonb,
  ord bigserial
);

create table if not exists label_counters (
  sketch_id text not null references sketches(id),
  kind text not null,
  next integer not null,
  primary key (sketch_id, kind)
);

create table if not exists features (
  id text primary key,
  part_id text not null references parts(id),
  name text not null,
  sketch_id text not null references sketches(id),
  operation text not null,
  depth_mm double precision not null,
  direction text not null,
  ord bigserial
);

create table if not exists assemblies (
  id text primary key,
  workspace_id text not null references workspaces(id),
  name text not null,
  revision integer not null default 1,
  saved_by text not null references members(id),
  ord bigserial
);

create table if not exists instances (
  id text primary key,
  assembly_id text not null references assemblies(id),
  component_type text not null,
  component_id text not null,
  quantity integer not null,
  ord bigserial
);

create table if not exists purchased_parts (
  id text primary key,
  workspace_id text not null references workspaces(id),
  name text not null,
  declared_mass_g double precision not null,
  revision integer not null default 1,
  saved_by text not null references members(id),
  ord bigserial
);

create table if not exists idempotency_records (
  member_id text not null references members(id),
  path text not null,
  key text not null,
  request_hash text not null,
  status integer not null,
  response jsonb not null,
  primary key (member_id, path, key)
);
`;

const SEED_LOCK_KEY = 7312441;

export async function withTransaction<T>(run: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Applies the schema under the boot lock, so concurrent boots cannot race on DDL. */
export async function applySchema(): Promise<void> {
  await withSeedLock(async (db) => {
    await db.query(SCHEMA);
  });
}

/** Runs `create` under an advisory lock so concurrent boots seed exactly once. */
export async function withSeedLock<T>(create: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [SEED_LOCK_KEY]);
    await client.query('begin');
    try {
      const result = await create(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [SEED_LOCK_KEY]);
    client.release();
  }
}
