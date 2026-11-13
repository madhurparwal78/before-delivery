import { timingSafeEqual } from 'node:crypto';
import { MESSAGES } from '../../shared/messages';
import { advanceClock, resetClock } from '../clock';
import { config } from '../config';
import { pool } from '../db';
import { invalid, json, notFound, router, storageDown, type Ctx } from '../http';
import { seed } from '../seed';
import { storage } from '../services';

/** The grading routes are hidden (404) without the right key. */
function requireGradingKey(ctx: Ctx): void {
  const given = Buffer.from(ctx.header('x-grading-key') ?? '');
  const expected = Buffer.from(config.gradingKey);
  if (expected.length === 0 || given.length !== expected.length || !timingSafeEqual(given, expected)) notFound();
}

async function emptyStore(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE app_clock IN ACCESS EXCLUSIVE MODE');
    const tables = await client.query<{ tablename: string }>('SELECT tablename FROM pg_tables WHERE schemaname = current_schema()');
    await client.query(`TRUNCATE ${tables.rows.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    await resetClock(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

router.post('/api/grading/reset', async (ctx) => {
  requireGradingKey(ctx);
  await emptyStore();
  await storage.emptyBucket().catch(() => undefined);
  return json(200, { status: 'reset' });
});

router.post('/api/grading/seed', async (ctx) => {
  requireGradingKey(ctx);
  if (!(await storage.healthy())) return storageDown(MESSAGES.storageUploads);
  return json(201, await seed());
});

router.post('/api/grading/clock', async (ctx) => {
  requireGradingKey(ctx);
  const { advanceMs } = await ctx.jsonObject();
  if (typeof advanceMs !== 'number' || !Number.isInteger(advanceMs) || advanceMs < 0) return invalid('advanceMs', MESSAGES.invalidValue);
  return json(200, { now: (await advanceClock(advanceMs)).toISOString() });
});
