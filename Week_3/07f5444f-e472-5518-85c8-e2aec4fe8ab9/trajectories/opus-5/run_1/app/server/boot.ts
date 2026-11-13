import { pool, withTransaction } from './db/pool.js';
import { applySchema } from './db/schema.js';
import { seedIfEmpty } from './db/seed.js';
import { startReminderSweeps } from './services/reminders.js';

const SCHEMA_LOCK = 7_314_291;

export const bootState = { schemaReady: false };

async function applyOnce(): Promise<void> {
  await withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock($1)`, [SCHEMA_LOCK]);
    await applySchema(db);
    await seedIfEmpty(db);
  });
}

/** Keeps retrying until Postgres answers, then applies the schema, seeds and starts sweeps. */
export async function boot(): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await applyOnce();
      bootState.schemaReady = true;
      startReminderSweeps();
      return;
    } catch (error) {
      if (attempt === 0) {
        process.stderr.write(`waiting for Postgres: ${error instanceof Error ? error.message : 'unknown'}\n`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

export async function databaseAnswers(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
