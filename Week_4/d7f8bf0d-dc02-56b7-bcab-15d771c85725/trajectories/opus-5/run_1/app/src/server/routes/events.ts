import type { ServerResponse } from 'node:http';
import type { Ctx } from '../context.js';
import { errors } from '../errors.js';
import type { Route } from '../router.js';
import { eventReader } from '../services/eventReader.js';
import {
  ensureProbed,
  firstSeq,
  lastSeq,
  layoutStream,
  rangeAfter,
  sessionStream,
  type StreamEntry,
} from '../services/valkey.js';
import { loadLayout } from '../services/layoutStore.js';
import { loadSession } from '../services/sessionStore.js';

function writeEvent(res: ServerResponse, entry: StreamEntry): void {
  res.write(`id: ${entry.seq}\nevent: ${entry.type}\ndata: ${entry.payload}\n\n`);
}

function requestedSeq(ctx: Ctx): number | null {
  const header = ctx.req.headers['last-event-id'];
  const raw = typeof header === 'string' ? header : ctx.query.get('last_event_id');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function streamEvents(ctx: Ctx, stream: string): Promise<void> {
  if (!(await ensureProbed(1000))) throw errors.valkeyUnavailable();

  const res = ctx.res;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': open\n\n');

  const from = requestedSeq(ctx);
  let lastSent = from ?? 0;

  if (from !== null) {
    const earliest = await firstSeq(stream);
    if (earliest !== null && earliest > from + 1) {
      res.write(`event: resync\ndata: ${JSON.stringify({ reason: 'replay_aged_out' })}\n\n`);
    } else {
      for (const entry of await rangeAfter(stream, from)) {
        writeEvent(res, entry);
        lastSent = entry.seq;
      }
    }
  } else {
    lastSent = await lastSeq(stream);
  }

  let filling = false;
  const pending: StreamEntry[] = [];

  const flush = async (): Promise<void> => {
    if (filling) return;
    filling = true;
    while (pending.length > 0) {
      const entry = pending.shift();
      if (!entry) break;
      if (entry.seq <= lastSent) continue;
      if (lastSent > 0 && entry.seq > lastSent + 1) {
        for (const missed of await rangeAfter(stream, lastSent)) {
          if (missed.seq >= entry.seq) break;
          writeEvent(res, missed);
          lastSent = missed.seq;
        }
      }
      writeEvent(res, entry);
      lastSent = entry.seq;
    }
    filling = false;
  };

  const unsubscribe = eventReader.subscribe(stream, lastSent, (entry) => {
    pending.push(entry);
    void flush();
  });

  const keepAlive = setInterval(() => res.write(': tick\n\n'), 15_000);
  const stop = (): void => {
    clearInterval(keepAlive);
    unsubscribe();
  };
  ctx.req.on('close', stop);
  ctx.req.on('error', stop);
}

export const eventRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/layouts/:layoutId/events',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const layout = await loadLayout(ctx.params['layoutId'], ctx.workspaceId);
      if (!layout) throw errors.notFound();
      await streamEvents(ctx, layoutStream(layout.id));
    },
  },
  {
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sessions/:sessionId/events',
    auth: 'workspace',
    capability: 'read',
    handle: async (ctx) => {
      const record = await loadSession(ctx.params['sessionId'], ctx.workspaceId);
      if (!record) throw errors.notFound();
      await streamEvents(ctx, sessionStream(record.id));
    },
  },
];
