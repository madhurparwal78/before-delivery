import pg from 'pg';
import { SCHEMA } from './schema.ts';
import { seed } from './seed.ts';

// DATE columns stay as 'YYYY-MM-DD' text; the server never parses them with a time zone.
pg.types.setTypeParser(1082, (value) => value);

export type Db = pg.PoolClient | pg.Pool;
export type Row = Record<string, unknown>;

/** PostgreSQL's unique-violation error, which a concurrent duplicate insert raises. */
export const isUniqueViolation = (error: unknown): boolean => error instanceof pg.DatabaseError && error.code === '23505';

/** The single row a statement is known to return (INSERT ... RETURNING, an aggregate). */
export const only = (rows: Row[]): Row => rows[0] as Row;

let pool: pg.Pool | null = null;

export function database(): pg.Pool {
  if (!pool) throw new Error('database not connected');
  return pool;
}

const SCHEMA_LOCK = 7_204_001;

/** PostgreSQL is required: retry every second until it answers, then apply the schema and seed once. */
export async function connectDatabase(url: string): Promise<void> {
  const candidate = new pg.Pool({ connectionString: url, max: 12, idleTimeoutMillis: 30_000 });
  candidate.on('error', () => undefined);
  // A connection that drops mid-query rejects that query; its error event must not crash the worker.
  candidate.on('connect', (client) => client.on('error', () => undefined));
  for (;;) {
    try {
      const client = await candidate.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
        try {
          await client.query(SCHEMA);
          await seed(client);
        } finally {
          await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
        }
      } finally {
        client.release();
      }
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  pool = candidate;
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises every write to one board (cards, ranks, lists, memberships) so check-then-write is atomic. */
export async function lockBoard(client: pg.PoolClient, boardId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`board:${boardId}`]);
}

export async function lockWorkspace(client: pg.PoolClient, workspaceId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`workspace:${workspaceId}`]);
}

