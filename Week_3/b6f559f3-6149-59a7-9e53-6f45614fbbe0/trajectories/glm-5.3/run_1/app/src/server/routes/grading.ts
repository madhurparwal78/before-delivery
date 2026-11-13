// Grading routes: reset, seed and clock, hidden without the key.
import { sendJson } from '../http';
import { notFound, validationMessage, storageUnavailable } from '../errors';
import { COPY } from '../../domain/copy';
import type { RouteCtx } from '../routes';
import { seedAll } from '../seed';

export async function handleGradingRoutes(ctx: RouteCtx): Promise<void> {
  const key = ctx.req.headers['x-grading-key'];
  if (!ctx.app.cfg.gradingKey || key !== ctx.app.cfg.gradingKey) {
    throw notFound();
  }
  if (ctx.path === '/api/grading/reset' && ctx.method === 'POST') {
    await resetStore(ctx);
    sendJson(ctx.res, 200, { status: 'reset' });
    return;
  }
  if (ctx.path === '/api/grading/seed' && ctx.method === 'POST') {
    const result = await seedAll(ctx);
    sendJson(ctx.res, 201, result);
    return;
  }
  if (ctx.path === '/api/grading/clock' && ctx.method === 'POST') {
    const body = ctx.body as { advanceMs?: number };
    const n = body?.advanceMs;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      throw validationMessage('Must be a non-negative integer.', 'advanceMs');
    }
    const now = await ctx.app.clock.advance(ctx.app.pool, n);
    sendJson(ctx.res, 200, { now });
    return;
  }
  throw notFound();
}

async function resetStore(ctx: RouteCtx): Promise<void> {
  const tables = [
    'publish_notices',
    'invite_notices',
    'outbox',
    'idempotency',
    'redo_stack',
    'op_history',
    'locks',
    'assets',
    'versions',
    'invites',
    'members',
    'scenes',
    'projects',
    'sessions',
    'people',
    'workspaces',
  ];
  for (const t of tables) {
    await ctx.app.pool.query(`DELETE FROM ${t}`);
  }
  await ctx.app.s3.deletePrefix('projects/').catch(() => undefined);
  await ctx.app.clock.reset(ctx.app.pool);
}

export { storageUnavailable, COPY };
