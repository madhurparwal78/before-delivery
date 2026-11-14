import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { ApiError } from './http.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000 });
pool.on('error', () => undefined);

let ready = false;

export const databaseUnavailable = () =>
  new ApiError(503, {
    error: 'database_unavailable',
    message: 'Runup Bay cannot reach its database. Try again shortly.',
  });

export function newId(): string {
  return randomBytes(9).toString('base64url');
}

export function isReady(): boolean {
  return ready;
}

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code ?? '';
  return (
    /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE)$/.test(code) ||
    code.startsWith('08') ||
    code === '57P01' ||
    /Connection terminated|timeout exceeded when trying to connect|connect ECONNREFUSED/.test(error.message)
  );
}

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!ready) throw databaseUnavailable();
  try {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  } catch (error) {
    if (isConnectionError(error)) throw databaseUnavailable();
    throw error;
  }
}

export async function one<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  reduce_motion boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verify_tokens (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schools (
  id text PRIMARY KEY,
  name text NOT NULL,
  instructor_id text UNIQUE NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS classes (
  id text PRIMARY KEY,
  school_id text NOT NULL REFERENCES schools(id),
  name text NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS class_students (
  class_id text NOT NULL REFERENCES classes(id),
  user_id text NOT NULL REFERENCES users(id),
  seq bigserial,
  PRIMARY KEY (class_id, user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  token text PRIMARY KEY,
  class_id text NOT NULL REFERENCES classes(id),
  email text NOT NULL,
  sent_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS aerodromes (
  id text PRIMARY KEY,
  school_id text REFERENCES schools(id),
  name text NOT NULL,
  code text NOT NULL,
  layout jsonb NOT NULL,
  imported boolean NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS scenarios (
  id text PRIMARY KEY,
  school_id text NOT NULL REFERENCES schools(id),
  data jsonb NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS assignments (
  id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES classes(id),
  scenario_id text NOT NULL REFERENCES scenarios(id),
  due_on text NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS sim_sessions (
  id text PRIMARY KEY,
  school_id text NOT NULL REFERENCES schools(id),
  scenario_id text NOT NULL REFERENCES scenarios(id),
  assignment_id text REFERENCES assignments(id),
  scenario jsonb NOT NULL,
  aerodrome_name text NOT NULL,
  layout jsonb NOT NULL,
  state jsonb NOT NULL,
  status text NOT NULL,
  finished_on text,
  debrief jsonb,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS session_seconds (
  session_id text NOT NULL REFERENCES sim_sessions(id),
  t integer NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (session_id, t)
);
CREATE TABLE IF NOT EXISTS session_participants (
  session_id text NOT NULL REFERENCES sim_sessions(id),
  user_id text NOT NULL REFERENCES users(id),
  position text NOT NULL,
  PRIMARY KEY (session_id, user_id)
);
CREATE TABLE IF NOT EXISTS command_history (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sim_sessions(id),
  position text NOT NULL,
  text text NOT NULL
);
CREATE INDEX IF NOT EXISTS command_history_seat ON command_history (session_id, position, id);
CREATE TABLE IF NOT EXISTS grading_keys (
  kind text NOT NULL,
  key text NOT NULL,
  id text NOT NULL,
  PRIMARY KEY (kind, key)
);
CREATE TABLE IF NOT EXISTS reports (
  session_id text NOT NULL REFERENCES sim_sessions(id),
  kind text NOT NULL,
  user_id text NOT NULL,
  PRIMARY KEY (session_id, kind)
);
`;

async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(7310)');
    try {
      await client.query(SCHEMA);
    } finally {
      await client.query('SELECT pg_advisory_unlock(7310)');
    }
  } finally {
    client.release();
  }
}

export async function connectWithRetry(onReady: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      ready = true;
      await onReady();
      return;
    } catch (error) {
      ready = false;
      console.error('Database not ready, retrying:', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
