import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

pool.on('error', () => {
  /* a broken idle connection is dropped and replaced by the pool */
});

const SCHEMA = `
create table if not exists users (
  id uuid primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists signup_codes (
  email text primary key,
  code text not null,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists projects (
  id uuid primary key,
  name text not null,
  owner_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);
create table if not exists memberships (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  primary key (project_id, user_id)
);
create table if not exists invitations (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  role text not null,
  state text not null,
  inviter_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists collections (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  sequence bigint not null default 0,
  validator text,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);
create table if not exists documents (
  collection_id uuid not null references collections(id) on delete cascade,
  doc_id text not null,
  body text not null,
  version integer not null,
  primary key (collection_id, doc_id)
);
create table if not exists collection_indexes (
  id uuid primary key,
  collection_id uuid not null references collections(id) on delete cascade,
  name text not null,
  keys text not null,
  unique_index boolean not null,
  created_at timestamptz not null default now(),
  unique (collection_id, name)
);
create table if not exists index_entries (
  index_id uuid not null references collection_indexes(id) on delete cascade,
  doc_id text not null,
  key_text text not null
);
create unique index if not exists index_entries_unique_key on index_entries (index_id, key_text);
create index if not exists index_entries_by_doc on index_entries (index_id, doc_id);
create table if not exists changes (
  collection_id uuid not null references collections(id) on delete cascade,
  seq bigint not null,
  op text not null,
  doc_id text not null,
  body text,
  version integer,
  created_at timestamptz not null default now(),
  primary key (collection_id, seq)
);
create table if not exists pipeline_drafts (
  collection_id uuid not null references collections(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  stages text not null,
  disabled text not null,
  updated_at timestamptz not null default now(),
  primary key (collection_id, user_id)
);
create table if not exists saved_queries (
  id uuid primary key,
  collection_id uuid not null references collections(id) on delete cascade,
  name text not null,
  filter text not null,
  projection text,
  sort text,
  limit_value integer not null,
  last_run_at timestamptz,
  last_count integer,
  unique (collection_id, name)
);
create table if not exists imports (
  id uuid primary key,
  collection_id uuid not null references collections(id) on delete cascade,
  file_name text not null,
  format text not null,
  state text not null,
  bytes integer not null,
  inserted integer not null default 0,
  errors text not null default '[]',
  created_at timestamptz not null default now()
);
create table if not exists exports (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  collection_id uuid not null references collections(id) on delete cascade,
  format text not null,
  file_name text not null,
  object_key text not null,
  created_at timestamptz not null default now()
);
`;

let databaseReady = false;

export function isDatabaseReady(): boolean {
  return databaseReady;
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
  databaseReady = true;
}

export async function query<R extends QueryResultRow>(text: string, values: unknown[] = []): Promise<R[]> {
  const result = await pool.query<R>(text, values);
  return result.rows;
}

export async function queryOne<R extends QueryResultRow>(text: string, values: unknown[] = []): Promise<R | null> {
  const rows = await query<R>(text, values);
  return rows.length > 0 ? rows[0] : null;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
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
