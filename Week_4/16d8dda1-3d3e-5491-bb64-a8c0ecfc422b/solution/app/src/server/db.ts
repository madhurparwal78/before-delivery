import pg from 'pg';
import { config } from './config';

pg.types.setTypeParser(20, (value) => Number(value));

export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on('error', (error) => console.error('postgres pool error', error.message));

export async function rows<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const found = await rows<T>(db, sql, params);
  return found[0] ?? null;
}

/** The row of a query that always answers one: an aggregate such as `count(*)`. */
export async function sole<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const found = await one<T>(db, sql, params);
  if (!found) throw new Error(`The query answered no row: ${sql}`);
  return found;
}

/** `SELECT count(*) AS n ...` as a number. */
export async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  return (await sole<{ n: number }>(db, sql, params)).n;
}

export async function run(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query(sql, params);
  return result.rowCount ?? 0;
}

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (id text PRIMARY KEY, clock_ms bigint);
INSERT INTO worlds (id) VALUES ('wld_default') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS teachers (
  id text PRIMARY KEY, world_id text NOT NULL REFERENCES worlds(id), email text NOT NULL, email_key text NOT NULL UNIQUE,
  password_hash text NOT NULL, display_name text NOT NULL);
CREATE TABLE IF NOT EXISTS learners (
  id text PRIMARY KEY, world_id text NOT NULL REFERENCES worlds(id), display_name text NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token text PRIMARY KEY, kind text NOT NULL, person_id text NOT NULL, created_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS grading_tokens (
  token text PRIMARY KEY, kind text NOT NULL, person_id text NOT NULL, used boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS classes (
  id text PRIMARY KEY, world_id text NOT NULL REFERENCES worlds(id), owner_id text NOT NULL REFERENCES teachers(id),
  title text NOT NULL, time_zone text NOT NULL, code text NOT NULL UNIQUE, layout jsonb NOT NULL, created_seq bigserial);
CREATE TABLE IF NOT EXISTS co_teachers (
  class_id text NOT NULL REFERENCES classes(id), teacher_id text NOT NULL REFERENCES teachers(id), PRIMARY KEY (class_id, teacher_id));
CREATE TABLE IF NOT EXISTS enrolments (
  class_id text NOT NULL REFERENCES classes(id), learner_id text NOT NULL REFERENCES learners(id), PRIMARY KEY (class_id, learner_id));
CREATE TABLE IF NOT EXISTS lessons (
  id text PRIMARY KEY, class_id text NOT NULL REFERENCES classes(id), title text NOT NULL,
  ready boolean NOT NULL DEFAULT false, created_seq bigserial);
CREATE TABLE IF NOT EXISTS lesson_files (
  id text PRIMARY KEY, lesson_id text NOT NULL REFERENCES lessons(id), name text NOT NULL, kind text NOT NULL,
  position integer NOT NULL, bytes bigint NOT NULL, status text NOT NULL, content_type text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, class_id text NOT NULL REFERENCES classes(id), lesson_id text NOT NULL REFERENCES lessons(id),
  state text NOT NULL, starts_local text NOT NULL, ends_local text NOT NULL, starts_ms bigint NOT NULL, ends_ms bigint NOT NULL,
  current_slide integer NOT NULL DEFAULT 1, locked boolean NOT NULL DEFAULT false, final_seats jsonb, created_seq bigserial);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_session ON sessions (class_id) WHERE state IN ('open', 'live', 'breakouts');
CREATE TABLE IF NOT EXISTS session_learners (
  session_id text NOT NULL REFERENCES sessions(id), learner_id text NOT NULL REFERENCES learners(id),
  joined boolean NOT NULL DEFAULT false, PRIMARY KEY (session_id, learner_id));
CREATE TABLE IF NOT EXISTS presence_intervals (
  id bigserial PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id), learner_id text NOT NULL REFERENCES learners(id),
  joined_ms bigint NOT NULL, left_ms bigint, grace_seconds integer, settled boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS presence_by_session ON presence_intervals (session_id, learner_id);
CREATE TABLE IF NOT EXISTS polls (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id), question text NOT NULL, options jsonb NOT NULL,
  state text NOT NULL, counts jsonb, results jsonb, total integer, created_seq bigserial);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_poll ON polls (session_id) WHERE state = 'open';
CREATE TABLE IF NOT EXISTS poll_answers (
  poll_id text NOT NULL REFERENCES polls(id), learner_id text NOT NULL REFERENCES learners(id), option integer NOT NULL,
  PRIMARY KEY (poll_id, learner_id));
CREATE TABLE IF NOT EXISTS hand_takes (
  id bigserial PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id), learner_id text NOT NULL, taken_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS breakout_rounds (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id), tables integer NOT NULL, started_ms bigint NOT NULL,
  deadline_ms bigint NOT NULL, length_seconds integer NOT NULL, warning_seconds integer NOT NULL, warned boolean NOT NULL DEFAULT false, ended_ms bigint,
  created_seq bigserial);
CREATE TABLE IF NOT EXISTS breakout_assignments (
  round_id text NOT NULL REFERENCES breakout_rounds(id), learner_id text NOT NULL, table_id text NOT NULL,
  PRIMARY KEY (round_id, learner_id));
CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY, round_id text NOT NULL REFERENCES breakout_rounds(id), table_id text NOT NULL, author text NOT NULL,
  text text NOT NULL, sent_ms bigint NOT NULL, created_seq bigserial);
CREATE TABLE IF NOT EXISTS session_attendance (
  session_id text NOT NULL REFERENCES sessions(id), learner_id text NOT NULL REFERENCES learners(id), status text NOT NULL,
  first_joined_ms bigint, last_left_ms bigint, visits integer NOT NULL, PRIMARY KEY (session_id, learner_id));
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id text PRIMARY KEY REFERENCES sessions(id), present integer NOT NULL, late integer NOT NULL, left_early integer NOT NULL,
  late_left_early integer NOT NULL, absent integer NOT NULL, hands_taken integer NOT NULL, breakout_rounds integer NOT NULL);
`;

export async function ensureSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(SCHEMA);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => undefined);
    client.release();
  }
}
