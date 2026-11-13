import { Pool, type PoolClient, type QueryResultRow } from "pg";

export class Database {
  private pool: Pool;
  private ensurePromise: Promise<Pool> | null = null;

  constructor(private databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 20 });
  }

  /** Connect with retries at boot: the health check must not answer 200 until connected. */
  async ensureConnected(): Promise<Pool> {
    if (!this.ensurePromise) {
      this.ensurePromise = (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            const client = await this.pool.connect();
            client.release();
            return this.pool;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, Math.min(500 + attempt * 250, 3000)));
          }
        }
      })();
    }
    return this.ensurePromise;
  }

  async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ensureConnected();
    const result = await this.pool.query<T>(sql, params as never[]);
    return result.rows;
  }

  async one<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ensureConnected();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.query(sql, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
