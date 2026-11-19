// Database access layer. All SQL lives here; domain modules call these helpers.
import { Pool, type PoolClient, type QueryResult } from 'pg';

export interface Row {
  [column: string]: unknown;
}

export class Db {
  readonly pool: Pool;
  private connected = false;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30000 });
    // A failed connection must not crash the process: callers treat DB errors per request.
    this.pool.on('error', () => {});
  }

  async waitUntilConnected(retryMillis: number, log: (message: string) => void): Promise<void> {
    for (;;) {
      try {
        await this.pool.query('SELECT 1');
        this.connected = true;
        return;
      } catch (err) {
        log(`postgres unreachable (${errorMessage(err)}); retrying`);
        await sleep(retryMillis);
      }
    }
  }

  async query<T extends object = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result: QueryResult<T> = (await this.pool.query(sql, params)) as QueryResult<T>;
    return result.rows;
  }

  async one<T extends object = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length === 0 ? null : rows[0]!;
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(sql, params);
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      const result = await fn(client);
      client.release();
      return result;
    } catch (err) {
      client.release();
      throw err;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}


export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
