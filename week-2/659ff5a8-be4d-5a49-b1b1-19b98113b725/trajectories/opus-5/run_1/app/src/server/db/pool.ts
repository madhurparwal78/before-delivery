import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config';

const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
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

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: string; constraint?: string };
  if (candidate.code !== '23505') return false;
  return constraint === undefined || candidate.constraint === constraint;
}

export async function waitForDatabase(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

export async function applySchema(): Promise<void> {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}
