import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { applySchema } from './schema.js';

export type Db = Pool;
export type { QueryResult, QueryResultRow };

export async function createDb(connectionUrl: string): Promise<Db> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: connectionUrl, max: 20 });
  await applySchema(pool);
  return pool;
}

export async function connectWithRetry(connectionUrl: string, log: (msg: string) => void): Promise<Db> {
  for (;;) {
    try {
      return await createDb(connectionUrl);
    } catch (err) {
      log(`postgres unreachable: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
