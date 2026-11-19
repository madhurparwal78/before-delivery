import { eventHub, newestEventId, oldestRetainedEventId, type LoggedEvent, type Subscriber } from '../domain/events';
import { nowDate } from '../clock';
import { healthReport } from '../services/health';
import type { Route } from '../http/router';
import { queryParam, requireUser, sendJson, type RequestContext } from '../http/context';

function resumeIdOf(ctx: RequestContext): number | null {
  const header = ctx.req.headers['last-event-id'];
  const raw = typeof header === 'string' && header.length > 0 ? header : queryParam(ctx, 'last_event_id');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return Number.NaN;
  return value;
}

async function streamEvents(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    date: nowDate().toUTCString(),
  });
  ctx.res.write('retry: 2000\n: connected\n\n');

  const newest = await newestEventId();
  const oldest = await oldestRetainedEventId();
  const resume = resumeIdOf(ctx);

  let startFrom = newest;
  let resetNeeded = false;
  if (resume !== null) {
    if (Number.isNaN(resume) || resume > newest || (newest > 0 && resume < oldest - 1) || resume < 0) {
      resetNeeded = true;
    } else {
      startFrom = resume;
    }
  }

  const write = (event: LoggedEvent): void => {
    ctx.res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  };

  if (resetNeeded) write({ id: newest, type: 'stream.reset', data: {} });

  const subscriber: Subscriber = {
    userId: user.id,
    workspaceId: user.workspace_id,
    lastSentId: startFrom,
    deliver: write,
    finish: () => ctx.res.end(),
  };

  const keepAlive = setInterval(() => ctx.res.write(': keep-alive\n\n'), 15_000);
  keepAlive.unref();
  ctx.req.on('close', () => {
    clearInterval(keepAlive);
    eventHub.remove(subscriber);
  });
  eventHub.add(subscriber);

  await new Promise<void>((resolve) => {
    ctx.res.on('close', () => resolve());
  });
}

async function health(ctx: RequestContext): Promise<void> {
  sendJson(ctx, 200, await healthReport());
}

export const eventRoutes: Route[] = [
  { method: 'GET', pattern: '/api/events', handler: streamEvents },
  { method: 'GET', pattern: '/api/health', handler: health, anonymous: true },
];
