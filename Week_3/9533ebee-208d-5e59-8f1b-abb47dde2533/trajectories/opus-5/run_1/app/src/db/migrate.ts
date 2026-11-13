/**
 * Applies the schema and the seed on serve when the database is empty,
 * exactly once, even when several servers start against the same empty
 * database at once. A non-empty database is left untouched.
 */

import schemaSql from './schema.sql';
import { query, transaction, withAdvisoryLock, writeInstant } from './pool.ts';
import { seed } from './seed.ts';

/** One fixed key, so every booting process waits on the same lock. */
const SEED_LOCK_KEY = 0x9211_0007n;

async function seedApplied(): Promise<boolean> {
  const result = await query<{ applied: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'schema_meta'
     ) AS applied`,
  );
  if (result.rows[0]?.applied !== true) return false;
  const row = await query<{ present: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM schema_meta WHERE id = 1) AS present',
  );
  return row.rows[0]?.present === true;
}

/** Resolves once the schema and seed are in place. */
export async function applySchemaAndSeed(): Promise<void> {
  if (await seedApplied()) return;
  await withAdvisoryLock(SEED_LOCK_KEY, async () => {
    if (await seedApplied()) return;
    const nowMs = Date.now();
    await transaction(async (client) => {
      await client.query(schemaSql);
      await seed(client, nowMs);
      await client.query('INSERT INTO schema_meta (id, applied_at) VALUES (1, $1)', [
        writeInstant(nowMs),
      ]);
    });
  });
}
