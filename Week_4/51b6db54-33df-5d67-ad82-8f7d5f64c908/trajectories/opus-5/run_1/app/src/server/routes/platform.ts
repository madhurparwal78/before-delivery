import { advanceSeconds, instant, now, setClock } from '../clock.js';
import { config, publicLimits } from '../config.js';
import { databaseReady, probe } from '../db.js';
import { notFound, unprocessable } from '../errors.js';
import type { Route } from '../http.js';
import { seedRecords } from '../seed.js';
import { storageReachable } from '../storage.js';

function gradingKeyOk(header: string | string[] | undefined): boolean {
  return config.gradingKey !== '' && header === config.gradingKey;
}

export const platformRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    handler: async () => {
      const [database, storage] = await Promise.all([probe(), storageReachable()]);
      return {
        status: 200,
        body: { status: database && storage ? 'ok' : 'unavailable' },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/config',
    handler: async () => ({
      status: 200,
      body: { now: instant(await now()), ...publicLimits() },
    }),
  },
  {
    method: 'POST',
    pattern: '/api/grading/seed',
    handler: async (ctx) => {
      if (!gradingKeyOk(ctx.req.headers['x-grading-key'])) throw notFound();
      const ids = await seedRecords(ctx.body);
      return { status: 201, body: { ids } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/grading/clock',
    handler: async (ctx) => {
      if (!gradingKeyOk(ctx.req.headers['x-grading-key'])) throw notFound();
      if (ctx.body.advance_seconds !== undefined) {
        const seconds = Number(ctx.body.advance_seconds);
        if (!Number.isFinite(seconds) || seconds < 0) {
          throw unprocessable({ advance_seconds: 'Use 0 or more seconds' });
        }
        return { status: 200, body: { now: instant(await advanceSeconds(seconds)) } };
      }
      if (typeof ctx.body.set === 'string') {
        const to = new Date(ctx.body.set);
        if (Number.isNaN(to.getTime()) || to.getTime() < (await now()).getTime()) {
          throw unprocessable({ set: 'Use an instant from now on' });
        }
        return { status: 200, body: { now: instant(await setClock(to)) } };
      }
      throw unprocessable({ advance_seconds: 'Send advance_seconds or set' });
    },
  },
];

export { databaseReady };
