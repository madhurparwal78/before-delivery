import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(20, (value) => Number(value));

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });

// A connection that Postgres drops while idle is replaced by the pool; without a listener Node would exit on it.
pool.on('error', (error) => console.error('idle database connection failed', error.message));

export interface Queryable {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<Row>>;
}

export const db = {
  query: <Row extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) => pool.query<Row>(sql, params),
  async tx<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
  async close(): Promise<void> {
    await pool.end();
  },
};

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, seq bigserial, name text NOT NULL, email text NOT NULL,
  password_hash text NOT NULL, confirmed boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS confirm_tokens (token text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, clock_offset_ms bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS members (
  workspace_id text NOT NULL REFERENCES workspaces(id), user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL, seq bigserial, PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), email text NOT NULL, role text NOT NULL,
  token text NOT NULL UNIQUE, inviter_id text NOT NULL REFERENCES users(id), seq bigserial);
CREATE TABLE IF NOT EXISTS data_tables (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL,
  columns jsonb NOT NULL, row_seq int NOT NULL DEFAULT 0, seq bigserial);
CREATE TABLE IF NOT EXISTS table_rows (
  table_id text NOT NULL REFERENCES data_tables(id), row_id text NOT NULL, seq int NOT NULL,
  cells jsonb NOT NULL, PRIMARY KEY (table_id, row_id));
CREATE TABLE IF NOT EXISTS automations (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL,
  trigger_kind text NOT NULL, seq bigserial, draft jsonb NOT NULL, revision int NOT NULL DEFAULT 0,
  run_counter int NOT NULL DEFAULT 0, live_version int, live_revision int,
  live_form_path text, live_hook_path text, live_table text,
  schedule_next_at bigint, schedule_owner text);
CREATE UNIQUE INDEX IF NOT EXISTS automations_live_form ON automations (workspace_id, live_form_path) WHERE live_form_path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS automations_live_hook ON automations (workspace_id, live_hook_path) WHERE live_hook_path IS NOT NULL;
CREATE TABLE IF NOT EXISTS versions (
  automation_id text NOT NULL REFERENCES automations(id), version int NOT NULL, content jsonb NOT NULL,
  revision int NOT NULL, published_at bigint NOT NULL, PRIMARY KEY (automation_id, version));
CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), automation_id text NOT NULL REFERENCES automations(id),
  number int NOT NULL, status text NOT NULL, test boolean NOT NULL, version int, replay_of text,
  started_at bigint NOT NULL, finished_at bigint, message text, failed_step text,
  trigger_output jsonb NOT NULL, content jsonb NOT NULL, owner_instance text NOT NULL, timer_at bigint,
  UNIQUE (automation_id, number));
CREATE INDEX IF NOT EXISTS runs_by_workspace ON runs (workspace_id, started_at DESC, number DESC);
CREATE INDEX IF NOT EXISTS runs_by_timer ON runs (owner_instance, timer_at) WHERE timer_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS runs_by_automation ON runs (automation_id, status);
CREATE TABLE IF NOT EXISTS executions (
  run_id text NOT NULL REFERENCES runs(id), seq int NOT NULL, step_id text NOT NULL, status text NOT NULL,
  reused boolean NOT NULL DEFAULT false, placeholder boolean NOT NULL DEFAULT false,
  input jsonb NOT NULL DEFAULT '{}'::jsonb, output jsonb, log jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempts int NOT NULL DEFAULT 0, started_at bigint, finished_at bigint, due_at bigint, retry_at bigint,
  PRIMARY KEY (run_id, seq));
CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text NOT NULL, hook_path text NOT NULL, idem_key text NOT NULL, body bytea NOT NULL,
  run_id text NOT NULL, first_at bigint NOT NULL, PRIMARY KEY (workspace_id, hook_path, idem_key));
CREATE TABLE IF NOT EXISTS schedule_claims (
  automation_id text NOT NULL, instant bigint NOT NULL, PRIMARY KEY (automation_id, instant));
CREATE TABLE IF NOT EXISTS edit_holds (
  automation_id text NOT NULL, step_id text NOT NULL, user_id text NOT NULL, held_at bigint NOT NULL,
  PRIMARY KEY (automation_id, step_id));
`;

const SCHEMA_LOCK = 7_272_001;
const BOOT_ATTEMPTS = 60;
const BOOT_PAUSE_MS = 500;

/** Waits for Postgres (30 seconds at most), then creates the schema once even when several instances boot together. */
export async function prepareDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
        await client.query(SCHEMA);
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
      } finally {
        client.release();
      }
      return;
    } catch (error) {
      if (attempt >= BOOT_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, BOOT_PAUSE_MS));
    }
  }
}
