import { subscribe, type ChangeEvent } from '../events.ts';
import type { Route, RouteResult } from '../http/context.ts';
import { Ctx } from '../http/context.ts';

async function stream(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  ctx.res.write(': connected\n\n');

  const unsubscribe = subscribe({
    studioId: actor.studio.id,
    personId: actor.personId,
    sessionId: actor.sessionId,
    isStaff: actor.role === 'owner' || actor.role === 'kiln_tech',
    deliver: (event: ChangeEvent) => {
      ctx.res.write(
        `data: ${JSON.stringify({
          kind: event.kind,
          id: event.id,
        })}\n\n`,
      );
    },
  });
  const heartbeat = setInterval(() => ctx.res.write(': ping\n\n'), 20_000);
  const close = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  ctx.req.on('close', close);
  ctx.res.on('close', close);
  return { status: 200, streamed: true };
}

export const eventRoutes: readonly Route[] = [
  { method: 'GET', pattern: '/api/events', role: 'signed_in', handle: stream },
];
