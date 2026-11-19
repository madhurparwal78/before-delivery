import pg from 'pg';
import type { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

const SCHEMA = `
create table if not exists users (
  id text primary key,
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists verifications (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  spent boolean not null default false
);
create table if not exists teams (
  id text primary key,
  name text not null,
  owner_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists team_members (
  team_id text not null references teams(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null,
  primary key (team_id, user_id)
);
create table if not exists invites (
  token_hash text primary key,
  team_id text not null references teams(id) on delete cascade,
  email text not null,
  inviter_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  spent boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists recipes (
  id text primary key,
  name text not null,
  owner_user_id text references users(id) on delete cascade,
  team_id text references teams(id) on delete cascade,
  latest_version integer not null default 0,
  tags jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create table if not exists recipe_versions (
  recipe_id text not null references recipes(id) on delete cascade,
  n integer not null,
  name text not null,
  note text not null,
  tags jsonb not null,
  steps jsonb not null,
  author_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recipe_id, n)
);
create table if not exists files (
  id text primary key,
  owner_id text not null references users(id) on delete cascade,
  name text not null,
  bytes integer not null,
  sha256 text not null,
  created_at timestamptz not null default now()
);
create table if not exists snapshots (
  token text primary key,
  owner_id text not null references users(id) on delete cascade,
  recipe_name text not null,
  recipe_id text,
  recipe_version integer,
  steps jsonb not null,
  input_bytes integer not null,
  output_bytes integer not null,
  input_sha text not null,
  output_sha text not null,
  pending_input bytea,
  pending_output bytea,
  status text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);
create table if not exists imports (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  text_hash text not null,
  status text not null,
  recipe_id text references recipes(id) on delete set null,
  version integer,
  report jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists recipes_owner_idx on recipes (owner_user_id);
create index if not exists recipes_team_idx on recipes (team_id);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists imports_user_text_idx on imports (user_id, text_hash);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

/** Waits for PostgreSQL, retrying every 2 seconds, then applies the schema. */
export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      await applySchema();
      return;
    } catch (cause) {
      console.error('PostgreSQL is not ready yet:', cause instanceof Error ? cause.message : cause);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (cause) {
    await client.query('rollback');
    throw cause;
  } finally {
    client.release();
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}
