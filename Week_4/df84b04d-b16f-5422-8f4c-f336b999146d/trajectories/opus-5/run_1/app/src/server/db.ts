import pg from 'pg';
import type { PoolClient } from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

const SCHEMA = `
create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  confirmed boolean not null default false,
  hide_completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists confirmation_codes (
  user_id text primary key references users(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists bullets (
  id text primary key,
  owner_id text not null references users(id) on delete cascade,
  parent_id text references bullets(id) on delete cascade,
  position integer not null,
  text text not null default '',
  completed boolean not null default false,
  collapsed boolean not null default false,
  date date,
  tags text[] not null default '{}',
  mentions text[] not null default '{}',
  mirror_of text,
  revision integer not null default 1,
  revision_author text,
  trashed_at timestamptz,
  purge_at timestamptz
);

create index if not exists bullets_owner_idx on bullets (owner_id);
create index if not exists bullets_parent_idx on bullets (parent_id);
create index if not exists bullets_mirror_idx on bullets (mirror_of);

create table if not exists shares (
  id text primary key,
  bullet_id text not null references bullets(id) on delete cascade,
  owner_id text not null references users(id) on delete cascade,
  email text not null,
  token text not null unique,
  status text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists shares_email_idx on shares (email);
create index if not exists shares_bullet_idx on shares (bullet_id);

create table if not exists outline_sequence (
  owner_id text primary key references users(id) on delete cascade,
  seq bigint not null default 0
);

create table if not exists changes (
  owner_id text not null references users(id) on delete cascade,
  seq bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, seq)
);

create table if not exists history_steps (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  owner_id text not null,
  kind text not null,
  payload jsonb not null,
  undone boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists history_user_idx on history_steps (user_id, id);
`;

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

/** Runs a read-only query outside a transaction. */
export async function query<Row>(
  sql: string,
  values: readonly unknown[] = []
): Promise<Row[]> {
  const result = await pool.query(sql, values as unknown[]);
  return result.rows as Row[];
}

/**
 * Runs one write transaction. Writes to an outline are serialised on the owner,
 * so changes commit in arrival order and take sequence numbers without gaps.
 */
export async function withOutlineLock<T>(
  ownerId: string,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [ownerId]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
