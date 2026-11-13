import { timingSafeEqual } from 'node:crypto';
import { copy } from '../../shared/copy.js';
import { setClock } from '../clock.js';
import { config, SEED_LIMIT_BYTES } from '../config.js';
import { transaction } from '../db/pool.js';
import { ApiError, notFound, validation } from '../http/errors.js';
import { asObject } from '../http/input.js';
import type { Context } from '../http/router.js';
import { reply, route } from '../http/router.js';
import { SeedError, applySeed } from './seed.js';

const keyed = (ctx: Context): void => {
  const offered = Buffer.from(String(ctx.req.headers['x-grading-key'] ?? ''));
  const expected = Buffer.from(config.gradingKey);
  if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) throw notFound();
};

route('POST', '/api/grading/seed', { auth: false, limit: SEED_LIMIT_BYTES }, async (ctx) => {
  keyed(ctx);
  try {
    return reply(201, await transaction((db) => applySeed(db, asObject(ctx.body))));
  } catch (error) {
    if (error instanceof SeedError) throw new ApiError(422, 'SEED_INVALID', error.message);
    throw error;
  }
});

route('POST', '/api/grading/clock', { auth: false }, async (ctx) => {
  keyed(ctx);
  const requested = asObject(ctx.body)['now'];
  if (requested === null) return reply(200, { now: setClock(null).toISOString() });
  const instant = typeof requested === 'string' ? new Date(requested) : null;
  if (!instant || Number.isNaN(instant.getTime())) throw validation({ now: copy.fieldErrors });
  return reply(200, { now: setClock(instant).toISOString() });
});
