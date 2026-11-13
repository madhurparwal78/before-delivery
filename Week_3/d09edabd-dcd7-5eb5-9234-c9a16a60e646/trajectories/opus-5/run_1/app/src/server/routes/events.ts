import type { ServerResponse } from 'node:http';
import type { Route } from '../http.js';
import { sent } from '../http.js';
import { requireMember } from '../domain/session.js';
import {
  dropPresence,
  liveUp,
  markPresence,
  onChannel,
  presence,
  publish,
  roomChannel,
  sessionChannel,
} from '../services/live.js';
import { inviteByToken, openSessionOfInvite } from './play.js';
import { memberRoom } from './support.js';

function openStream(res: ServerResponse): (event: string, data: unknown) => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': open\n\n');
  return (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

export const eventRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId/events',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const send = openStream(ctx.res);
      const channel = roomChannel(room.id);
      const unsubscribe = onChannel(channel, (event) => send(event.event, event.data));

      const self = [{ userId: member.id, displayName: member.displayName }];
      const announce = async (): Promise<void> => {
        if (!liveUp()) {
          send('presence', { members: self });
          return;
        }
        try {
          await markPresence(room.id, member.id, member.displayName);
          publish(channel, { event: 'presence', data: { members: await presence(room.id) } });
        } catch {
          send('presence', { members: self });
        }
      };

      let lastLive = liveUp();
      send('live', { available: lastLive });
      void announce();

      const presenceTimer = setInterval(() => void announce(), 10_000);
      const liveTimer = setInterval(() => {
        const now = liveUp();
        if (now !== lastLive) {
          lastLive = now;
          send('live', { available: now });
          void announce();
        }
      }, 1000);
      const beat = setInterval(() => ctx.res.write(': beat\n\n'), 15_000);

      ctx.req.on('close', () => {
        clearInterval(presenceTimer);
        clearInterval(liveTimer);
        clearInterval(beat);
        unsubscribe();
        if (liveUp()) {
          void dropPresence(room.id, member.id)
            .then(async () => {
              publish(channel, {
                event: 'presence',
                data: { members: await presence(room.id) },
              });
            })
            .catch(() => undefined);
        }
      });
      return sent;
    },
  },
  {
    method: 'GET',
    pattern: '/api/play/:token/events',
    body: 'none',
    async handler(ctx) {
      const invite = await inviteByToken(ctx.params.token);
      const session = await openSessionOfInvite(invite);
      const send = openStream(ctx.res);
      const unsubscribe = onChannel(sessionChannel(session.id), (event) =>
        send(event.event, event.data),
      );
      let lastLive = liveUp();
      send('live', { available: lastLive });
      const liveTimer = setInterval(() => {
        const now = liveUp();
        if (now !== lastLive) {
          lastLive = now;
          send('live', { available: now });
        }
      }, 1000);
      const beat = setInterval(() => ctx.res.write(': beat\n\n'), 15_000);
      ctx.req.on('close', () => {
        clearInterval(liveTimer);
        clearInterval(beat);
        unsubscribe();
      });
      return sent;
    },
  },
];
