/** Postgres: one pool, transactions, and the schema applied idempotently on every serve. */
import pg from 'pg'
import { config } from './config'
import { SCHEMA } from './schema'

pg.types.setTypeParser(20, (value) => Number(value))

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 })
pool.on('error', () => undefined)
pool.on('connect', (client) => client.on('error', () => undefined))

export type Db = Pick<pg.Pool, 'query'>
type Row = Record<string, unknown>

export async function rows<T = Row>(db: Db, text: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query(text, values)).rows as T[]
}

export async function one<T = Row>(db: Db, text: string, values: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, text, values))[0]
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

const DOWN_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006'])

/** True when an error means Postgres itself is unreachable. */
export function isDatabaseDown(error: unknown): boolean {
  const { code, message } = error as { code?: string; message?: string }
  return (code !== undefined && DOWN_CODES.has(code)) || /Connection terminated|timeout exceeded when trying to connect|ECONNREFUSED/.test(message ?? '')
}

/** Schema and seed run under one advisory lock, since instances share a database. */
export async function migrate(seed: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(7203441)')
    await client.query(SCHEMA)
    await seed(client)
  } finally {
    await client.query('SELECT pg_advisory_unlock(7203441)').catch(() => undefined)
    client.release()
  }
}
