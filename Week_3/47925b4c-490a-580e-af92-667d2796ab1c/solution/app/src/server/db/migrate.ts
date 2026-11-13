import { pool, query } from './pool.js';
import { SCHEMA_SQL } from './schema.js';
import { seed } from './seed.js';

/** Applies the schema and the seed once, however many processes start at once. */
async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(8431002)');
    await client.query(SCHEMA_SQL);
    await seed(client);
  } finally {
    await client.query('select pg_advisory_unlock(8431002)').catch(() => undefined);
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await query('select 1');
      await applySchema();
      return;
    } catch (error) {
      process.stderr.write(`waiting for the records: ${String((error as Error).message)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}
