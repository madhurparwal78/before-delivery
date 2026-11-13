import { Router } from 'express';
import { route } from '../http/handler.js';
import { resolveCaller } from '../http/session.js';
import { serviceStatus } from '../services/status.js';
import { subscribe, type AppEvent } from '../jobs/events.js';

export const platformRouter = Router();

/** The health check answers even while dependencies are down. */
platformRouter.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

platformRouter.get(
  '/api/status',
  route(async (_req, res) => {
    res.json({ services: await serviceStatus() });
  }),
);

function maySee(event: AppEvent, userId: string, roles: readonly string[]): boolean {
  return event.audience.some(
    (entry) => entry === userId || roles.includes(entry),
  );
}

/** The live stream of what the signed-in user may see. */
platformRouter.get(
  '/api/events',
  route(async (req, res) => {
    const caller = await resolveCaller(req);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': open\n\n');
    if (!caller) {
      res.end();
      return;
    }
    const userId = caller.user.id;
    const roles = caller.user.roles;

    const unsubscribe = subscribe((event) => {
      if (!maySee(event, userId, roles)) return;
      const { type, audience, ...data } = event;
      void audience;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
      res.end();
    });
  }),
);
