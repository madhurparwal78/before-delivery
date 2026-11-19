import { config } from './config.js';
import { now, setClock } from './clock.js';
import { transaction } from './db.js';
import { AppError, invalid } from './errors.js';
import { Ctx, gradingTokenOk, route } from './http.js';
import { settle } from './ticker.js';
import { seedWorld } from './seed.js';
import { StorageUnavailable } from './storage.js';

/** Grading routes: behind the token, and absent (404) when no token is configured. */
function guard(ctx: Ctx): void {
  if (!config.gradingToken) throw new AppError('not_found');
  if (!gradingTokenOk(ctx)) throw new AppError('unauthenticated');
}

export function registerGradingRoutes(): void {
  route('POST', '/api/grading/clock', async (ctx) => {
    guard(ctx);
    const body = await ctx.json();
    const value = typeof body.now === 'string' ? new Date(body.now) : null;
    if (!value || Number.isNaN(value.getTime())) throw invalid('now', 'now');
    await transaction(null, async (db) => {
      await setClock(db, value);
      await db.query('DELETE FROM booking_attempts');
    });
    await settle();
    ctx.send(200, { now: now().toISOString() });
  });

  route('GET', '/api/grading/clock', async (ctx) => {
    guard(ctx);
    ctx.send(200, { now: now().toISOString() });
  });

  route('POST', '/api/grading/seed', async (ctx) => {
    guard(ctx);
    const body = await ctx.json();
    const origin = config.publicUrl || `http://${ctx.req.headers.host ?? `127.0.0.1:${config.port}`}`;
    try {
      const result = await transaction(null, (db) => seedWorld(db, body, origin));
      ctx.send(201, result);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw new AppError('storage_unavailable');
      throw error;
    }
  });
}

