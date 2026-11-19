import { pool } from './pool.js';

const STATEMENTS = [
  `create table if not exists users (
     id text primary key,
     email text not null unique,
     display_name text not null,
     password_hash text not null,
     walkthrough_done boolean not null default false
   )`,
  `create table if not exists workspaces (
     id text primary key,
     name text not null,
     standards jsonb not null,
     standards_revision bigint not null default 0,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists memberships (
     workspace_id text not null references workspaces(id) on delete cascade,
     user_id text not null references users(id) on delete cascade,
     role text not null,
     revision bigint not null default 0,
     primary key (workspace_id, user_id)
   )`,
  `create table if not exists auth_sessions (
     id text primary key,
     user_id text not null references users(id) on delete cascade,
     last_seen_at timestamptz not null default now()
   )`,
  `create table if not exists layouts (
     id text primary key,
     workspace_id text not null references workspaces(id) on delete cascade,
     name text not null,
     content jsonb not null,
     module_revisions jsonb not null default '{}'::jsonb,
     trash jsonb not null default '[]'::jsonb,
     consumed_ends jsonb not null default '{}'::jsonb,
     revision bigint not null default 0,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists layout_versions (
     id text primary key,
     layout_id text not null references layouts(id) on delete cascade,
     number integer not null,
     state text not null,
     canonical_hash text not null,
     content jsonb not null,
     label text not null default '',
     saved_by text not null default '',
     saved_at timestamptz not null default now(),
     restored_from integer,
     revision bigint not null default 0,
     unique (layout_id, number)
   )`,
  `create table if not exists layout_history (
     id bigserial primary key,
     layout_id text not null references layouts(id) on delete cascade,
     actor text not null,
     at timestamptz not null default now(),
     action text not null,
     object_id text,
     from_value text,
     to_value text
   )`,
  `create table if not exists sessions (
     id text primary key,
     workspace_id text not null references workspaces(id) on delete cascade,
     layout_id text not null,
     name text not null,
     status text not null,
     hold_reason text,
     ratio integer not null,
     revision bigint not null default 0,
     control_revision bigint not null default 0,
     session_version integer not null default 1,
     tick bigint not null default 0,
     layout_version_id text not null,
     layout_version_number integer not null,
     timetable_version integer not null,
     state jsonb not null,
     last_tick_at timestamptz not null default now(),
     created_at timestamptz not null default now()
   )`,
  `create table if not exists session_ticks (
     session_id text not null,
     tick bigint not null,
     revision bigint not null,
     positions jsonb not null,
     counters jsonb not null,
     committed_at timestamptz not null default now(),
     primary key (session_id, tick)
   )`,
  `create table if not exists event_outbox (
     stream text not null,
     seq bigint not null,
     type text not null,
     payload jsonb not null,
     published_at timestamptz,
     primary key (stream, seq)
   )`,
  `create index if not exists event_outbox_unpublished
     on event_outbox (stream, seq) where published_at is null`,
  `create table if not exists crew_packets (
     id text primary key,
     session_id text not null references sessions(id) on delete cascade,
     state text not null,
     content_hash text,
     pdf_bytes bytea,
     session_version integer not null,
     failure text,
     issued_by text not null,
     issued_at timestamptz not null default now(),
     ready_at timestamptz
   )`,
  `create table if not exists idempotency (
     scope text not null,
     user_id text not null,
     key text not null,
     body_hash text not null,
     status integer,
     response jsonb,
     completed boolean not null default false,
     created_at timestamptz not null default now(),
     primary key (scope, user_id, key)
   )`,
  `create table if not exists instances (
     id text primary key,
     pid integer,
     port integer not null default 0,
     up boolean not null default false,
     last_seen_at timestamptz not null default now()
   )`,
  `create table if not exists seed_state (
     id text primary key,
     applied_at timestamptz not null default now()
   )`,
];

export async function applySchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await pool.query(statement);
  }
}

/**
 * A Postgres advisory lock so instances starting together apply the seed once.
 */
export async function withSeedLock<T>(fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(5713001)');
    return await fn();
  } finally {
    await client.query('select pg_advisory_unlock(5713001)');
    client.release();
  }
}
