import * as pg from 'pg';
import type { Pool, PoolClient } from 'pg';
export type { Pool, PoolClient };

export function createPool(connectionString: string, max = 20): Pool {
  const pool = new pg.Pool({ connectionString, max });
  return pool;
}
