import { config } from '../config.js';
import { db } from '../db.js';
import { notFound, unprocessable } from '../http.js';
import { advanceBy, now } from '../domain/engine.js';
import { buildSeed, resetAll } from '../domain/seed.js';
import { RequestContext, StoredResponse } from './context.js';

const MAX_ADVANCE_MS = 86400000;

/** Every grading route is key-guarded; a missing or wrong key answers 404. */
export async function handleGrading(
  ctx: RequestContext,
  key: string | undefined,
): Promise<StoredResponse> {
  if (key === undefined || key !== config.gradingKey) throw notFound();
  const [, action] = ctx.segments;
  if (ctx.method === 'POST' && action === 'reset') {
    await resetAll();
    return { status: 200, body: { clock: now().toISOString() } };
  }
  if (ctx.method === 'POST' && action === 'seed') {
    return { status: 200, body: await buildSeed() };
  }
  if (ctx.method === 'POST' && action === 'clock') {
    const advanceMs = ctx.body.advanceMs;
    if (
      typeof advanceMs !== 'number' ||
      !Number.isInteger(advanceMs) ||
      advanceMs < 0 ||
      advanceMs > MAX_ADVANCE_MS
    ) {
      throw unprocessable(
        'advanceMs',
        'Give a whole number of milliseconds from 0 to 86400000.',
      );
    }
    const clock = await advanceBy(advanceMs);
    const { rows } = await db.query<{ id: string; height: number | null }>(
      `SELECT w.id, max(b.height) AS height FROM workspaces w
         LEFT JOIN blocks b ON b.workspace_id = w.id
       GROUP BY w.id`,
    );
    const heights: Record<string, number> = {};
    for (const row of rows) heights[row.id] = row.height ?? 0;
    return { status: 200, body: { clock: clock.toISOString(), heights } };
  }
  throw notFound();
}
