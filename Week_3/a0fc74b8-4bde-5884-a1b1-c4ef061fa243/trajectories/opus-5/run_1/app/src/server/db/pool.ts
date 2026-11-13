import pg from 'pg';
import { config } from '../config.ts';

pg.types.setTypeParser(1700, (value: string) => Number.parseFloat(value));
pg.types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30000,
});

export type Row = Record<string, unknown>;

export const query = async <T extends Row>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> => {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
};

export const queryOne = async <T extends Row>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> => {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
};

export const withTransaction = async <T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const waitForDatabase = async (timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};
