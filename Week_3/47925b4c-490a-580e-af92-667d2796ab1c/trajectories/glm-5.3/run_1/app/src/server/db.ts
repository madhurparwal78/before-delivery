import { Pool, type PoolClient, type QueryResult } from 'pg';
import { problems, type Problem } from '../shared/problems.js';

// Postgres may restart or kill sessions at any moment; no process needs a restart.
export class Database {
  private readonly poolRef: Pool;
  private connected: boolean = false;

  constructor(connectionString: string) {
    this.poolRef = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      keepAlive: true,
      allowExitOnIdle: false,
    });
    this.poolRef.on('error', () => {
      this.connected = false;
    });
  }

  get isUp(): boolean {
    return this.connected;
  }

  markUp(): void {
    this.connected = true;
  }

  markDown(): void {
    this.connected = false;
  }

  async query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    try {
      const result = await this.poolRef.query<T>(sql, params);
      this.markUp();
      return result;
    } catch (err) {
      this.markDown();
      throw err;
    }
  }

  async connect(): Promise<PoolClient> {
    const client = await this.poolRef.connect();
    this.markUp();
    return client;
  }

  pool(): Pool {
    return this.poolRef;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.poolRef.query('SELECT 1');
      this.markUp();
      return true;
    } catch {
      this.markDown();
      return false;
    }
  }

  // Runs fn with a client; a broken session is reported as database_unavailable.
  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; problem: Problem }> {
    let client: PoolClient;
    try {
      client = await this.poolRef.connect();
    } catch {
      this.markDown();
      return { ok: false, problem: problems.databaseUnavailable() };
    }
    try {
      const value = await fn(client);
      this.markUp();
      return { ok: true, value };
    } catch (err) {
      if (isConnectionError(err)) {
        this.markDown();
        return { ok: false, problem: problems.databaseUnavailable() };
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.poolRef.end();
  }
}

export function isConnectionError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; message?: string };
  if (e.code === '57P01' || e.code === '57P02' || e.code === '57P03' || e.code === '08000' || e.code === '08003' || e.code === '08006' || e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ENOTFOUND') {
    return true;
  }
  return e.code === '57401' || (e.code === undefined && e.message !== undefined && /terminat|connection|socket/i.test(e.message));
}
