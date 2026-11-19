// One Postgres pool and one place for every query the server runs.

import pg from 'pg';
import { applySchema } from './schema.ts';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

let pool: Pool | null = null;

export async function openPool(databaseUrl: string): Promise<Pool> {
  if (pool !== null) return pool;
  pool = new pg.Pool({ connectionString: databaseUrl, max: 20 });
  for (;;) {
    try {
      await applySchema(pool);
      return pool;
    } catch (error) {
      console.error('postgres unavailable, retrying in 2s', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export function getPool(): Pool {
  if (pool === null) throw new Error('pool not open');
  return pool;
}

export function newId(prefix: string): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `${prefix}${Array.from(bytes, (b) => b.toString(36)).join('')}`;
}
