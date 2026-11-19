/* Health, users, the live stream and media. */
import { ApiError } from '../errors.js';
import { route, type Route, type RouteHandler, type Services } from '../routes.js';
import type { Ctx } from '../context.js';
import { iso } from '../util.js';
import { publicUser } from '../views.js';

export function registerMiscRoutes(services: Services, add: (r: Route) => void): void {
  add(route('GET', '/api/health', health(services), 'none'));
  add(route('GET', '/api/users/:username', getUser(services), 'none'));
  add(route('GET', '/api/stream', stream(services), 'stream'));
}

function health(services: Services): RouteHandler {
  return async (ctx) => {
    let ok = services.state.pgUp && services.state.storageUp && services.state.valkeyUp;
    if (services.state.pgUp) {
      try {
        await services.db.query('SELECT 1');
      } catch {
        ok = false;
      }
    }
    void ctx;
    return { status: 200, body: { status: ok ? 'ok' : 'unavailable' } };
  };
}

function getUser(services: Services): RouteHandler {
  return async (ctx) => {
    const rows = await services.db.query(`SELECT id, username, created_at FROM accounts WHERE username_lc = $1`, [(ctx.params.username as string).toLowerCase()]);
    if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
    const r = rows.rows[0] as { id: string; username: string; created_at: Date };
    return { status: 200, body: { username: r.username, createdAt: iso(new Date(r.created_at)) } };
  };
}

/* The live stream. SSE with an id: line per event, a retry line first, and a
   heartbeat comment at least every 15 seconds. Resumes from Last-Event-ID by
   replaying retained entries, or signals resync when the id is gone. */
function stream(services: Services): RouteHandler {
  return async (ctx) => {
    if (!services.valkey.isUp) throw new ApiError('SERVICE_UNAVAILABLE', 'Live updates paused');
    const topics = (ctx.url.searchParams.get('topics') ?? '').split(',').map((t) => t.trim()).filter((t) => t !== '');
    const res = ctx.res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    const lastEventId = typeof ctx.req.headers['last-event-id'] === 'string' ? (ctx.req.headers['last-event-id'] as string) : null;
    let closed = false;
    const accountTopic = ctx.account !== null ? `account:${ctx.account.id}` : null;
    const matches = (eventTopics: string[]): boolean =>
      eventTopics.some((t) => topics.includes(t)) || (accountTopic !== null && eventTopics.includes(accountTopic));

    const send = (id: string, event: string, data: string, eventTopics: string[]): void => {
      if (closed) return;
      if (!matches(eventTopics)) return;
      res.write(`id: ${id}\nevent: ${event}\ndata: ${data}\n\n`);
    };

    if (lastEventId !== null && lastEventId !== '') {
      try {
        const retained = await services.valkey.readAfter(lastEventId, 1000);
        for (const e of retained) {
          const parsed = JSON.parse(e.payload) as { topics: string[]; event: string; data: unknown };
          send(e.id, parsed.event, JSON.stringify(parsed.data), parsed.topics);
        }
      } catch {
        res.write('event: resync\ndata: {}\n\n');
      }
    }
    const unsubscribe = services.valkey.onMessage((e) => send(e.id, e.event, e.data, e.topics));
    const heartbeat = setInterval(() => {
      if (closed) return;
      res.write(': ping\n\n');
    }, 12_000);
    ctx.req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
    return undefined;
  };
}


