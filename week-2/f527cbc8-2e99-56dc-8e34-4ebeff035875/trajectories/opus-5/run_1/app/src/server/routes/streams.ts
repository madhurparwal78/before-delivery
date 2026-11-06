import type { ServerResponse } from 'node:http';
import { config } from '../config.js';
import { now } from '../clock.js';
import { withClient } from '../db.js';
import { route, type Ctx, type RouteResult } from '../http.js';
import { notFound } from '../errors.js';
import { sessionExists } from '../auth.js';
import {
  barnDayChannel,
  horseChannel,
  newestSeq,
  readEventsAfter,
  type StreamRole,
} from '../stream.js';
import { visibleBarnDay, visibleHorse } from './shared.js';

/**
 * Live streams. Each role reads its own channel, a resume with Last-Event-ID replays
 * contiguous ids with nothing lost or repeated, and the stream ends when the session
 * ends.
 */
const POLL_MS = 500;

interface OpenStream {
  close: () => void;
}

const openStreams = new Set<OpenStream>();

export function closeAllStreams(): void {
  for (const stream of openStreams) stream.close();
  openStreams.clear();
}

async function serveStream(
  ctx: Ctx,
  channel: string,
  sessionId: string | null,
): Promise<RouteResult> {
  const res: ServerResponse = ctx.res;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'X-Request-Id': ctx.requestId,
  });
  res.write('retry: 2000\n\n');

  const lastEventId = ctx.header('last-event-id');
  let cursor = lastEventId === null ? await withClient((db) => newestSeq(db, channel)) : Number(lastEventId);
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

  let closed = false;
  const stream: OpenStream = {
    close: () => {
      closed = true;
      res.end();
    },
  };
  openStreams.add(stream);
  res.on('close', () => {
    closed = true;
    openStreams.delete(stream);
  });

  if (lastEventId !== null) {
    const replay = await withClient((db) =>
      readEventsAfter(db, channel, cursor, config.sseRetentionEvents),
    );
    if (replay.kind === 'reset') {
      res.write('event: reset\ndata: {}\n\n');
      cursor = await withClient((db) => newestSeq(db, channel));
    } else {
      for (const event of replay.events) {
        res.write(`id: ${event.seq}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
        cursor = event.seq;
      }
    }
  }

  let sinceHeartbeat = 0;
  const pump = async (): Promise<void> => {
    while (!closed) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (closed) break;
      // A stream ends within one heartbeat after its session is deleted on any instance.
      if (sessionId !== null) {
        const alive = await withClient((db) => sessionExists(db, sessionId));
        if (!alive) break;
      }
      const next = await withClient((db) =>
        readEventsAfter(db, channel, cursor, config.sseRetentionEvents),
      );
      if (next.kind === 'reset') {
        res.write('event: reset\ndata: {}\n\n');
        cursor = await withClient((db) => newestSeq(db, channel));
      } else {
        for (const event of next.events) {
          res.write(`id: ${event.seq}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
          cursor = event.seq;
        }
      }
      sinceHeartbeat += POLL_MS;
      if (sinceHeartbeat >= config.sseHeartbeatSeconds * 1000) {
        res.write(': heartbeat\n\n');
        sinceHeartbeat = 0;
      }
    }
    openStreams.delete(stream);
    if (!res.writableEnded) res.end();
  };
  void pump();

  return { kind: 'taken_over' };
}

export function registerStreamRoutes(): void {
  route({
    method: 'GET',
    path: '/api/barn-days/:id/events',
    roles: ['farrier', 'apprentice', 'barn_manager'],
    handler: async (ctx: Ctx) => {
      // API tokens cannot open a stream, so only a session reaches this point.
      if (ctx.caller.sessionId === null) throw notFound();
      const day = await withClient((db) =>
        visibleBarnDay(db, ctx.caller, ctx.params.id as string, now()),
      );
      const role = ctx.caller.role as StreamRole;
      return await serveStream(ctx, barnDayChannel(day.id, role), ctx.caller.sessionId);
    },
  });

  route({
    method: 'GET',
    path: '/api/horses/:id/events',
    roles: ['farrier', 'apprentice', 'owner'],
    handler: async (ctx: Ctx) => {
      if (ctx.caller.sessionId === null) throw notFound();
      const horse = await withClient((db) => visibleHorse(db, ctx.caller, ctx.params.id as string));
      const audience = ctx.caller.role === 'owner' ? 'owner' : 'staff';
      return await serveStream(ctx, horseChannel(horse.id, audience), ctx.caller.sessionId);
    },
  });
}
