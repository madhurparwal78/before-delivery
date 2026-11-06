import { eventId, replay, subscribe, type ChangeEvent } from '../events.ts';
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

  const deliver = (seq: number, event: ChangeEvent): void => {
    ctx.res.write(`id: ${eventId(seq)}\ndata: ${JSON.stringify({ kind: event.kind, id: event.id })}\n\n`);
  };
  const subscriber = {
    studioId: actor.studio.id,
    personId: actor.personId,
    sessionId: actor.sessionId,
    isStaff: actor.role === 'owner' || actor.role === 'kiln_tech',
    deliver,
  };
  const unsubscribe = subscribe(subscriber);
  // A reconnect resumes from its last event; a first connect from the cursor the screen loaded at.
  const lastEventId = ctx.req.headers['last-event-id'];
  replay(subscriber, typeof lastEventId === 'string' ? lastEventId : ctx.query.get('after'), deliver);
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
