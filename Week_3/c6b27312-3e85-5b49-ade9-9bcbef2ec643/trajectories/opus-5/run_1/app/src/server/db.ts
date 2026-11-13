import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 4000,
});

pool.on('error', () => {
  /* a broken idle connection is replaced by the pool */
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/** Runs the work in one transaction, releasing the connection as soon as it ends. */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      client.release(true);
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `
create table if not exists users (
  id text primary key,
  email text not null,
  email_folded text not null unique,
  password_hash text not null,
  display_name text not null,
  verified boolean not null default false,
  created_at timestamptz not null
);

create table if not exists verification_tokens (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  next_path text not null default '/dashboard',
  created_at timestamptz not null,
  used_at timestamptz
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null
);

create table if not exists sources (
  ref text primary key,
  body text not null
);

create table if not exists parts (
  slug text primary key,
  title text not null,
  category text not null,
  visibility text not null,
  owner_id text not null references users(id),
  seed_position integer,
  created_at timestamptz not null,
  head_revision_id text,
  listed boolean not null default true
);

create table if not exists revisions (
  id text primary key,
  part_slug text not null references parts(slug) on delete cascade,
  label_number integer not null,
  parent_revision_id text,
  author_id text not null references users(id),
  created_at timestamptz not null,
  values_json jsonb not null,
  source_ref text not null,
  evaluation_id text,
  geometry_digest text not null,
  message text not null,
  restored_from text,
  forked_from_revision_id text,
  forked_from_operation integer,
  volume double precision not null,
  bbox jsonb not null,
  faces integer not null,
  unique (part_slug, label_number)
);

create table if not exists tapes (
  revision_id text primary key references revisions(id) on delete cascade,
  operations jsonb not null
);

create table if not exists evaluations (
  id text primary key,
  part_slug text not null,
  viewer_id text,
  seq double precision not null,
  status text not null,
  engine_version text not null,
  geometry_digest text,
  volume double precision not null,
  bbox jsonb not null,
  faces integer not null,
  solid jsonb,
  diagnostics jsonb not null,
  started_at timestamptz not null,
  finished_at timestamptz
);

create table if not exists preflight_reports (
  id text primary key,
  part_slug text not null,
  revision_id text,
  viewer_id text,
  process text not null,
  values_json jsonb not null,
  geometry_digest text,
  status text not null,
  message text,
  findings jsonb not null,
  cost_bands jsonb not null,
  confidence text,
  created_at timestamptz not null
);

create table if not exists rooms (
  id text primary key,
  part_slug text not null references parts(slug) on delete cascade,
  base_revision_id text not null,
  head_revision_id text not null,
  title text not null,
  state text not null,
  required_approvals integer not null,
  created_by text not null references users(id),
  created_at timestamptz not null
);

create table if not exists room_reviewers (
  room_id text not null references rooms(id) on delete cascade,
  email text not null,
  email_folded text not null,
  primary key (room_id, email_folded)
);

create table if not exists comments (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  author_id text not null references users(id),
  body text not null,
  anchor jsonb not null,
  pose jsonb not null,
  revision_id text not null,
  created_at timestamptz not null
);

create table if not exists approvals (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  reviewer_id text not null references users(id),
  revision_id text not null,
  geometry_digest text not null,
  at timestamptz not null,
  unique (room_id, reviewer_id, geometry_digest)
);

create table if not exists likes (
  part_slug text not null references parts(slug) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null,
  primary key (part_slug, user_id)
);

create table if not exists idempotency_records (
  caller text not null,
  method text not null,
  path text not null,
  key text not null,
  fingerprint text not null,
  state text not null,
  status integer,
  location text,
  etag text,
  body text,
  created_at timestamptz not null,
  primary key (caller, method, path, key)
);

create table if not exists outbox (
  id bigserial primary key,
  part_slug text not null,
  room_id text,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null
);

alter table parts add column if not exists listed boolean not null default true;
alter table evaluations alter column seq type double precision;

create index if not exists outbox_part_idx on outbox (part_slug, id);
create index if not exists revisions_part_idx on revisions (part_slug, label_number desc);
create index if not exists preflight_digest_idx on preflight_reports (geometry_digest, created_at desc);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}
