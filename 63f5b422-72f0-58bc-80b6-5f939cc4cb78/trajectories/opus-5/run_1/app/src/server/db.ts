import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type Row = pg.QueryResultRow;

export async function query<T extends Row = Row>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as unknown[]);
  return result.rows;
}

export async function one<T extends Row = Row>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

export async function withTransaction<T>(
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
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

const SCHEMA = `
create table if not exists users (
  id text primary key,
  email text unique not null,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists workspaces (
  id text primary key,
  name text not null,
  slug text unique not null,
  doc jsonb not null,
  seq bigint not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null,
  primary key (workspace_id, user_id)
);
create table if not exists invitations (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null,
  token text unique not null,
  status text not null,
  inviter_id text not null,
  created_at timestamptz not null default now()
);
create table if not exists operations (
  workspace_id text not null references workspaces(id) on delete cascade,
  seq bigint not null,
  op_id text,
  kind text not null,
  author_id text not null,
  at timestamptz not null default now(),
  body jsonb not null,
  ids jsonb not null default '[]'::jsonb,
  created jsonb,
  effects jsonb,
  keys jsonb not null default '{}'::jsonb,
  target bigint,
  primary key (workspace_id, seq)
);
create unique index if not exists operations_replay
  on operations (workspace_id, author_id, op_id) where op_id is not null;
create table if not exists undo_stacks (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  undo jsonb not null default '[]'::jsonb,
  redo jsonb not null default '[]'::jsonb,
  primary key (workspace_id, user_id)
);
create table if not exists versions (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  author_id text not null,
  created_at timestamptz not null default now(),
  seq bigint not null,
  document jsonb not null
);
create table if not exists comments (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  page_id text not null,
  node_id text not null,
  node_name text not null,
  author_id text not null,
  body text not null,
  created_at timestamptz not null default now(),
  status text not null default 'open',
  parent_id text
);
create table if not exists images (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  file_name text not null,
  content_type text not null,
  width integer not null,
  height integer not null,
  status text not null,
  created_at timestamptz not null default now()
);
create table if not exists page_publish (
  page_id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  state text not null,
  publish_id text,
  published_seq bigint
);
create table if not exists publishes (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  page_id text not null,
  snapshot_key text not null,
  published_seq bigint not null,
  created_at timestamptz not null default now()
);
create table if not exists idempotency (
  key text primary key,
  page_id text not null,
  status text not null,
  response jsonb,
  created_at timestamptz not null default now()
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
