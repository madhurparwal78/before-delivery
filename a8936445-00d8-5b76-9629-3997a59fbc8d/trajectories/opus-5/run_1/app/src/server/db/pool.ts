import pg from 'pg';
import { config } from '../config.js';

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number.parseInt(value, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => value);
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export type Queryable = Pick<pg.PoolClient, 'query'>;
export type Transaction = pg.PoolClient;

export async function withTransaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
