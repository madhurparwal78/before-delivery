import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';
import { ApiError } from './errors.js';

const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 2000 });

let ready = false;

export const databaseReady = (): boolean => ready;

const SCHEMA = `
create table if not exists accounts (
  id uuid primary key,
  kind text not null,
  display_name text not null,
  email text,
  email_lower text,
  password_hash text,
  email_verified boolean not null default false,
  classroom_id uuid,
  nickname text,
  nickname_key text,
  last_verification_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists accounts_email_lower_idx on accounts (email_lower) where email_lower is not null;

create table if not exists classrooms (
  id uuid primary key,
  name text not null,
  time_zone text not null,
  join_code text not null,
  join_opens_local text not null,
  join_closes_local text not null,
  hand_in_local text not null,
  join_opens_at timestamptz not null,
  join_closes_at timestamptz not null,
  hand_in_at timestamptz not null,
  archived boolean not null default false,
  owner_id uuid not null,
  created_at timestamptz not null default now()
);
create unique index if not exists classrooms_join_code_idx on classrooms (upper(join_code)) where archived = false;

create unique index if not exists accounts_nickname_idx
  on accounts (classroom_id, nickname_key) where kind = 'student';

create table if not exists classroom_educators (
  classroom_id uuid not null,
  educator_id uuid not null,
  role text not null,
  added_at timestamptz not null default now(),
  primary key (classroom_id, educator_id)
);

create table if not exists verification_tokens (
  token text primary key,
  account_id uuid not null,
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  consumed boolean not null default false,
  replaced boolean not null default false
);

create table if not exists sessions (
  token text primary key,
  account_id uuid,
  pending_classroom_id uuid,
  ended_reason text,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key,
  owner_id uuid not null,
  classroom_id uuid,
  kind text not null,
  name text not null,
  revision integer not null,
  saved_at timestamptz not null,
  handed_in boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists project_revisions (
  project_id uuid not null,
  revision integer not null,
  object_key text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, revision)
);

create table if not exists exports (
  id uuid primary key,
  owner_id uuid not null,
  project_id uuid,
  file_name text not null,
  format text not null,
  unit text not null,
  bytes integer not null,
  triangle_count integer,
  bbox_x double precision,
  bbox_y double precision,
  bbox_z double precision,
  object_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists idempotency_keys (
  project_id uuid not null,
  account_id uuid not null,
  key text not null,
  body_hash text not null,
  response_json text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, account_id, key)
);

create table if not exists join_attempts (
  id bigserial primary key,
  client_ip text not null,
  attempted_at timestamptz not null
);
create index if not exists join_attempts_ip_idx on join_attempts (client_ip, attempted_at);

create table if not exists orphan_objects (
  object_key text primary key,
  noticed_at timestamptz not null default now()
);
`;

export const applySchema = async (): Promise<void> => {
  await pool.query(SCHEMA);
  ready = true;
};

/** Applies the schema on every serve start, retrying until Postgres answers. */
export const startDatabase = (): void => {
  const attempt = (): void => {
    applySchema().catch((error: unknown) => {
      ready = false;
      process.stderr.write(`[quarkyard] database not ready: ${String(error)}\n`);
      setTimeout(attempt, 2000);
    });
  };
  attempt();
};

const unavailable = (): ApiError => new ApiError(503, 'database_unavailable');

export const query = async <R extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<R[]> => {
  if (!ready) throw unavailable();
  try {
    const result = await pool.query<R>(text, params as unknown[]);
    return result.rows;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isConnectionProblem(error)) {
      ready = false;
      startDatabase();
      throw unavailable();
    }
    throw error;
  }
};

export const queryOne = async <R extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<R | null> => {
  const rows = await query<R>(text, params);
  return rows.length > 0 ? rows[0] : null;
};

export const withTransaction = async <T>(run: (client: PoolClient) => Promise<T>): Promise<T> => {
  if (!ready) throw unavailable();
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isConnectionProblem(error)) {
      ready = false;
      startDatabase();
      throw unavailable();
    }
    throw error;
  }
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const databaseAnswers = async (): Promise<boolean> => {
  try {
    await pool.query('select 1');
    return ready;
  } catch {
    return false;
  }
};

const isConnectionProblem = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? '';
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === '57P01' ||
    code === '57P03' ||
    code === '53300' ||
    message.includes('Connection terminated') ||
    message.includes('timeout exceeded')
  );
};
