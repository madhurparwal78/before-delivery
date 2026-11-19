import type { ServerResponse } from 'node:http';
import { errors } from '../../core/errors.js';
import { topics as topicNames } from '../../domain/events.js';
import { onLiveEvent, replayAfter, valkeyAvailable, ValkeyUnavailable, type StreamEntry } from '../../services/valkey.js';
import { route, type Route } from '../http.js';

interface Connection {
  res: ServerResponse;
  topics: Set<string>;
  heartbeat: NodeJS.Timeout;
}

const connections = new Set<Connection>();

function write(connection: Connection, entry: StreamEntry): void {
  connection.res.write(`id: ${entry.id}\nevent: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`);
}

/** One subscriber per process fans every published event out to the streams it matches. */
onLiveEvent((entry) => {
  for (const connection of connections) {
    if (entry.topics.some((topic) => connection.topics.has(topic))) write(connection, entry);
  }
});

export const streamRoutes: Route[] = [
  route(
    'GET',
    '/api/stream',
    async (ctx) => {
      if (!(await valkeyAvailable())) throw errors.serviceUnavailable('Live updates are unavailable');

      const requested = (ctx.url.searchParams.get('topics') ?? '')
        .split(',')
        .map((topic) => topic.trim())
        .filter((topic) => topic !== '');
      const allowed = new Set<string>();
      for (const topic of requested) {
        if (topic === topicNames.home || /^community:[A-Za-z0-9_]{3,21}$/.test(topic) || /^post:\d+$/.test(topic)) {
          allowed.add(topic);
        }
      }
      if (ctx.member) allowed.add(topicNames.member(ctx.member.id));

      ctx.res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      });
      ctx.res.write('retry: 3000\n\n');

      const connection: Connection = {
        res: ctx.res,
        topics: allowed,
        heartbeat: setInterval(() => ctx.res.write(': ping\n\n'), 10000),
      };
      connections.add(connection);

      const headerId = ctx.req.headers['last-event-id'];
      const lastEventId = (Array.isArray(headerId) ? headerId[0] : headerId) ?? ctx.url.searchParams.get('lastEventId');
      if (typeof lastEventId === 'string' && /^\d+-\d+$/.test(lastEventId)) {
        try {
          const replay = await replayAfter(lastEventId);
          if (replay.resync) {
            ctx.res.write('event: resync\ndata: {}\n\n');
          } else {
            for (const entry of replay.entries) {
              if (entry.topics.some((topic) => allowed.has(topic))) write(connection, entry);
            }
          }
        } catch (error) {
          if (!(error instanceof ValkeyUnavailable)) throw error;
        }
      }

      const close = () => {
        clearInterval(connection.heartbeat);
        connections.delete(connection);
      };
      ctx.req.on('close', close);
      ctx.req.on('error', close);
    },
    'none',
  ),
];
