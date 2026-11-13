import { validationError } from '../domain/errors.js';
import { clearTestClock, now, setTestClock, today } from '../domain/clock.js';
import { jsonBody, requireBodySize, route, type Ctx, type Reply } from './server.js';

/** Registered only when the environment sets INTERVAL_TEST_CLOCK to `on`. */
export function registerTestRoutes(): void {
  route('PUT', '/api/test/clock', async (ctx: Ctx): Promise<Reply> => {
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    const given = typeof body.now === 'string' ? new Date(body.now) : new Date(Number.NaN);
    if (Number.isNaN(given.getTime())) {
      throw validationError({ now: 'An ISO 8601 instant with an offset is needed.' });
    }
    setTestClock(given);
    return { status: 200, body: { now: now().toISOString(), today: today() } };
  });

  route('DELETE', '/api/test/clock', async (): Promise<Reply> => {
    clearTestClock();
    return { status: 200, body: { now: now().toISOString(), today: today() } };
  });
}
