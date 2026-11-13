import pg from 'pg';
import { config } from './config';
import { ApiError } from './errors';

const SCHEMA = `
create table if not exists players (
  id uuid primary key,
  email text not null,
  email_lower text not null unique,
  display_name text not null,
  display_name_lower text not null unique,
  password_hash text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists auth_tokens (
  token text primary key,
  player_id uuid not null references players(id) on delete cascade,
  kind text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id uuid primary key,
  player_id uuid not null references players(id) on delete cascade,
  mode text not null,
  level text not null,
  puzzle_id text not null,
  daily_date date,
  status text not null,
  start_board jsonb not null,
  moves jsonb not null default '[]'::jsonb,
  elapsed_ms integer not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists games_player_level on games (player_id, level);

create unique index if not exists games_player_daily
  on games (player_id, daily_date) where daily_date is not null;

create table if not exists results (
  id uuid primary key,
  game_id uuid unique references games (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  mode text not null,
  level text not null,
  outcome text not null,
  seconds integer not null,
  mistakes integer not null,
  hints integer not null,
  score integer,
  finished_at timestamptz not null,
  daily_date date,
  daily_state text
);

create index if not exists results_player on results (player_id);

create index if not exists results_daily on results (daily_date) where daily_date is not null;

create table if not exists duel_outcomes (
  id uuid primary key,
  code text not null,
  level text not null,
  state text not null,
  winner_player_id uuid references players (id) on delete set null,
  seconds integer,
  created_at timestamptz not null default now()
);
`;

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
});

pool.on('error', () => {
  up = false;
});

let up = false;
let schemaApplied = false;

export function isPostgresUp(): boolean {
  return up;
}

export async function query<Row extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<pg.QueryResult<Row>> {
  try {
    const result = await pool.query<Row>(sql, params as unknown[]);
    up = true;
    return result;
  } catch (cause) {
    if (isConnectionProblem(cause)) {
      up = false;
      throw new ApiError('STORAGE_UNAVAILABLE');
    }
    throw cause;
  }
}

export async function withTransaction<T>(
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (cause) {
    if (isConnectionProblem(cause)) {
      up = false;
      throw new ApiError('STORAGE_UNAVAILABLE');
    }
    throw cause;
  }
  try {
    await client.query('begin');
    const value = await work(client);
    await client.query('commit');
    up = true;
    return value;
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    if (isConnectionProblem(cause)) {
      up = false;
      throw new ApiError('STORAGE_UNAVAILABLE');
    }
    throw cause;
  } finally {
    client.release();
  }
}

function isConnectionProblem(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  if (cause instanceof ApiError) return false;
  const code = (cause as { code?: string }).code;
  if (code && /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|EPIPE|57P01|57P03|08\w{3})$/.test(code)) {
    return true;
  }
  return /connect|terminat|timeout|closed|shutting down/i.test(cause.message);
}

/** Applies the schema on every start, and keeps retrying until Postgres answers. */
export async function connectPostgres(): Promise<void> {
  try {
    if (!schemaApplied) {
      await pool.query(SCHEMA);
      schemaApplied = true;
    } else {
      await pool.query('select 1');
    }
    up = true;
  } catch {
    up = false;
  }
}
