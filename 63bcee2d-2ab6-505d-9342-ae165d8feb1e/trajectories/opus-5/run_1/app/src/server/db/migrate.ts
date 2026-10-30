import { pool } from './pool.js';
import { SCHEMA_STATEMENTS } from './schema.js';

const SCHEMA_LOCK = 728_311_045;

/**
 * Applies the schema under an advisory lock, so copies of the app starting at
 * the same moment do not race each other.
 */
export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
    for (const statement of SCHEMA_STATEMENTS) {
      await client.query(statement);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}

export async function waitForPostgres(onWait: () => void): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      onWait();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
