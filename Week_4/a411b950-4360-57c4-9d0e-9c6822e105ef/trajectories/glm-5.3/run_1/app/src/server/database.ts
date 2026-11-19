import { Pool, PoolClient } from "pg";
import { QueryResultRow } from "./pg-types.js";
import { AppConfig } from "./config.js";

/**
 * PostgreSQL access. The pool survives outages: requests fail with
 * database_unavailable and the pool keeps reconnecting (DP-44).
 */
export class Database {
  private readonly pool: Pool;
  private healthy = false;

  constructor(private readonly config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });
    this.pool.on("error", () => {
      this.healthy = false;
    });
  }

  async query<Row extends QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
    const result = await this.pool.query(text, params as unknown[]);
    return result.rows as Row[];
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is already unusable; the pool will discard it.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      this.healthy = true;
      return true;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  get isHealthy(): boolean {
    return this.healthy;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
