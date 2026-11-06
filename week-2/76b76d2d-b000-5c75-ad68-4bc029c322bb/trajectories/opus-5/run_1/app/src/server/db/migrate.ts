import { pool, transaction } from './pool.ts';
import { SCHEMA_SQL } from './schema.ts';
import { seedIfEmpty } from './seed.ts';

let ready = false;

export function schemaReady(): boolean {
  return ready;
}

export async function migrate(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query(SCHEMA_SQL);
      } finally {
        client.release();
      }
      await transaction(async (tx) => {
        await seedIfEmpty(tx);
      });
      ready = true;
      return;
    } catch (error) {
      process.stderr.write(`waiting for database: ${(error as Error).message}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
