import { Pool, type PoolClient } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 20 });
export { pool };

export type DbClient = PoolClient;

export async function withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    try {
      const result = await fn(tx);
      await tx.query('COMMIT');
      return result;
    } catch (e) {
      await tx.query('ROLLBACK');
      throw e;
    }
  } finally {
    tx.release();
  }
}

export async function applySchema(): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  // In the built tree schema.sql sits next to the source's package root.
  const candidates = [path.join(here, 'schema.sql'), path.join(here, '..', 'server', 'schema.sql')];
  let sql: string | null = null;
  for (const candidate of candidates) {
    try {
      sql = fs.readFileSync(candidate, 'utf8');
      break;
    } catch {
      // try the next candidate
    }
  }
  if (sql === null) throw new Error('schema.sql not found');
  await pool.query(sql);
}
