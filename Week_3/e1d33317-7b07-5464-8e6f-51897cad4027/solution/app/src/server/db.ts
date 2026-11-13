// Postgres: one pool, a schema applied idempotently at every start, and the seed score.

import pg from 'pg'
import { DatabaseUnavailable } from './errors.js'
import { config } from './config.js'
import { seedScore } from './seed.js'

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN'])

function isUnavailable(error: unknown): boolean {
  if (error instanceof DatabaseUnavailable) return true
  const e = error as { code?: string; message?: string }
  if (e.code && (NETWORK_CODES.has(e.code) || e.code.startsWith('08') || e.code.startsWith('57') || e.code.startsWith('53'))) return true
  return /timeout|terminated|Connection|ECONN/i.test(e.message ?? '') && !e.code
}

const pool = config.databaseUrl
  ? new pg.Pool({
      connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 3000, idleTimeoutMillis: 5000, allowExitOnIdle: false,
      statement_timeout: 20_000, query_timeout: 25_000,
    })
  : null
pool?.on('error', () => undefined)

let ready = false

export type Queryable = Pick<pg.PoolClient, 'query'>

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = [], client?: Queryable): Promise<T[]> {
  if (!pool || !ready) throw new DatabaseUnavailable()
  try {
    return (await (client ?? pool).query<T>(sql, params)).rows
  } catch (error) {
    throw isUnavailable(error) ? new DatabaseUnavailable(error) : error
  }
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!pool || !ready) throw new DatabaseUnavailable()
  let client: pg.PoolClient
  try {
    client = await pool.connect()
  } catch (error) {
    throw new DatabaseUnavailable(error)
  }
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw isUnavailable(error) ? new DatabaseUnavailable(error) : error
  } finally {
    client.release()
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scores (
  id text PRIMARY KEY, title text NOT NULL, measure_count int NOT NULL, time_signatures jsonb NOT NULL, tempos jsonb NOT NULL,
  lamport int NOT NULL, last_seq int NOT NULL, rev bigint NOT NULL DEFAULT 0, snapshot_seq int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS staves (
  id text PRIMARY KEY, score_id text NOT NULL REFERENCES scores(id), name text NOT NULL, clef text NOT NULL,
  transpose jsonb NOT NULL, part_id text NOT NULL, ord int NOT NULL);
CREATE TABLE IF NOT EXISTS parts (
  id text PRIMARY KEY, score_id text NOT NULL REFERENCES scores(id), name text NOT NULL, status text NOT NULL DEFAULT 'draft',
  revision int NOT NULL DEFAULT 0, extracted_at_lamport int, page_count int, layout jsonb NOT NULL DEFAULT '{"systemBreaks":[],"pageBreaks":[]}',
  layout_changed boolean NOT NULL DEFAULT false, last_error text);
CREATE TABLE IF NOT EXISTS collaborators (
  id text PRIMARY KEY, score_id text NOT NULL REFERENCES scores(id), name text NOT NULL, role text NOT NULL, status text NOT NULL,
  staff_ids jsonb NOT NULL DEFAULT '[]', seat_token text UNIQUE, invite_token text UNIQUE, ack_lamport int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ops (
  score_id text NOT NULL REFERENCES scores(id), seq int NOT NULL, lamport int NOT NULL, site text NOT NULL, type text NOT NULL,
  field text, staff_id text NOT NULL, voice int NOT NULL, payload jsonb NOT NULL, author_id text NOT NULL, at timestamptz NOT NULL DEFAULT now(),
  measure int NOT NULL, beat real NOT NULL, summary text NOT NULL,
  PRIMARY KEY (score_id, seq), UNIQUE (score_id, lamport, site));
CREATE TABLE IF NOT EXISTS snapshots (score_id text NOT NULL REFERENCES scores(id), seq int NOT NULL, state jsonb NOT NULL, PRIMARY KEY (score_id, seq));
CREATE TABLE IF NOT EXISTS connections (
  id text PRIMARY KEY, score_id text NOT NULL, collaborator_id text NOT NULL, instance_id text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS holds (
  score_id text NOT NULL, staff_id text NOT NULL, holder_id text NOT NULL, connection_id text NOT NULL REFERENCES connections(id) ON DELETE CASCADE, since timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (score_id, staff_id));
CREATE TABLE IF NOT EXISTS op_throttle (collaborator_id text PRIMARY KEY, window_start bigint NOT NULL, taken int NOT NULL);
CREATE TABLE IF NOT EXISTS banks (
  id text PRIMARY KEY, score_id text NOT NULL REFERENCES scores(id), staff_id text NOT NULL, file_name text NOT NULL, kind text NOT NULL,
  bytes int NOT NULL, root_pitch text, created_at timestamptz NOT NULL DEFAULT now());
`

async function migrate(): Promise<void> {
  if (!pool) throw new DatabaseUnavailable()
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(7301)')
    await client.query(SCHEMA)
    await seedScore(client)
  } finally {
    await client.query('SELECT pg_advisory_unlock(7301)').catch(() => undefined)
    client.release()
  }
}

/** Applies the schema and the seed, retrying until Postgres answers. Resolves after the first attempt, however it ends. */
export function startDatabase(): Promise<void> {
  return new Promise((first) => {
    const attempt = (): void => {
      migrate().then(
        () => {
          ready = true
          first()
        },
        () => {
          first()
          setTimeout(attempt, 2000).unref()
        },
      )
    }
    attempt()
  })
}

export async function closeDatabase(): Promise<void> {
  await pool?.end().catch(() => undefined)
}
