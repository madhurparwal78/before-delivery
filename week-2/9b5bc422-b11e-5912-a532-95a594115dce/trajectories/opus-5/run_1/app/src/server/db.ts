import pg from 'pg';
import { config } from './config.ts';
import { apiError } from './errors.ts';

const SCHEMA = `
create table if not exists accounts (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists devices (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  number integer not null,
  removed boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists changes (
  seq bigserial primary key,
  op_id text not null,
  account_id uuid not null references accounts(id) on delete cascade,
  device_id text not null,
  entity text not null,
  entity_id text not null,
  document_id text,
  field text not null,
  value jsonb,
  parents jsonb,
  at timestamptz not null,
  seed boolean not null default false,
  slot boolean not null default false,
  content boolean not null default false,
  unique (account_id, op_id)
);
create index if not exists changes_account_seq on changes (account_id, seq);
create index if not exists changes_document on changes (account_id, document_id);
create table if not exists tombstones (
  account_id uuid not null references accounts(id) on delete cascade,
  document_id text not null,
  at timestamptz not null default now(),
  primary key (account_id, document_id)
);
create table if not exists attachments (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  document_id text not null,
  name text not null,
  size bigint not null,
  content_type text not null,
  digest text not null,
  created_at timestamptz not null default now()
);
create table if not exists share_links (
  token text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  document_id text not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists share_links_document on share_links (account_id, document_id);
`;

let pool: pg.Pool | null = null;
let ready = false;

function makePool(): pg.Pool | null {
  try {
    return new pg.Pool({
      connectionString: config.databaseUrl,
      max: 8,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10_000,
    });
  } catch {
    return null;
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  if (!pool) pool = makePool();
  if (!pool) throw apiError.unavailable();
  try {
    return params.length ? await pool.query<T>(sql, params) : await pool.query<T>(sql);
  } catch {
    ready = false;
    const old = pool;
    pool = null;
    void old.end().catch(() => undefined);
    throw apiError.unavailable();
  }
}

/** The schema is applied at every start and again when Postgres returns. */
export async function ensureSchema(): Promise<boolean> {
  try {
    await query(SCHEMA);
    ready = true;
    return true;
  } catch {
    ready = false;
    return false;
  }
}

export async function postgresReachable(): Promise<boolean> {
  if (!ready) return ensureSchema();
  try {
    await query('select 1');
    return true;
  } catch {
    return false;
  }
}
