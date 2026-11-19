import { config } from '../config.js';
import { readClock } from '../clock.js';
import { db } from '../db.js';
import { errors } from '../errors.js';
import { jsonBody, type Ctx } from '../http/context.js';
import { sendJson } from '../http/respond.js';
import { applySeed, resetEverything } from '../seed.js';
import { moveClockTo } from '../services/deadlines.js';

export function requireGradingKey(ctx: Ctx): void {
  const key = ctx.req.headers['x-grading-key'];
  if (typeof key !== 'string' || key !== config.gradingKey) throw errors.notFound();
}

export async function gradingReset(ctx: Ctx): Promise<void> {
  requireGradingKey(ctx);
  const now = await resetEverything();
  sendJson(ctx.res, 200, { now: now.toISOString() });
}

export async function gradingSeed(ctx: Ctx): Promise<void> {
  requireGradingKey(ctx);
  const body = ctx.rawBody.length === 0 ? {} : jsonBody<unknown>(ctx);
  sendJson(ctx.res, 201, await applySeed(body));
}

export async function gradingClock(ctx: Ctx): Promise<void> {
  requireGradingKey(ctx);
  const body = jsonBody<{ advanceMinutes?: number; setTo?: string }>(ctx);
  const current = await readClock();
  const target =
    typeof body.advanceMinutes === 'number'
      ? new Date(current.getTime() + body.advanceMinutes * 60_000)
      : typeof body.setTo === 'string'
        ? new Date(body.setTo)
        : current;
  const now = await moveClockTo(target);
  sendJson(ctx.res, 200, { now: now.toISOString() });
}

export async function gradingTamper(ctx: Ctx): Promise<void> {
  requireGradingKey(ctx);
  const body = jsonBody<{ sequence?: number; after?: Record<string, unknown> }>(ctx);
  const sequence = Number(body.sequence);
  await db.query('update audit_log set after = $1::jsonb where sequence = $2', [
    JSON.stringify(body.after ?? null),
    sequence,
  ]);
  sendJson(ctx.res, 200, { sequence });
}
