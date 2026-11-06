import pg from 'pg';
import { env } from '../env.ts';

pg.types.setTypeParser(1700, (value: string) => Number(value));
pg.types.setTypeParser(20, (value: string) => Number(value));
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 12 });

export type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export type Tx = {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T | null>;
};

export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const tx: Tx = {
      async query<R extends Row>(sql: string, params: unknown[] = []): Promise<R[]> {
        const result = await client.query(sql, params);
        return result.rows as R[];
      },
      async one<R extends Row>(sql: string, params: unknown[] = []): Promise<R | null> {
        const result = await client.query(sql, params);
        return (result.rows.length > 0 ? result.rows[0] : null) as R | null;
      },
    };
    const value = await run(tx);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function serverNow(): Promise<Date> {
  const row = await one<{ now: Date }>('select now() as now');
  return row === null ? new Date() : row.now;
}
