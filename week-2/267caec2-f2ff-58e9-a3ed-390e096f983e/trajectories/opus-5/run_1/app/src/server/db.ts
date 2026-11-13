import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Pool, types, type PoolClient } from 'pg';
import { config } from './config';

types.setTypeParser(types.builtins.DATE, (value) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = Pool | PoolClient;

export async function applySchema(): Promise<void> {
  const sql = await readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export async function inTransaction<T>(run: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function lockKey(id: string): bigint {
  const digest = createHash('sha256').update(id).digest();
  return digest.readBigInt64BE(0);
}

/** Serialises competing writes that touch one entry or round across requests. */
export async function withLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const key = lockKey(id);
  try {
    await client.query('SELECT pg_advisory_lock($1)', [key.toString()]);
    return await run();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [key.toString()]);
    client.release();
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}
