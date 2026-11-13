import { Pool, PoolClient, QueryResult } from 'pg';
import { applySchema } from '../schema.js';

/**
 * Postgres is the single source of truth. Every query goes through here, and
 * every failure is reported to callers so they can degrade per the brief.
 */
export class Postgres {
  private pool: Pool | null = null;
  private connecting: Promise<Pool> | null = null;

  async ensure(): Promise<Pool> {
    if (this.pool) return this.pool;
    if (!this.connecting) {
      this.connecting = (async () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is not set');
        const pool = new Pool({
          connectionString: url,
          max: 10,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
        });
        pool.on('error', () => {
          // pool-level errors surface through query failures
        });
        await applySchema(pool);
        this.pool = pool;
        return pool;
      })();
      this.connecting.catch(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    const pool = await this.ensure();
    return pool.query(text, params as never[]);
  }

  async connect(): Promise<PoolClient> {
    const pool = await this.ensure();
    return pool.connect();
  }

  async healthy(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  static bigIntToNumber(value: string | number): number {
    return typeof value === 'number' ? value : Number(value);
  }
}
