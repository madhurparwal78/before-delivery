import { Pool, type QueryResultRow } from 'pg';
import { config } from './config';

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export async function query<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

export async function one<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

const SCHEMA = `
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  verified boolean not null default false,
  reduce_motion boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists verify_tokens (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists patterns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  craft text not null,
  mode text not null,
  terms text,
  cast_on integer not null,
  width integer not null,
  height integer not null,
  state text not null default 'draft',
  published_version integer,
  created_at timestamptz not null default now()
);

create table if not exists pattern_co_designers (
  pattern_id uuid not null references patterns(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (pattern_id, user_id)
);

create table if not exists cells (
  pattern_id uuid not null references patterns(id) on delete cascade,
  row integer not null,
  col integer not null,
  stitch text not null,
  colour text not null,
  repeat_id text,
  rev integer not null default 0,
  last_editor uuid references users(id) on delete set null,
  primary key (pattern_id, row, col)
);

create table if not exists repeats (
  pattern_id uuid not null references patterns(id) on delete cascade,
  id text not null,
  from_col integer not null,
  to_col integer not null,
  from_row integer not null,
  to_row integer not null,
  times integer not null,
  primary key (pattern_id, id)
);

create table if not exists colours (
  pattern_id uuid not null references patterns(id) on delete cascade,
  letter text not null,
  name text not null,
  hex text not null,
  primary key (pattern_id, letter)
);

create table if not exists versions (
  pattern_id uuid not null references patterns(id) on delete cascade,
  version integer not null,
  note text not null default '',
  saved_on text not null,
  stitches integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (pattern_id, version)
);

create table if not exists testers (
  id uuid primary key default gen_random_uuid(),
  pattern_id uuid not null references patterns(id) on delete cascade,
  email text not null,
  user_id uuid references users(id) on delete cascade,
  status text not null,
  token text not null unique,
  sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  version integer,
  row integer not null default 1
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  pattern_id uuid not null references patterns(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  row integer not null,
  text text not null,
  version integer not null,
  created_at timestamptz not null default now()
);

create table if not exists ops (
  pattern_id uuid not null references patterns(id) on delete cascade,
  op_id text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (pattern_id, op_id)
);

create table if not exists counter_steps (
  pattern_id uuid not null references patterns(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  step_id text not null,
  row integer not null,
  primary key (pattern_id, user_id, step_id)
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}
