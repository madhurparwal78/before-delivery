import pg from 'pg';
import type { Config } from './config.js';

// One pool per process; all shared state lives in PostgreSQL.
const pools = new Map<string, pg.Pool>();

export function pool(config: Config): pg.Pool {
  const key = config.databaseUrl;
  let p = pools.get(key);
  if (!p) {
    p = new pg.Pool({ connectionString: key, max: 10, connectionTimeoutMillis: 5000 });
    p.on('error', () => {
      // Pool errors surface through queries; nothing to do here.
    });
    pools.set(key, p);
  }
  return p;
}

export async function withClient<T>(config: Config, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const p = pool(config);
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow>(config: Config, text: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  const p = pool(config);
  return p.query<T>(text, params as never[]);
}

export async function healthyDatabase(config: Config): Promise<boolean> {
  try {
    await query(config, 'select 1');
    return true;
  } catch {
    return false;
  }
}
