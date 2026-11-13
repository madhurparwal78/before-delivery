import pg from 'pg';
import { databaseUrl } from './env.js';
import { fail } from './errors.js';

const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });

pool.on('error', () => {
  /* a broken idle client is reported on the next request as database_unavailable */
});

export type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(text: string, values: unknown[] = []): Promise<T[]> {
  try {
    const result = await pool.query<T>(text, values);
    return result.rows;
  } catch (cause) {
    throw databaseError(cause);
  }
}

export async function one<T extends Row = Row>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (cause) {
    throw databaseError(cause);
  }
  try {
    await client.query('begin');
    const out = await work(client);
    await client.query('commit');
    return out;
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw databaseError(cause);
  } finally {
    client.release();
  }
}

function databaseError(cause: unknown): unknown {
  if (cause instanceof Error && 'code' in cause) {
    const code = String((cause as { code?: string }).code ?? '');
    if (code.startsWith('23') || code.startsWith('22') || code.startsWith('42')) return cause;
  }
  if (cause instanceof Error && /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|terminat|Connection termin|socket/i.test(cause.message)) {
    return fail.databaseUnavailable();
  }
  return cause;
}

export async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Postgres did not answer within 60 seconds.');
}

const SCHEMA = `
create table if not exists spaces (
  id serial primary key,
  slug text unique not null,
  name text not null,
  seq bigint not null default 0
);
create table if not exists users (
  id serial primary key,
  username text unique not null,
  password_hash text not null,
  time_zone text not null default 'UTC',
  current_space_id int
);
create table if not exists members (
  space_id int not null references spaces(id) on delete cascade,
  user_id int not null references users(id) on delete cascade,
  role text not null,
  primary key (space_id, user_id)
);
create table if not exists sessions (
  id text primary key,
  user_id int not null references users(id) on delete cascade,
  created_ms bigint not null
);
create table if not exists streams (
  id serial primary key,
  space_id int not null references spaces(id) on delete cascade,
  name text not null,
  write_generation int not null default 1,
  pipeline_name text,
  rollover_max_age_ms bigint,
  rollover_max_events bigint,
  warm_after_ms bigint,
  archive_after_ms bigint,
  delete_after_ms bigint,
  unique (space_id, name)
);
create table if not exists generations (
  id serial primary key,
  stream_id int not null references streams(id) on delete cascade,
  number int not null,
  phase text not null,
  created_ms bigint not null,
  became_write_ms bigint not null,
  rolled_over_ms bigint,
  segment_key text,
  segment_bytes bigint,
  min_ts_ms bigint,
  max_ts_ms bigint,
  event_count int not null default 0,
  archive_failed boolean not null default false,
  delete_failed boolean not null default false,
  unique (stream_id, number)
);
create table if not exists mappings (
  id serial primary key,
  generation_id int not null references generations(id) on delete cascade,
  field text not null,
  type text not null,
  explicit boolean not null default false,
  unique (generation_id, field)
);
create table if not exists events (
  id bigserial primary key,
  space_id int not null references spaces(id) on delete cascade,
  stream_id int not null references streams(id) on delete cascade,
  generation_id int not null references generations(id) on delete cascade,
  event_id text not null,
  ts_ms bigint not null,
  stored_ms bigint not null,
  fields jsonb not null,
  raw jsonb not null,
  pipeline text,
  unique (stream_id, event_id)
);
create index if not exists events_range on events (stream_id, ts_ms);
create table if not exists postings (
  id bigserial primary key,
  stream_id int not null references streams(id) on delete cascade,
  generation_id int not null references generations(id) on delete cascade,
  field text not null,
  token text not null,
  event_row bigint not null,
  tf int not null,
  positions int[] not null,
  starts int[] not null,
  ends int[] not null
);
create index if not exists postings_lookup on postings (stream_id, field, token);
create index if not exists postings_dictionary on postings (stream_id, field);
create table if not exists doc_lengths (
  event_row bigint not null,
  stream_id int not null,
  field text not null,
  dl int not null,
  primary key (event_row, field)
);
create table if not exists failures (
  id bigserial primary key,
  space_id int not null references spaces(id) on delete cascade,
  stream_id int not null references streams(id) on delete cascade,
  reason text not null,
  raw text not null,
  at_ms bigint not null
);
create table if not exists pipelines (
  id serial primary key,
  space_id int not null references spaces(id) on delete cascade,
  name text not null,
  version int not null default 1,
  processors jsonb not null,
  unique (space_id, name)
);
create table if not exists uploads (
  id serial primary key,
  space_id int not null references spaces(id) on delete cascade,
  stream_id int not null references streams(id) on delete cascade,
  file text not null,
  bytes bigint not null,
  sha256 text not null,
  status text not null,
  done_lines int not null default 0,
  total_lines int not null default 0,
  created int not null default 0,
  duplicates int not null default 0,
  dropped int not null default 0,
  failed int not null default 0,
  at_ms bigint not null
);
create table if not exists snapshots (
  id text primary key,
  space_id int not null references spaces(id) on delete cascade,
  stream_name text not null,
  params jsonb not null,
  events jsonb not null,
  total int not null,
  partial boolean not null default false,
  skipped_generations int not null default 0,
  created_ms bigint not null,
  last_used_ms bigint not null
);
create table if not exists rules (
  id text primary key,
  space_id int not null references spaces(id) on delete cascade,
  name text not null,
  spec jsonb not null,
  checks int not null default 0,
  last_check jsonb,
  unique (space_id, name)
);
create table if not exists rule_groups (
  id serial primary key,
  rule_id text not null references rules(id) on delete cascade,
  group_name text not null,
  state text not null,
  since_ms bigint not null,
  boundary_ms bigint,
  pending_count int not null default 0,
  flapping boolean not null default false,
  snoozed_until_ms bigint,
  snooze_recovered boolean not null default false,
  last_action_ms bigint,
  held_window text,
  changes jsonb not null default '[]',
  acknowledged_by text,
  unique (rule_id, group_name)
);
create table if not exists rule_history (
  id bigserial primary key,
  rule_id text not null references rules(id) on delete cascade,
  group_name text not null,
  check_no int not null,
  at_ms bigint not null,
  from_state text not null,
  to_state text not null
);
create table if not exists maintenance (
  id text primary key,
  space_id int not null references spaces(id) on delete cascade,
  name text not null,
  time_zone text not null,
  days jsonb not null,
  start text not null,
  duration_ms bigint not null,
  rule_id text not null references rules(id) on delete cascade
);
create table if not exists inbox (
  id bigserial primary key,
  space_id int not null references spaces(id) on delete cascade,
  rule_id text not null references rules(id) on delete cascade,
  rule_name text not null,
  group_name text not null,
  text text not null,
  at_ms bigint not null,
  acknowledged_by text
);
create table if not exists cases (
  id serial primary key,
  space_id int not null references spaces(id) on delete cascade,
  number int not null,
  title text not null,
  status text not null,
  created_ms bigint not null,
  unique (space_id, number)
);
create table if not exists case_items (
  id bigserial primary key,
  case_id int not null references cases(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  at_ms bigint not null
);
create table if not exists traces (
  id serial primary key,
  space_id int not null references spaces(id) on delete cascade,
  trace_id text not null,
  spans jsonb not null,
  at_ms bigint not null,
  unique (space_id, trace_id)
);
create table if not exists objectives (
  id text primary key,
  space_id int not null references spaces(id) on delete cascade,
  service text not null,
  name text not null,
  stream_name text not null,
  target numeric not null,
  objective_window_ms bigint not null,
  bad jsonb not null,
  counts jsonb,
  unique (space_id, service)
);
create table if not exists saved_searches (
  id text primary key,
  space_id int not null references spaces(id) on delete cascade,
  name text not null,
  stream_name text not null,
  q text not null default '',
  filters jsonb not null default '[]',
  from_iso text not null,
  to_iso text not null
);
create table if not exists api_keys (
  id text primary key,
  space_id int not null references spaces(id) on delete cascade,
  name text not null,
  key_hash text not null,
  stream_pattern text not null,
  actions jsonb not null,
  created_ms bigint not null,
  expires_ms bigint,
  revoked boolean not null default false,
  last4 text not null
);
`;

export async function applySchema(): Promise<void> {
  await query(SCHEMA);
}
