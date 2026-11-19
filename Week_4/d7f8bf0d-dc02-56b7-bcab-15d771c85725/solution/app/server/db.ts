import pg from 'pg'

pg.types.setTypeParser(20, value => Number(value))
pg.types.setTypeParser(1700, value => Number(value))

export type Db = pg.PoolClient | pg.Pool

let pool: pg.Pool | undefined

export function openPool(databaseUrl: string): pg.Pool {
  pool = new pg.Pool({ connectionString: databaseUrl, max: 24 })
  pool.on('error', () => undefined)
  return pool
}

export function db(): pg.Pool {
  if (pool === undefined) throw new Error('database pool is not open')
  return pool
}

export interface Tx {
  client: pg.PoolClient
  afterCommit: Array<() => void>
}

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db().connect()
  const tx: Tx = { client, afterCommit: [] }
  try {
    await client.query('begin')
    const result = await work(tx)
    await client.query('commit')
    for (const hook of tx.afterCommit) hook()
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function rows<T extends object>(client: Db, text: string, values: unknown[] = []): Promise<T[]> {
  const result = await client.query(text, values)
  return result.rows as T[]
}

export async function one<T extends object>(client: Db, text: string, values: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(client, text, values))[0]
}

const SCHEMA = `
create table if not exists users (
  id text primary key, email text not null unique, display_name text not null, password_hash text not null,
  is_founder boolean not null default false, walkthrough_done boolean not null default false);
create table if not exists auth_sessions (
  token_hash text primary key, user_id text not null references users(id), last_seen timestamptz not null default now());
create table if not exists workspaces (
  id text primary key, name text not null, standards jsonb not null, standards_revision integer not null default 1,
  created_at timestamptz not null default now());
create table if not exists members (
  workspace_id text not null references workspaces(id), user_id text not null references users(id),
  role text not null, revision integer not null default 1, created_at timestamptz not null default now(),
  primary key (workspace_id, user_id));
create table if not exists idempotency_keys (
  workspace_id text not null, user_id text not null, key text not null, fingerprint text not null,
  status integer not null, body jsonb not null, primary key (workspace_id, user_id, key));
create table if not exists layouts (
  id text primary key, workspace_id text not null references workspaces(id), name text not null,
  revision integer not null default 0, content jsonb not null, trash jsonb not null default '[]',
  module_revisions jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists layout_versions (
  id text primary key, layout_id text not null references layouts(id), number integer not null, state text not null,
  label text not null, canonical_hash text not null, content jsonb not null, saved_by text not null,
  saved_at timestamptz not null default now(), restored_from text, revision integer not null default 1,
  unique (layout_id, number));
create table if not exists layout_history (
  id bigserial primary key, layout_id text not null, module_id text, actor_id text, actor_name text,
  at timestamptz not null default now(), action text not null, object_id text, from_value text, to_value text);
create index if not exists layout_history_layout on layout_history (layout_id, id desc);
create table if not exists sessions (
  id text primary key, workspace_id text not null references workspaces(id), layout_id text not null references layouts(id),
  name text not null, status text not null, hold_reason text, ratio integer not null, revision bigint not null default 0,
  control_revision integer not null default 0, session_version integer not null default 1, tick bigint not null default 0,
  last_tick_at timestamptz, layout_version_id text not null, layout_version_number integer not null,
  timetable_version integer not null, state jsonb not null, created_at timestamptz not null default now());
create index if not exists sessions_status on sessions (status);
create table if not exists session_ticks (
  session_id text not null, tick bigint not null, revision bigint not null, positions jsonb not null,
  counters jsonb not null, committed_at timestamptz not null default now(), unique (session_id, tick));
create table if not exists event_outbox (
  stream text not null, seq bigint not null, type text not null, payload jsonb not null, published_at timestamptz,
  unique (stream, seq));
create index if not exists event_outbox_pending on event_outbox (stream, seq) where published_at is null;
create table if not exists crew_packets (
  id text primary key, session_id text not null, workspace_id text not null, state text not null,
  content_hash text not null default '', pdf_bytes bytea, session_version integer not null, failure text,
  issued_by text not null, issued_at timestamptz not null default now(), ready_at timestamptz,
  updated_at timestamptz not null default now());
create index if not exists crew_packets_session on crew_packets (session_id, issued_at);
`

const SCHEMA_LOCK = 7_190_001

// Applies the schema and the seed idempotently, safely with several instances starting together.
export async function applySchemaAndSeed(seed: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await db().connect()
  try {
    await client.query('select pg_advisory_lock($1)', [SCHEMA_LOCK])
    try {
      await client.query(SCHEMA)
      // All or nothing: an instance stopped mid-seed leaves an empty database, which the next boot seeds again.
      await client.query('begin')
      try {
        await seed(client)
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [SCHEMA_LOCK])
    }
  } finally {
    client.release()
  }
}
