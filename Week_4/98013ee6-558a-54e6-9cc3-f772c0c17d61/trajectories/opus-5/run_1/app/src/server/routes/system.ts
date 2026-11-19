import { env } from '../env.js';
import { now, setClock } from '../clock.js';
import { notFound, validation } from '../errors.js';
import { route, sendJson } from '../http.js';
import { storageHealthy } from '../storage.js';
import { publish } from '../live.js';
import { readString } from '../domain/validate.js';
import { expireDueOperations } from '../domain/operations.js';
import { runSeed, type SeedBody } from '../domain/seed.js';
import type { PublicConfig } from '../../shared/types.js';

function requireGradingKey(key: string | undefined): void {
  if (!env.gradingKey || key !== env.gradingKey) throw notFound();
}

route(
  'GET',
  '/api/health',
  async (ctx) => {
    sendJson(ctx.res, 200, { status: storageHealthy() ? 'ok' : 'unavailable' });
  },
  { auth: false },
);

route(
  'GET',
  '/api/config',
  async (ctx) => {
    const body: PublicConfig = {
      now: now().toISOString(),
      time_zone: env.timeZone,
      undo_seconds: env.undoSeconds,
      invite_ttl_seconds: env.inviteTtlSeconds,
      limits: {
        image_max_bytes: env.limits.imageMaxBytes,
        image_max_pixels: env.limits.imageMaxPixels,
        title_max: env.limits.titleMax,
        description_max: env.limits.descriptionMax,
        comment_max: env.limits.commentMax,
        board_name_max: env.limits.boardNameMax,
      },
    };
    sendJson(ctx.res, 200, body);
  },
  { auth: false },
);

route(
  'POST',
  '/api/grading/clock',
  async (ctx) => {
    requireGradingKey(ctx.req.headers['x-grading-key'] as string | undefined);
    const raw = readString(ctx.body, 'now');
    const instant = raw === null ? null : new Date(raw);
    if (!instant || Number.isNaN(instant.getTime())) throw validation('now');
    const moved = await setClock(instant);
    await publish({ k: 'clock' });
    await expireDueOperations();
    sendJson(ctx.res, 200, { now: moved.toISOString() });
  },
  { auth: false },
);

route(
  'POST',
  '/api/grading/seed',
  async (ctx) => {
    requireGradingKey(ctx.req.headers['x-grading-key'] as string | undefined);
    const ids = await runSeed(ctx.body as SeedBody);
    sendJson(ctx.res, 201, { ids });
  },
  { auth: false },
);
