import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export const query = async <R extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> => {
  const result = await pool.query<R>(text, values as unknown[]);
  return result.rows;
};

export const one = async <R extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<R | null> => {
  const rows = await query<R>(text, values);
  return rows[0] ?? null;
};

export const transact = async <T>(run: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const SCHEMA = `
create table if not exists users (
  id text primary key,
  handle text not null unique,
  email text not null,
  email_lower text not null unique,
  password_hash text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists verify_tokens (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  invalidated boolean not null default false
);

create table if not exists pens (
  id text primary key,
  owner_id text not null references users(id) on delete cascade,
  title text not null,
  visibility text not null,
  head integer not null default 0,
  tags text[] not null default '{}',
  source_pen_id text,
  source_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pens_owner_updated on pens (owner_id, updated_at desc);
create index if not exists pens_source on pens (source_pen_id);
create index if not exists pens_visibility on pens (visibility);

create table if not exists versions (
  pen_id text not null references pens(id) on delete cascade,
  number integer not null,
  created_at timestamptz not null,
  sha256 text not null,
  restored_from integer,
  html text not null,
  css text not null,
  js text not null,
  libraries text[] not null default '{}',
  added integer not null,
  removed integer not null,
  changed_chars integer not null,
  primary key (pen_id, number)
);

create table if not exists likes (
  user_id text not null references users(id) on delete cascade,
  pen_id text not null references pens(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, pen_id)
);
create index if not exists likes_pen on likes (pen_id);

create table if not exists collections (
  id text primary key,
  owner_id text not null references users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists collection_pens (
  collection_id text not null references collections(id) on delete cascade,
  pen_id text not null references pens(id) on delete cascade,
  position integer not null,
  primary key (collection_id, pen_id)
);

create table if not exists idempotency (
  user_id text not null,
  route text not null,
  key text not null,
  body_hash text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, route, key)
);

create table if not exists renders (
  id text primary key,
  nonce text not null,
  html text not null,
  css text not null,
  js text not null,
  libraries text[] not null default '{}',
  pen_id text references pens(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists outbox (
  id text primary key,
  kind text not null,
  payload jsonb not null,
  sent boolean not null default false,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now()
);
`;

export const applySchema = async (): Promise<void> => {
  await pool.query(SCHEMA);
};

export const databaseHealthy = async (): Promise<boolean> => {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
};
