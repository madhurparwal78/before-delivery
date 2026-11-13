import pg from 'pg';
import type { QueryResultRow } from 'pg';
import { config } from './config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function one<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

const SCHEMA = `
create table if not exists users (
  username text primary key,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token text primary key,
  username text not null references users(username) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists login_attempts (
  username text not null,
  at timestamptz not null
);
create table if not exists folders (
  id text primary key,
  name text not null,
  parent_id text references folders(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists folder_roles (
  folder_id text not null references folders(id) on delete cascade,
  username text not null,
  role text not null,
  primary key (folder_id, username)
);
create table if not exists drawings (
  id text primary key,
  folder_id text not null references folders(id) on delete cascade,
  name text not null,
  revision integer not null default 0,
  model jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists operation_groups (
  seq bigserial primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  group_id text not null,
  username text not null,
  command text not null,
  base_revision integer not null,
  revision_before integer not null,
  revision_after integer not null,
  patch jsonb not null,
  targets jsonb not null,
  undone boolean not null default false,
  dropped boolean not null default false,
  inverse_of text,
  at timestamptz not null default now()
);
create index if not exists operation_groups_drawing on operation_groups (drawing_id, seq);
create table if not exists operations (
  drawing_id text not null references drawings(id) on delete cascade,
  op_id text not null,
  group_id text not null,
  result jsonb not null,
  revision integer not null,
  primary key (drawing_id, op_id)
);
create table if not exists live_messages (
  drawing_id text not null references drawings(id) on delete cascade,
  seq integer not null,
  type text not null,
  data jsonb not null,
  primary key (drawing_id, seq)
);
create table if not exists sheets (
  id text primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  name text not null,
  size text not null,
  number integer not null,
  locked boolean not null default false,
  locked_by text,
  attributes jsonb not null default '{}'::jsonb,
  creator text not null,
  created_at timestamptz not null default now()
);
create table if not exists viewports (
  id text primary key,
  sheet_id text not null references sheets(id) on delete cascade,
  x double precision not null,
  y double precision not null,
  width double precision not null,
  height double precision not null,
  scale text not null,
  view_x double precision not null,
  view_y double precision not null,
  frozen_layers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists versions (
  id text primary key,
  sheet_id text not null references sheets(id) on delete cascade,
  number integer not null,
  state text not null,
  replaced_by integer,
  snapshot jsonb not null,
  keys jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists version_stamps (
  id text primary key,
  version_id text not null references versions(id) on delete cascade,
  text text not null,
  at timestamptz not null default now()
);
create table if not exists review_steps (
  id text primary key,
  version_id text not null references versions(id) on delete cascade,
  role text not null,
  state text not null,
  position integer not null,
  due_at timestamptz,
  comment text
);
create table if not exists markups (
  id text primary key,
  version_id text not null references versions(id) on delete cascade,
  kind text not null,
  x1 double precision not null,
  y1 double precision not null,
  x2 double precision not null,
  y2 double precision not null,
  text text,
  flag text,
  author text not null,
  created_at timestamptz not null default now()
);
create table if not exists issues (
  id text primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  version_id text not null references versions(id) on delete cascade,
  title text not null,
  x double precision not null,
  y double precision not null,
  state text not null,
  creator text not null,
  created_at timestamptz not null default now()
);
create table if not exists rfis (
  id text primary key,
  issue_id text not null references issues(id) on delete cascade,
  question text not null,
  state text not null,
  asker text not null,
  addressee text not null,
  ball_in_court text not null,
  answer text,
  created_at timestamptz not null default now()
);
create table if not exists links (
  id text primary key,
  version_id text not null references versions(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists export_jobs (
  id text primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  format text not null,
  state text not null,
  progress integer not null default 0,
  key text,
  username text not null,
  next_step_at bigint not null,
  created_at timestamptz not null default now()
);
create table if not exists underlays (
  id text primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  key text not null,
  bytes integer not null,
  sha256 text not null,
  x1 double precision not null,
  y1 double precision not null,
  x2 double precision not null,
  y2 double precision not null
);
create table if not exists imports (
  id text primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
`;

export async function connectAndMigrate(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await pool.query(SCHEMA);
}
