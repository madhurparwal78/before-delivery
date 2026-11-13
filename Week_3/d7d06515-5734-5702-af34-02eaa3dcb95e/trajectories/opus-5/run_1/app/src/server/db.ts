import { Pool, type PoolClient, types } from 'pg';
import { config } from './config';

// Dates arrive as plain `YYYY-MM-DD` strings so studio-zone day maths never touches a UTC Date.
types.setTypeParser(1082, (value) => value);
types.setTypeParser(20, (value) => Number.parseInt(value, 10));
types.setTypeParser(1700, (value) => Number.parseFloat(value));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export interface SqlRunner {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export async function queryOn<T>(runner: SqlRunner, text: string, values: readonly unknown[] = []): Promise<T[]> {
  const result = await runner.query(text, values as unknown[]);
  return result.rows as T[];
}

export async function query<T>(text: string, values: readonly unknown[] = []): Promise<T[]> {
  return await queryOn<T>(pool, text, values);
}

export async function one<T>(text: string, values: readonly unknown[] = []): Promise<T | null> {
  const found = await query<T>(text, values);
  return found[0] ?? null;
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists workspaces (
  id uuid primary key,
  time_zone text not null,
  units text not null,
  created_at timestamptz not null,
  clock_set_real timestamptz,
  clock_set_now timestamptz
);

create table if not exists users (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  email text not null,
  password_hash text not null,
  verified boolean not null default false,
  confirmed_on date,
  created_at timestamptz not null
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists verify_tokens (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null,
  seq bigserial
);

create table if not exists sessions (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null
);

create table if not exists signin_attempts (
  email text primary key,
  failures int not null default 0,
  lock_until timestamptz
);

create table if not exists folders (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_id uuid references folders(id) on delete cascade,
  name text not null,
  kind text not null default 'normal',
  modified_at timestamptz not null,
  created_at timestamptz not null
);
create unique index if not exists folders_name_key on folders
  (workspace_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table if not exists drawings (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  folder_id uuid not null references folders(id) on delete cascade,
  name text not null,
  units text not null,
  plot_style text not null default 'Monochrome',
  version int not null default 1,
  owner_user_id uuid references users(id) on delete set null,
  is_sample boolean not null default false,
  next_handle bigint not null default 16,
  export_count int not null default 0,
  trace_counter int not null default 0,
  issue_counter int not null default 0,
  object_seq bigint not null default 0,
  modified_at timestamptz not null,
  created_at timestamptz not null
);
create unique index if not exists drawings_name_key on drawings (folder_id, lower(name));

create table if not exists layers (
  drawing_id uuid not null references drawings(id) on delete cascade,
  name text not null,
  color text not null,
  linetype text not null,
  lineweight text not null,
  is_on boolean not null default true,
  frozen boolean not null default false,
  locked boolean not null default false,
  is_current boolean not null default false,
  ord int not null,
  primary key (drawing_id, name)
);
create unique index if not exists layers_name_key on layers (drawing_id, lower(name));

create table if not exists objects (
  drawing_id uuid not null references drawings(id) on delete cascade,
  handle text not null,
  type text not null,
  layer text not null,
  color text not null,
  linetype text not null,
  linetype_scale double precision not null,
  lineweight text not null,
  dimension_style text not null,
  text_style text not null,
  multileader_style text not null,
  data jsonb not null,
  ord bigint not null,
  primary key (drawing_id, handle)
);
create index if not exists objects_drawing_ord on objects (drawing_id, ord);

create table if not exists layouts (
  drawing_id uuid not null references drawings(id) on delete cascade,
  name text not null,
  viewport_scale text,
  ord int not null,
  primary key (drawing_id, name)
);

create table if not exists drawing_versions (
  drawing_id uuid not null references drawings(id) on delete cascade,
  version int not null,
  actor text not null,
  actor_key text not null,
  command text not null,
  created_handles text[] not null,
  modified_handles text[] not null,
  erased_handles text[] not null,
  before_state jsonb not null,
  after_state jsonb not null,
  undone boolean not null default false,
  redo_blocked boolean not null default false,
  created_at timestamptz not null,
  primary key (drawing_id, version)
);

create table if not exists activity (
  id bigserial primary key,
  drawing_id uuid not null references drawings(id) on delete cascade,
  at timestamptz not null,
  actor text not null,
  command text not null,
  count int not null,
  verb text not null,
  text text not null
);
create index if not exists activity_drawing on activity (drawing_id, id desc);

create table if not exists traces (
  id uuid primary key,
  drawing_id uuid not null references drawings(id) on delete cascade,
  name text not null,
  state text not null,
  author text not null,
  author_key text not null,
  notice text,
  created_at timestamptz not null,
  seq bigserial
);

create table if not exists trace_objects (
  trace_id uuid not null references traces(id) on delete cascade,
  handle text not null,
  type text not null,
  layer text not null,
  color text not null,
  linetype text not null,
  linetype_scale double precision not null,
  lineweight text not null,
  dimension_style text not null,
  text_style text not null,
  multileader_style text not null,
  data jsonb not null,
  ord bigint not null,
  primary key (trace_id, handle)
);

create table if not exists issues (
  drawing_id uuid not null references drawings(id) on delete cascade,
  number int not null,
  trace_id uuid not null references traces(id) on delete cascade,
  text text not null,
  status text not null,
  created_at timestamptz not null,
  primary key (drawing_id, number)
);

create table if not exists shares (
  id uuid primary key,
  drawing_id uuid not null references drawings(id) on delete cascade,
  token text not null unique,
  access text not null,
  recipient_email text not null,
  recipient_name text not null,
  expiry_date date,
  revoked_at timestamptz,
  created_at timestamptz not null
);

create table if not exists invites (
  drawing_id uuid not null references drawings(id) on delete cascade,
  email text not null,
  sent_at timestamptz not null,
  primary key (drawing_id, email)
);

create table if not exists exports (
  id uuid primary key,
  drawing_id uuid not null references drawings(id) on delete cascade,
  format text not null,
  layout text not null,
  file text not null,
  state text not null,
  issued_at timestamptz not null,
  issue_date text not null,
  title_block_revision text not null,
  object_key text,
  size_bytes bigint
);
create index if not exists exports_drawing on exports (drawing_id, issued_at desc);

create table if not exists file_versions (
  drawing_id uuid not null references drawings(id) on delete cascade,
  number int not null,
  created_at timestamptz not null,
  actor text not null,
  size_bytes bigint not null,
  object_key text not null,
  primary key (drawing_id, number)
);

create table if not exists quotes (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  number text not null,
  issue_date text not null,
  seq int not null,
  sent_to text not null,
  created_at timestamptz not null
);

create table if not exists title_block_revisions (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  letter text not null,
  footer_note text not null,
  effective_date date not null,
  created_at timestamptz not null,
  primary key (workspace_id, letter)
);

create table if not exists recent_opens (
  user_id uuid not null references users(id) on delete cascade,
  drawing_id uuid not null references drawings(id) on delete cascade,
  opened_at timestamptz not null,
  primary key (user_id, drawing_id)
);

create table if not exists xrefs (
  id uuid primary key,
  drawing_id uuid not null references drawings(id) on delete cascade,
  source_drawing_id uuid not null,
  name text not null,
  status text not null,
  ord bigserial
);
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(734102)');
    await client.query(SCHEMA);
  } finally {
    await client.query('select pg_advisory_unlock(734102)').catch(() => undefined);
    client.release();
  }
}
