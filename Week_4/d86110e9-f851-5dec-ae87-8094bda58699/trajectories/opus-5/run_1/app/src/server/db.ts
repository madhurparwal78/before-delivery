import { Pool, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

const SCHEMA = `
create table if not exists users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  confirmed boolean not null default false,
  confirm_token text,
  created_at timestamptz not null default now()
);
create table if not exists workspaces (
  id text primary key,
  name text not null,
  slug text not null unique,
  clock_offset_seconds bigint not null default 0
);
create table if not exists members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create table if not exists invites (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null,
  token text not null unique,
  used boolean not null default false,
  inviter_name text not null,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists automations (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  trigger_kind text not null,
  revision integer not null default 1,
  live_version integer,
  draft jsonb not null,
  step_seq integer not null default 0,
  edge_seq integer not null default 0,
  kind_counts jsonb not null default '{}'::jsonb,
  run_seq integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists versions (
  automation_id text not null references automations(id) on delete cascade,
  version integer not null,
  content jsonb not null,
  revision integer not null,
  published_at timestamptz not null,
  owner_port integer not null,
  primary key (automation_id, version)
);
create table if not exists data_tables (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  cols jsonb not null,
  row_seq integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists data_rows (
  table_id text not null references data_tables(id) on delete cascade,
  row_id text not null,
  cells jsonb not null,
  seq bigserial,
  primary key (table_id, row_id)
);
create table if not exists runs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  automation_id text not null references automations(id) on delete cascade,
  number integer not null,
  version integer,
  content jsonb not null,
  status text not null,
  test boolean not null default false,
  replay_of text,
  message text,
  failed_step text,
  trigger_output jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  finished_at timestamptz,
  owner_port integer not null,
  cursor jsonb not null default '[]'::jsonb,
  executions integer not null default 0,
  seq bigserial
);
create table if not exists run_steps (
  run_id text not null references runs(id) on delete cascade,
  step_id text not null,
  kind text not null,
  name text not null,
  grid_col integer not null,
  grid_row integer not null,
  status text not null,
  reused boolean not null default false,
  input jsonb,
  output jsonb,
  log jsonb not null default '[]'::jsonb,
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  due_at timestamptz,
  retry_at timestamptz,
  order_index integer,
  primary key (run_id, step_id)
);
create table if not exists timers (
  id bigserial primary key,
  run_id text not null references runs(id) on delete cascade,
  kind text not null,
  step_id text not null,
  due_at timestamptz not null,
  owner_port integer not null,
  fired boolean not null default false
);
create table if not exists schedule_claims (
  automation_id text primary key references automations(id) on delete cascade,
  version integer not null,
  schedule text not null,
  next_at timestamptz not null,
  owner_port integer not null
);
create table if not exists idempotency_keys (
  workspace_id text not null references workspaces(id) on delete cascade,
  hook_path text not null,
  key text not null,
  body_hash text not null,
  run_id text not null,
  first_at timestamptz not null,
  primary key (workspace_id, hook_path, key)
);
create table if not exists edit_holds (
  automation_id text not null references automations(id) on delete cascade,
  step_id text not null,
  user_id text not null,
  held_at timestamptz not null,
  primary key (automation_id, step_id)
);
create table if not exists imports (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  object_key text not null,
  created_at timestamptz not null default now()
);
create index if not exists runs_workspace_idx on runs (workspace_id, started_at desc);
create index if not exists timers_due_idx on timers (owner_port, fired, due_at);
`;

export async function connectAndMigrate(): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await pool.query('select 1');
      break;
    } catch (error) {
      if (Date.now() >= deadline) {
        process.stderr.write(`Postgres unreachable: ${String(error)}\n`);
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await pool.query(SCHEMA);
}
