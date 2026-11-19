import pg from 'pg';

const { Pool } = pg;

export type Db = pg.Pool;

let pool: Db | null = null;

export function getDb(connectionString: string): Db {
  if (!pool) {
    pool = new Pool({ connectionString, max: 10 });
    pool.on('error', () => {
      // A client error (e.g. terminated connection) must not crash the process.
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow>(db: Db, text: string, params: unknown[]): Promise<pg.QueryResult<T>> {
  return db.query<T>(text, params as never[]);
}

export async function one<T extends pg.QueryResultRow>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query<T>(text, params as never[]);
  return r.rows[0] ?? null;
}

export async function many<T extends pg.QueryResultRow>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query<T>(text, params as never[]);
  return r.rows;
}
