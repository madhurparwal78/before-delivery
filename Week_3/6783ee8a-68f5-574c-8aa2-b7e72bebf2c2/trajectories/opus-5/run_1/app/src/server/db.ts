import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
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

const SCHEMA = `
create table if not exists users (
  id text primary key,
  email text not null,
  email_lower text not null unique,
  display_name text not null,
  password_hash text not null,
  notebook_use text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists verification_tokens (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists notebooks (
  id text primary key,
  owner_id text not null references users(id) on delete cascade,
  title text not null,
  imported boolean not null default false,
  execution_counter integer not null default 0,
  checkpoint_sequence integer not null default 0,
  search_dirty boolean not null default true,
  modified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists cells (
  notebook_id text not null references notebooks(id) on delete cascade,
  id text not null,
  position integer not null,
  cell_type text not null,
  source text not null,
  revision integer not null default 1,
  execution_count integer,
  run_state text not null default 'idle',
  outputs json not null default '[]',
  outputs_version integer not null default 1,
  metadata json not null default '{}',
  primary key (notebook_id, id)
);

create table if not exists deleted_cells (
  notebook_id text not null references notebooks(id) on delete cascade,
  id text not null,
  position integer not null,
  cell_type text not null,
  source text not null,
  revision integer not null,
  execution_count integer,
  run_state text not null,
  outputs json not null,
  outputs_version integer not null,
  metadata json not null,
  deleted_at timestamptz not null default now(),
  primary key (notebook_id, id)
);

create table if not exists shares (
  id text primary key,
  notebook_id text not null references notebooks(id) on delete cascade,
  email text not null,
  email_lower text not null,
  role text not null,
  status text not null,
  user_id text references users(id) on delete set null,
  token text not null unique,
  created_at timestamptz not null default now(),
  unique (notebook_id, email_lower)
);

create table if not exists runs (
  run_id text primary key,
  notebook_id text not null references notebooks(id) on delete cascade,
  cell_id text not null,
  tab_id text not null,
  state text not null,
  cell_state_before text not null,
  execution_count integer,
  result_request json,
  result_response json,
  created_at timestamptz not null default now()
);

create table if not exists presence (
  tab_id text primary key,
  notebook_id text not null references notebooks(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  cell_id text,
  last_seen timestamptz not null default now()
);

create table if not exists cell_locks (
  notebook_id text not null references notebooks(id) on delete cascade,
  cell_id text not null,
  tab_id text not null,
  user_id text not null references users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (notebook_id, cell_id)
);

create sequence if not exists kernel_report_seq;

create table if not exists kernel_reports (
  notebook_id text not null references notebooks(id) on delete cascade,
  tab_id text not null,
  status text not null,
  seq bigint not null default nextval('kernel_report_seq'),
  primary key (notebook_id, tab_id)
);

create table if not exists checkpoints (
  id text primary key,
  notebook_id text not null references notebooks(id) on delete cascade,
  number integer not null,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists exports (
  id text primary key,
  notebook_id text not null references notebooks(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  notebook_id text not null references notebooks(id) on delete cascade,
  cell_id text not null,
  name text not null,
  content_type text not null,
  primary key (notebook_id, cell_id, name)
);

create index if not exists cells_order on cells (notebook_id, position);
create index if not exists presence_notebook on presence (notebook_id);
create index if not exists shares_email on shares (email_lower);
create index if not exists checkpoints_notebook on checkpoints (notebook_id, number desc);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

/** Waits for PostgreSQL, retrying every second, then applies the schema. */
export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
