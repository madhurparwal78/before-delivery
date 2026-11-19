import pg from 'pg';

export interface Queryable {
  /** All rows. */
  rows<R extends object>(text: string, values?: unknown[]): Promise<R[]>;
  /** The first row, or null. */
  row<R extends object>(text: string, values?: unknown[]): Promise<R | null>;
  /** Runs a statement and returns the number of rows it touched. */
  exec(text: string, values?: unknown[]): Promise<number>;
}

class Executor implements Queryable {
  constructor(private readonly target: pg.Pool | pg.PoolClient) {}

  async rows<R extends object>(text: string, values: unknown[] = []): Promise<R[]> {
    const result = await this.target.query<R & pg.QueryResultRow>(text, values);
    return result.rows;
  }

  async row<R extends object>(text: string, values: unknown[] = []): Promise<R | null> {
    return (await this.rows<R>(text, values))[0] ?? null;
  }

  async exec(text: string, values: unknown[] = []): Promise<number> {
    const result = await this.target.query(text, values);
    return result.rowCount ?? 0;
  }
}

export class Database extends Executor {
  private connected = false;
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 3000 });
    pool.on('error', () => undefined);
    super(pool);
    this.pool = pool;
  }

  get ready(): boolean {
    return this.connected;
  }

  /** Retries every second until PostgreSQL answers, then applies the schema (idempotent) and flips `ready`. */
  async connect(schema: readonly string[]): Promise<void> {
    for (;;) {
      try {
        await this.pool.query('SELECT 1');
        for (const statement of schema) await this.pool.query(statement);
        this.connected = true;
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /** One transaction: commits when `work` resolves, rolls back when it throws. */
  async transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new Executor(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
